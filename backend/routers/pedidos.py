from datetime import datetime, timezone
from typing import Any, List, Literal, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from audit import registrar_auditoria
from catalog_cache import invalidate_catalog_cache
from database import get_db
from finance import estimar_custo_unitario, obter_config_custos
from locks import stock_lock
from label_service import gerar_etiquetas_producao
from order_status import validar_transicao_status
from money import centavos_em_valor, subtotal_em_centavos, valor_em_centavos
from security import require_atelie_auth
from stock import quantidades_por_perfume, validar_estoque
from utils import next_seq, serialize

router = APIRouter(prefix="/api/pedidos", tags=["pedidos"])


class ItemPedido(BaseModel):
    perfumeId: str
    ml: int = Field(gt=0, le=1000)
    quantidade: int = Field(gt=0, le=100)
    precoUnitario: Optional[float] = Field(default=None, ge=0)
    subtotal: Optional[float] = Field(default=None, ge=0)
    prontaEntrega: Optional[bool] = None
    tipoAtendimento: Optional[Literal["pronta_entrega", "sob_encomenda"]] = None
    custoUnitarioEstimado: Optional[float] = Field(default=None, ge=0)
    lucroUnitarioEstimado: Optional[float] = None


class EnderecoPedido(BaseModel):
    cep: str = Field(min_length=8, max_length=9)
    endereco: str = Field(min_length=2, max_length=160)
    numero: str = Field(min_length=1, max_length=20)
    complemento: str = Field(default="", max_length=120)
    bairro: str = Field(min_length=2, max_length=100)
    cidade: str = Field(min_length=2, max_length=100)
    estado: str = Field(min_length=2, max_length=2)


class PedidoIn(BaseModel):
    cliente: str = Field(min_length=2, max_length=120)
    contato: str = Field(default="", max_length=160)
    status: Literal[
        "pendente",
        "pagamento_confirmado",
        "preparando",
        "pronto",
        "enviado",
        "entregue",
        "cancelado",
    ] = "pendente"
    observacoes: str = Field(default="", max_length=1000)
    endereco: Optional[EnderecoPedido] = None
    itens: List[ItemPedido] = Field(min_length=1, max_length=100)
    subtotalTabela: Optional[float] = Field(default=None, ge=0)
    ajusteManual: float = 0
    total: float = Field(default=0, ge=0)


