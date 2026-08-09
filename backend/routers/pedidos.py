from datetime import datetime, timezone
from typing import Any, List, Literal, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_db
from finance import estimar_custo_unitario, obter_config_custos
from locks import stock_lock
from order_status import validar_transicao_status
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
    await db.movimentos.delete_many({"origem": f"pedido:{pedido_id}"})


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
    if not _status_consume_estoque(status):
        await db.movimentos.delete_many({"origem": origem})
        return

    agora = datetime.now(timezone.utc).isoformat()
    quantidades = quantidades_por_perfume(itens)
    for perfume_id, quantidade_ml in quantidades.items():
        await db.movimentos.update_one(
            {"origem": origem, "perfumeId": perfume_id},
            {
                "$set": {
                    "tipo": "saida",
                    "quantidadeMl": quantidade_ml,
                    "motivo": "Baixa automática ao iniciar preparação",
                    "categoria": "pedido",
                    "data": agora,
                },
                "$setOnInsert": {
                    "origem": origem,
                    "perfumeId": perfume_id,
                },
            },
            upsert=True,
        )

    filtro_obsoletos: dict[str, Any] = {"origem": origem}
    if quantidades:
        filtro_obsoletos["perfumeId"] = {"$nin": list(quantidades)}
    await db.movimentos.delete_many(filtro_obsoletos)


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
                "data": datetime.now(timezone.utc).isoformat(),
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
    pedidos = await db.pedidos.find().sort("seq", -1).to_list(5000)
    return [serialize(p) for p in pedidos]


@router.post("")
async def criar_pedido(payload: PedidoIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    async with stock_lock(db):
        itens = await _itens_com_atendimento(db, payload.itens)
        await _validar_status_estoque(db, itens=itens, status=payload.status)
        doc = payload.model_dump()
        doc["itens"] = itens
        doc["seq"] = await next_seq(db, "pedidos")
        agora = datetime.now(timezone.utc).isoformat()
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
        await _persistir_pedido_e_estoque(
            db,
            pedido_id=pedido_id,
            existente=existente,
            atualizacao=atualizacao,
            itens=itens,
            novo_status=payload.status,
        )
        atualizado = await db.pedidos.find_one({"_id": _oid(pedido_id)})
        return serialize(atualizado)


@router.delete("/{pedido_id}")
async def apagar_pedido(pedido_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    async with stock_lock(db):
        await _reverter_movimentos_do_pedido(db, pedido_id)
        resultado = await db.pedidos.delete_one({"_id": _oid(pedido_id)})
        if resultado.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Pedido não encontrado.")
        return {"status": "Pedido apagado."}