def _oid(pedido_id: str) -> ObjectId:
    try:
        return ObjectId(pedido_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de pedido inválido.")


async def _reverter_movimentos_do_pedido(db, pedido_id: str):
    await _sincronizar_movimentos_do_pedido(db, pedido_id, [], "cancelado")


def _status_consume_estoque(status: str) -> bool:
    return status in ("preparando", "pronto", "enviado", "entregue")


async def _itens_com_atendimento(db, itens: List[ItemPedido]) -> list[dict[str, Any]]:
    """Grava no pedido como cada item será atendido naquele momento."""
    object_ids = []
    for item in itens:
        try:
            object_ids.append(ObjectId(item.perfumeId))
        except InvalidId:
            continue
    perfumes = await db.perfumes.find(
        {"_id": {"$in": object_ids}},
        {
            "prontaEntrega": 1,
            "custoEssenciaPorMl": 1,
            "concentracaoPercentual": 1,
            "precos": 1,
        },
    ).to_list(len(object_ids))
    perfumes_por_id = {str(perfume["_id"]): perfume for perfume in perfumes}
    config_custos = await obter_config_custos(db)

    resultado = []
    for item in itens:
        data = item.model_dump()
        perfume = perfumes_por_id.get(item.perfumeId, {})
        pronta = data.get("prontaEntrega")
        if pronta is None:
            # Item antigo ou produto removido: o padrão conservador evita
            # liberar uma reserva que já existia.
            pronta = perfume.get("prontaEntrega", True)
        data["prontaEntrega"] = bool(pronta)
        data["tipoAtendimento"] = (
            "pronta_entrega" if pronta else "sob_encomenda"
        )
        preco = data.get("precoUnitario")
        if preco is None:
            opcao = next(
                (p for p in perfume.get("precos", []) if int(p.get("ml", 0) or 0) == item.ml),
                None,
            )
            preco = float((opcao or {}).get("preco", 0) or 0)
        preco_centavos = valor_em_centavos(preco or 0)
        data["precoUnitario"] = centavos_em_valor(preco_centavos)
        data["precoUnitarioCentavos"] = preco_centavos
        subtotal_centavos = (
            valor_em_centavos(data["subtotal"])
            if data.get("subtotal") is not None
            else subtotal_em_centavos(data["precoUnitario"], item.quantidade)
        )
        data["subtotal"] = centavos_em_valor(subtotal_centavos)
        data["subtotalCentavos"] = subtotal_centavos
        if data.get("custoUnitarioEstimado") is None:
            calculo = estimar_custo_unitario(perfume, item.ml, float(preco or 0), config_custos)
            data["custoUnitarioEstimado"] = float(calculo["custoTotal"])
        custo_snapshot = float(data.get("custoUnitarioEstimado") or 0)
        data["lucroUnitarioEstimado"] = float(preco or 0) - custo_snapshot
        resultado.append(data)
    return resultado


async def _validar_status_estoque(
    db,
    *,
    itens: list[dict[str, Any]],
    status: str,
    pedido_id: str | None = None,
    pedido_anterior: dict | None = None,
) -> None:
    if status == "cancelado":
        return
    credito_itens = (
        pedido_anterior.get("itens", [])
        if pedido_anterior and _status_consume_estoque(pedido_anterior.get("status", ""))
        else []
    )
    await validar_estoque(
        db,
        itens,
        excluir_pedido_id=pedido_id,
        somente_reservaveis=not _status_consume_estoque(status),
        credito_itens=credito_itens,
    )


async def _sincronizar_movimentos_do_pedido(
    db,
    pedido_id: str,
    itens: list[Any],
    status: str,
) -> None:
    """Concilia a baixa do pedido com escritas repetíveis e recuperáveis."""
    origem = f"pedido:{pedido_id}"
    movimentos_atuais = await db.movimentos.find(
        {"origem": origem},
        {"perfumeId": 1, "tipo": 1, "quantidadeMl": 1},
    ).to_list(5000)
    consumo_atual: dict[str, int] = {}
    for movimento in movimentos_atuais:
        perfume_id = str(movimento.get("perfumeId") or "")
        if not perfume_id:
            continue
        quantidade = int(movimento.get("quantidadeMl", 0) or 0)
        sinal = 1 if movimento.get("tipo") == "saida" else -1
        consumo_atual[perfume_id] = consumo_atual.get(perfume_id, 0) + sinal * quantidade

    desejado = (
        quantidades_por_perfume(itens)
        if _status_consume_estoque(status)
        else {}
    )
    agora = datetime.now(timezone.utc)
    ajustes = []
    for perfume_id in set(consumo_atual) | set(desejado):
        diferenca = desejado.get(perfume_id, 0) - consumo_atual.get(perfume_id, 0)
        if diferenca == 0:
            continue
        ajustes.append({
            "perfumeId": perfume_id,
            "tipo": "saida" if diferenca > 0 else "entrada",
            "quantidadeMl": abs(diferenca),
            "motivo": (
                "Baixa automática do pedido"
                if diferenca > 0
                else "Estorno automático do pedido"
            ),
            "categoria": "pedido",
            "origem": origem,
            "pedidoId": pedido_id,
            "data": agora,
        })
    if ajustes:
        await db.movimentos.insert_many(ajustes)


async def _persistir_pedido_e_estoque(
    db,
    *,
    pedido_id: str,
    existente: dict,
    atualizacao: dict[str, Any],
    itens: list[dict[str, Any]],
    novo_status: str,
) -> None:
    """Atualiza pedido e estoque com CAS e compensação em caso de falha."""
    status_anterior = str(existente.get("status", "pendente"))
    validar_transicao_status(status_anterior, novo_status)

    movimento_antecipado = _status_consume_estoque(novo_status)
    if movimento_antecipado:
        await _sincronizar_movimentos_do_pedido(
            db, pedido_id, itens, novo_status
        )

    operacao: dict[str, Any] = {"$set": atualizacao}
    if novo_status != status_anterior:
        operacao["$push"] = {
            "historicoStatus": {
                "status": novo_status,
                "data": datetime.now(timezone.utc),
            }
        }

    try:
        resultado = await db.pedidos.update_one(
            {"_id": _oid(pedido_id), "status": status_anterior},
            operacao,
        )
        if resultado.matched_count == 0:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "PEDIDO_ATUALIZADO_EM_OUTRA_SESSAO",
                    "message": (
                        "O pedido foi alterado em outra sessão. "
                        "Atualize o painel antes de tentar novamente."
                    ),
                },
            )
    except Exception:
        if movimento_antecipado:
            await _sincronizar_movimentos_do_pedido(
                db,
                pedido_id,
                list(existente.get("itens", [])),
                status_anterior,
            )
        raise

    # Em cancelamentos, remover a baixa após salvar mantém o saldo sempre
    # conservador caso a operação precise ser repetida.
    if not movimento_antecipado:
        await _sincronizar_movimentos_do_pedido(db, pedido_id, itens, novo_status)


@router.get("")
async def listar_pedidos(_: str = Depends(require_atelie_auth)):
    db = get_db()
    pedidos = await db.pedidos.find(
        {"arquivadoEm": None}
    ).sort("seq", -1).to_list(5000)
    return [serialize(p) for p in pedidos]


@router.get("/{pedido_id}/etiquetas")
async def gerar_etiquetas_pedido(pedido_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    pedido = await db.pedidos.find_one({"_id": _oid(pedido_id)})
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")
    ids = []
    for item in pedido.get("itens") or []:
        try:
            ids.append(ObjectId(str(item.get("perfumeId") or "")))
        except InvalidId:
            continue
    nomes = {}
    if ids:
        perfumes = await db.perfumes.find({"_id": {"$in": ids}}, {"nome": 1}).to_list(5000)
        nomes = {str(perfume["_id"]): str(perfume.get("nome") or "Perfume") for perfume in perfumes}
    try:
        conteudo = gerar_etiquetas_producao(pedido, nomes)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    seq = int(pedido.get("seq", 0) or 0)
    return Response(
        content=conteudo,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="etiquetas-pedido-{seq:03d}.pdf"',
            "Cache-Control": "no-store",
        },
    )


@router.post("")
async def criar_pedido(payload: PedidoIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    async with stock_lock(db):
        itens = await _itens_com_atendimento(db, payload.itens)
        await _validar_status_estoque(db, itens=itens, status=payload.status)
        doc = payload.model_dump()
        doc["itens"] = itens
        doc["subtotalTabelaCentavos"] = valor_em_centavos(doc.get("subtotalTabela"))
        doc["ajusteManualCentavos"] = valor_em_centavos(doc.get("ajusteManual"))
        doc["totalCentavos"] = valor_em_centavos(doc.get("total"))
        doc["seq"] = await next_seq(db, "pedidos")
        agora = datetime.now(timezone.utc)
        doc["criadoEm"] = agora
        doc["historicoStatus"] = [{"status": payload.status, "data": agora}]
        resultado = await db.pedidos.insert_one(doc)
        pedido_id = str(resultado.inserted_id)
        try:
            await _sincronizar_movimentos_do_pedido(
                db, pedido_id, itens, payload.status
            )
        except Exception:
            await db.pedidos.delete_one({"_id": resultado.inserted_id})
            await _reverter_movimentos_do_pedido(db, pedido_id)
            raise
        novo = await db.pedidos.find_one({"_id": resultado.inserted_id})
        invalidate_catalog_cache()
        return serialize(novo)


@router.put("/{pedido_id}")
async def atualizar_pedido(pedido_id: str, payload: PedidoIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    async with stock_lock(db):
        existente = await db.pedidos.find_one({"_id": _oid(pedido_id)})
        if not existente:
            raise HTTPException(status_code=404, detail="Pedido não encontrado.")
        itens = await _itens_com_atendimento(db, payload.itens)
        await _validar_status_estoque(
            db,
            itens=itens,
            status=payload.status,
            pedido_id=pedido_id,
            pedido_anterior=existente,
        )
        # Campos opcionais não enviados pelo painel (como endereço de pedidos
        # antigos) não devem ser apagados durante uma simples troca de status.
        atualizacao = payload.model_dump(exclude_unset=True)
        atualizacao["itens"] = itens
        if "subtotalTabela" in atualizacao:
            atualizacao["subtotalTabelaCentavos"] = valor_em_centavos(
                atualizacao.get("subtotalTabela")
            )
        if "ajusteManual" in atualizacao:
            atualizacao["ajusteManualCentavos"] = valor_em_centavos(
                atualizacao.get("ajusteManual")
            )
        if "total" in atualizacao:
            atualizacao["totalCentavos"] = valor_em_centavos(atualizacao.get("total"))
        await _persistir_pedido_e_estoque(
            db,
            pedido_id=pedido_id,
            existente=existente,
            atualizacao=atualizacao,
            itens=itens,
            novo_status=payload.status,
        )
        atualizado = await db.pedidos.find_one({"_id": _oid(pedido_id)})
        invalidate_catalog_cache()
        return serialize(atualizado)


@router.delete("/{pedido_id}")
async def apagar_pedido(pedido_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    async with stock_lock(db):
        oid = _oid(pedido_id)
        pedido = await db.pedidos.find_one({"_id": oid})
        if not pedido:
            raise HTTPException(status_code=404, detail="Pedido não encontrado.")
        if pedido.get("status") not in {"cancelado", "entregue"}:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Somente pedidos cancelados ou entregues podem ser arquivados. "
                    "Conclua o fluxo antes de arquivar."
                ),
            )
        agora = datetime.now(timezone.utc)
        await db.pedidos.update_one(
            {"_id": oid, "arquivadoEm": None},
            {"$set": {"arquivadoEm": agora, "arquivadoPor": "administrador"}},
        )
        await registrar_auditoria(
            db,
            acao="arquivar",
            recurso="pedido",
            recurso_id=pedido_id,
            titulo="Pedido arquivado",
            detalhes=f"Pedido Nº {pedido.get('seq', 0)} preservado fora do fluxo ativo.",
            metadados={"seq": pedido.get("seq"), "status": pedido.get("status")},
        )
        invalidate_catalog_cache()
        return {"status": "Pedido arquivado com histórico preservado."}


@router.post("/{pedido_id}/restaurar")
async def restaurar_pedido(pedido_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    oid = _oid(pedido_id)
    resultado = await db.pedidos.update_one(
        {"_id": oid, "arquivadoEm": {"$ne": None}},
        {"$unset": {
            "arquivadoEm": "",
            "arquivadoPor": "",
            "excluirMetricas": "",
            "acompanhamentoAtivo": "",
        }},
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pedido arquivado não encontrado.")
    await registrar_auditoria(
        db,
        acao="restaurar",
        recurso="pedido",
        recurso_id=pedido_id,
        titulo="Pedido restaurado",
        detalhes="Pedido devolvido ao painel administrativo.",
    )
    invalidate_catalog_cache()
    return {"status": "Pedido restaurado."}
