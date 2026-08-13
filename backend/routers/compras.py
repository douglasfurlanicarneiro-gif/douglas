import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr, Field, model_validator

from audit import registrar_auditoria
from catalog_cache import invalidate_catalog_cache
from config import INFINITEPAY_HANDLE
from database import get_db
from finance import estimar_custo_unitario, obter_config_custos
from locks import distributed_lock, stock_lock
from money import centavos_em_valor, subtotal_em_centavos, valor_em_centavos
from payments.base import PaymentProviderError
from payments.service import iniciar_pagamento
from rate_limit import checkout_rate_limit
from routers.pedidos import _persistir_pedido_e_estoque, _validar_status_estoque
from security import require_atelie_auth
from shipping.melhor_envio import MelhorEnvioError, cotar_frete
from stock import (
    RESERVATION_TTL_MINUTES,
    pedido_tem_reserva_ativa,
    validar_estoque,
)
from utils import next_seq, pagamento_publico, serialize

router = APIRouter(prefix="/api/compras", tags=["compras"])
PRAZO_ENCOMENDA_DIAS = 14
IDEMPOTENCY_LOCK_WAIT_SECONDS = 20
IDEMPOTENCY_LOCK_LEASE_SECONDS = 60


class EnderecoIn(BaseModel):
    cep: str = Field(min_length=8, max_length=9)
    endereco: str = Field(min_length=2, max_length=160)
    numero: str = Field(min_length=1, max_length=20)
    complemento: str = ""
    bairro: str = Field(min_length=2, max_length=100)
    cidade: str = Field(min_length=2, max_length=100)
    estado: str = Field(min_length=2, max_length=2)


class ItemCompraIn(BaseModel):
    perfumeId: str
    ml: int = Field(gt=0, le=1000)
    quantidade: int = Field(gt=0, le=20)


class FreteEscolhidoIn(BaseModel):
    serviceId: int = Field(gt=0)
    categoriaFrete: Optional[Literal["padrao", "prioritaria"]] = None


class CompraIn(BaseModel):
    # Campos legados continuam aceitos para não quebrar versões antigas do app.
    perfumeId: Optional[str] = None
    perfumeNome: Optional[str] = None
    ml: Optional[int] = None
    preco: Optional[float] = None
    itens: list[ItemCompraIn] = Field(default_factory=list, max_length=50)
    cliente: str = Field(min_length=2, max_length=120)
    contato: str = Field(min_length=5, max_length=160)
    observacoes: str = Field(default="", max_length=1000)
    nomeCompleto: Optional[str] = None
    telefone: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[EmailStr] = None
    endereco: Optional[EnderecoIn] = None
    formaPagamento: Optional[Literal["pix", "cartao"]] = None
    aceitePrazoEncomenda: bool = False
    aceitePoliticaPrivacidade: bool = False
    salvarDadosParaProximaCompra: bool = False
    tipoEntrega: Literal["entrega", "retirada"] = "entrega"
    freteEscolhido: Optional[FreteEscolhidoIn] = None

    @model_validator(mode="after")
    def validar_formato(self):
        if not self.itens and not (self.perfumeId and self.ml):
            raise ValueError("Adicione ao menos um item ao pedido.")
        if self.itens:
            obrigatorios = (
                self.nomeCompleto,
                self.whatsapp,
                self.email,
                self.formaPagamento,
            )
            if not all(obrigatorios):
                raise ValueError("Complete o cadastro e escolha a forma de pagamento.")
            if not self.aceitePoliticaPrivacidade:
                raise ValueError("Leia e aceite o aviso de privacidade para continuar.")
            if self.tipoEntrega == "entrega" and not (
                self.endereco and self.freteEscolhido
            ):
                raise ValueError("Informe o endereço e escolha uma opção de entrega.")
        return self


def _tem_sob_encomenda(itens: list[dict]) -> bool:
    return any(
        item.get("tipoAtendimento") == "sob_encomenda"
        or item.get("prontaEntrega") is False
        for item in itens
    )


def _validar_aceite_prazo_encomenda(
    itens: list[dict],
    aceite: bool,
    *,
    status_code: int = 400,
) -> bool:
    tem_sob_encomenda = _tem_sob_encomenda(itens)
    if tem_sob_encomenda and not aceite:
        raise HTTPException(
            status_code=status_code,
            detail=(
                "Confirme que está ciente do prazo de até "
                f"{PRAZO_ENCOMENDA_DIAS} dias para itens sob encomenda."
            ),
        )
    return tem_sob_encomenda


def _checkout_payload_hash(payload: CompraIn) -> str:
    """Identifica os dados comerciais sem persistir uma segunda cópia da PII."""
    canonical = json.dumps(
        payload.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _validar_reuso_idempotente(pedido: dict, payload_hash: str) -> None:
    if pedido.get("checkoutPayloadHash") != payload_hash:
        raise HTTPException(
            status_code=409,
            detail=(
                "Esta tentativa de checkout já foi usada com outros dados. "
                "Atualize o carrinho e tente novamente."
            ),
        )


def _compra_publica(pedido: dict) -> dict:
    """Mantém o checkout retomável sem expor identificadores do provedor."""
    resposta = serialize(pedido) or {}
    if resposta.get("pagamento"):
        resposta["pagamento"] = pagamento_publico(resposta["pagamento"])
    return resposta


def _configuracao_pagamento_do_pedido(pedido: dict, config_loja: dict) -> dict:
    """Reconstrói o checkout somente com o snapshot persistido no pedido."""
    endereco = pedido.get("endereco") or {}
    return {
        "pix": config_loja.get("pix", ""),
        "nomeLoja": config_loja.get("nomeLoja", "L’Essence Furlani"),
        "infinitePayHandle": config_loja.get("infinitePayHandle", ""),
        "itens": list(pedido.get("itens") or []),
        "frete": pedido.get("frete", 0),
        "cliente": {
            "nome": pedido.get("nomeCompleto") or pedido.get("cliente", ""),
            "email": str(pedido.get("email") or ""),
            "telefone": (
                pedido.get("whatsapp")
                or pedido.get("telefone")
                or pedido.get("contato", "")
            ),
        },
        "endereco": dict(endereco) if isinstance(endereco, dict) else {},
    }


async def _assegurar_pagamento_checkout(db, pedido: dict) -> dict:
    """Cria ou retoma o pagamento idempotente de um pedido persistido."""
    forma_pagamento = pedido.get("formaPagamento")
    pagamento_atual = pedido.get("pagamento") or {}
    if not forma_pagamento or pagamento_atual.get("status") in {
        "aguardando_pagamento",
        "pago",
    }:
        return pedido
    if pedido.get("status") != "pendente":
        raise HTTPException(
            status_code=409,
            detail="Somente pedidos aguardando pagamento podem retomar o checkout.",
        )

    oid = pedido["_id"]
    # Antes de gerar outro link, uma reserva expirada volta a disputar o saldo.
    # Isso evita cobrar por um item que já tenha sido vendido nesse intervalo.
    if pedido.get("status") == "pendente" and not pedido_tem_reserva_ativa(pedido):
        async with stock_lock(db):
            atual = await db.pedidos.find_one({"_id": oid})
            if not atual:
                raise HTTPException(status_code=404, detail="Pedido não encontrado.")
            if not pedido_tem_reserva_ativa(atual):
                await validar_estoque(
                    db,
                    atual.get("itens", []),
                    excluir_pedido_id=oid,
                    somente_reservaveis=True,
                )
                nova_expiracao = datetime.now(timezone.utc) + timedelta(
                    minutes=RESERVATION_TTL_MINUTES
                )
                await db.pedidos.update_one(
                    {"_id": oid, "status": "pendente"},
                    {"$set": {"reservaExpiraEm": nova_expiracao}},
                )
                atual["reservaExpiraEm"] = nova_expiracao
            pedido = atual

    agora = datetime.now(timezone.utc)
    await db.pedidos.update_one(
        {"_id": oid},
        {
            "$set": {
                "checkoutEstado": "processando_pagamento",
                "checkoutUltimaTentativaEm": agora,
            },
            "$inc": {"checkoutTentativas": 1},
            "$unset": {"checkoutUltimoErro": ""},
        },
    )
    config_loja = await db.configuracoes.find_one({"_id": "loja"}) or {}
    total_centavos = int(
        pedido.get("totalCentavos") or valor_em_centavos(pedido.get("total", 0))
    )
    try:
        pagamento = await iniciar_pagamento(
            str(forma_pagamento),
            str(oid),
            centavos_em_valor(total_centavos),
            _configuracao_pagamento_do_pedido(pedido, config_loja),
        )
    except PaymentProviderError as exc:
        await db.pedidos.update_one(
            {"_id": oid},
            {
                "$set": {
                    "checkoutEstado": "pagamento_falhou",
                    "checkoutUltimoErro": type(exc).__name__,
                    "checkoutFalhouEm": datetime.now(timezone.utc),
                }
            },
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    pagamento["valorCentavos"] = total_centavos
    await db.pedidos.update_one(
        {"_id": oid},
        {
            "$set": {
                "pagamento": pagamento,
                "checkoutEstado": "concluido",
                "checkoutConcluidoEm": datetime.now(timezone.utc),
            },
            "$unset": {"checkoutUltimoErro": "", "checkoutFalhouEm": ""},
        },
    )
    return await db.pedidos.find_one({"_id": oid}) or {
        **pedido,
        "pagamento": pagamento,
    }


@router.get("")
async def listar_compras(_: str = Depends(require_atelie_auth)):
    db = get_db()
    compras = (
        await db.compras.find({"arquivadoEm": None}).sort("data", -1).to_list(2000)
    )
    return [serialize(c) for c in compras]


@router.post("", dependencies=[Depends(checkout_rate_limit)])
async def criar_compra(
    payload: CompraIn,
    idempotency_key: str = Header(
        ...,
        alias="Idempotency-Key",
        min_length=16,
        max_length=128,
        pattern=r"^[A-Za-z0-9._:-]+$",
    ),
):
    db = get_db()
    payload_hash = _checkout_payload_hash(payload)
    lock_suffix = hashlib.sha256(idempotency_key.encode("utf-8")).hexdigest()
    async with distributed_lock(
        db,
        f"checkout:{lock_suffix}",
        wait_seconds=IDEMPOTENCY_LOCK_WAIT_SECONDS,
        lease_seconds=IDEMPOTENCY_LOCK_LEASE_SECONDS,
        busy_detail=(
            "Este pedido ainda está sendo processado. "
            "Aguarde alguns segundos e tente novamente."
        ),
    ):
        existente = await db.pedidos.find_one(
            {"checkoutIdempotencyKey": idempotency_key}
        )
        if existente:
            _validar_reuso_idempotente(existente, payload_hash)
            existente = await _assegurar_pagamento_checkout(db, existente)
            return _compra_publica(existente)
        return await _criar_compra(
            payload,
            idempotency_key=idempotency_key,
            payload_hash=payload_hash,
        )


async def _criar_compra(
    payload: CompraIn,
    *,
    idempotency_key: str | None = None,
    payload_hash: str | None = None,
):
    db = get_db()
    itens_entrada = payload.itens or [
        ItemCompraIn(
            perfumeId=payload.perfumeId or "", ml=payload.ml or 0, quantidade=1
        )
    ]

    ids: list[ObjectId] = []
    try:
        ids = [ObjectId(item.perfumeId) for item in itens_entrada]
    except InvalidId:
        raise HTTPException(
            status_code=400, detail="Um dos produtos possui id inválido."
        )

    perfumes = await db.perfumes.find({"_id": {"$in": ids}}).to_list(len(ids))
    perfumes_por_id = {str(p["_id"]): p for p in perfumes}
    config_custos = await obter_config_custos(db)
    itens_doc = []
    subtotal_centavos = 0
    for item in itens_entrada:
        perfume = perfumes_por_id.get(item.perfumeId)
        if not perfume or perfume.get("publicavel") is False:
            raise HTTPException(
                status_code=404, detail="Produto não encontrado na vitrine."
            )
        opcao = next(
            (p for p in perfume.get("precos", []) if p.get("ml") == item.ml), None
        )
        if not opcao or valor_em_centavos(opcao.get("preco", 0)) <= 0:
            raise HTTPException(
                status_code=400, detail=f"Tamanho indisponível para {perfume['nome']}."
            )
        preco_unitario_centavos = valor_em_centavos(opcao["preco"])
        preco_unitario = centavos_em_valor(preco_unitario_centavos)
        subtotal_centavos_item = subtotal_em_centavos(
            preco_unitario,
            item.quantidade,
        )
        subtotal = centavos_em_valor(subtotal_centavos_item)
        subtotal_centavos += subtotal_centavos_item
        calculo_custo = estimar_custo_unitario(
            perfume, item.ml, preco_unitario, config_custos
        )
        itens_doc.append(
            {
                "perfumeId": item.perfumeId,
                "perfumeNome": perfume["nome"],
                "ml": item.ml,
                "quantidade": item.quantidade,
                "precoUnitario": preco_unitario,
                "precoUnitarioCentavos": preco_unitario_centavos,
                "subtotal": subtotal,
                "subtotalCentavos": subtotal_centavos_item,
                "custoUnitarioEstimado": float(calculo_custo["custoTotal"]),
                "lucroUnitarioEstimado": float(calculo_custo["lucro"]),
                "prontaEntrega": perfume.get("prontaEntrega") is True,
                "tipoAtendimento": (
                    "pronta_entrega"
                    if perfume.get("prontaEntrega") is True
                    else "sob_encomenda"
                ),
            }
        )

    _validar_aceite_prazo_encomenda(
        itens_doc,
        payload.aceitePrazoEncomenda,
    )

    doc = payload.model_dump(
        exclude={
            "perfumeId",
            "perfumeNome",
            "ml",
            "preco",
            "itens",
            "freteEscolhido",
        }
    )
    doc["itens"] = itens_doc
    doc["subtotal"] = centavos_em_valor(subtotal_centavos)
    doc["subtotalCentavos"] = subtotal_centavos
    doc["frete"] = 0.0
    doc["freteCentavos"] = 0
    doc["entrega"] = None
    if payload.tipoEntrega == "entrega" and payload.freteEscolhido:
        if not payload.endereco:
            raise HTTPException(
                status_code=400, detail="Informe o endereço de entrega."
            )
        try:
            opcoes_frete = await cotar_frete(
                db,
                cep_destino=payload.endereco.cep,
                itens=itens_doc,
            )
        except MelhorEnvioError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        escolha = next(
            (
                opcao
                for opcao in opcoes_frete
                if opcao["serviceId"] == payload.freteEscolhido.serviceId
                and (
                    payload.freteEscolhido.categoriaFrete is None
                    or opcao.get("categoriaFrete") == payload.freteEscolhido.categoriaFrete
                )
            ),
            None,
        )
        if not escolha:
            raise HTTPException(
                status_code=400,
                detail=(
                    "A opção de entrega escolhida não está mais disponível. "
                    "Calcule novamente."
                ),
            )
        nome_exibicao = escolha.get("nomeExibicao", "Entrega Padrão")
        frete_centavos = valor_em_centavos(escolha["preco"])
        doc["frete"] = centavos_em_valor(frete_centavos)
        doc["freteCentavos"] = frete_centavos
        doc["entrega"] = {
            **escolha,
            "tipo": "entrega",
            "nomeExibicao": nome_exibicao,
            "preco": doc["frete"],
            "precoCentavos": frete_centavos,
        }
    elif payload.tipoEntrega == "retirada":
        doc["endereco"] = None
        doc["entrega"] = {
            "tipo": "retirada",
            "nomeExibicao": "Retirada Combinada",
            "serviceId": 0,
            "transportadora": "Retirada combinada",
            "servico": "Grátis",
            "precoTransportadora": 0.0,
            "taxaEmbalagem": 0.0,
            "preco": 0.0,
            "prazoDias": 0,
        }
    doc["total"] = centavos_em_valor(
        subtotal_centavos + valor_em_centavos(doc["frete"])
    )
    doc["totalCentavos"] = subtotal_centavos + int(doc["freteCentavos"])
    agora = datetime.now(timezone.utc)
    doc["data"] = agora
    doc["criadoEm"] = agora
    doc["status"] = "pendente"
    doc["origem"] = "vitrine"
    doc["reservaExpiraEm"] = datetime.now(timezone.utc) + timedelta(
        minutes=RESERVATION_TTL_MINUTES
    )
    doc["codigoAcompanhamento"] = secrets.token_urlsafe(12)
    doc["historicoStatus"] = [{"status": "pendente", "data": agora}]
    if payload.aceitePoliticaPrivacidade:
        doc["aceitePoliticaPrivacidadeEm"] = agora
        doc["versaoPoliticaPrivacidade"] = "2026-08-09"
    if idempotency_key and payload_hash:
        doc["checkoutIdempotencyKey"] = idempotency_key
        doc["checkoutPayloadHash"] = payload_hash
        doc["checkoutEstado"] = (
            "processando_pagamento" if payload.formaPagamento else "concluido"
        )

    config_loja = await db.configuracoes.find_one({"_id": "loja"}) or {}
    if payload.formaPagamento == "cartao" and not (
        str(config_loja.get("infinitePayHandle", "")).strip().lstrip("$")
        or INFINITEPAY_HANDLE
    ):
        raise HTTPException(
            status_code=503,
            detail="O pagamento por cartão ainda não foi ativado pela loja.",
        )

    # Salva/atualiza o cadastro do cliente por telefone/whatsapp, pra próxima
    # compra vir com os campos pré-preenchidos (o app consulta isso por
    # GET /api/clientes/por-contato/{contato} antes de abrir o formulário).
    identificador = payload.whatsapp or payload.contato
    if payload.salvarDadosParaProximaCompra and payload.nomeCompleto and identificador:
        dados_cliente: dict[str, object] = {
            "contato": identificador,
            "nomeCompleto": payload.nomeCompleto,
            "telefone": payload.telefone or payload.whatsapp,
            "whatsapp": payload.whatsapp,
            "email": payload.email,
            "atualizadoEm": agora,
            "consentimentoCadastroEm": agora,
            "versaoConsentimento": "2026-08-09",
        }
        if payload.endereco:
            dados_cliente["endereco"] = payload.endereco.model_dump()
        await db.clientes.update_one(
            {"contato": identificador},
            {"$set": dados_cliente},
            upsert=True,
        )

    # Uma compra feita na vitrine é um pedido de verdade. Ela entra diretamente
    # na coleção `pedidos`, usada pela aba Pedidos e pelo dashboard. A coleção
    # `compras` permanece somente para registros legados criados por versões
    # anteriores do aplicativo.
    # A validação e a criação do pedido acontecem sob a mesma trava
    # distribuída. O próprio documento pendente passa a representar a reserva.
    async with stock_lock(db):
        # A modalidade pode ter sido alterada no painel enquanto o cliente
        # preenchia o checkout. A decisão final usa sempre o estado mais novo.
        perfumes_atuais = await db.perfumes.find(
            {"_id": {"$in": ids}},
            {"prontaEntrega": 1, "publicavel": 1},
        ).to_list(len(ids))
        atuais_por_id = {str(item["_id"]): item for item in perfumes_atuais}
        for item in itens_doc:
            atual = atuais_por_id.get(item["perfumeId"])
            if not atual or atual.get("publicavel") is False:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Um produto foi atualizado. Reabra o carrinho e "
                        "tente novamente."
                    ),
                )
            pronta = atual.get("prontaEntrega") is True
            item["prontaEntrega"] = pronta
            item["tipoAtendimento"] = "pronta_entrega" if pronta else "sob_encomenda"
        tem_sob_encomenda = _validar_aceite_prazo_encomenda(
            itens_doc,
            payload.aceitePrazoEncomenda,
            status_code=409,
        )
        doc["temSobEncomenda"] = tem_sob_encomenda
        doc["prazoEncomendaDias"] = PRAZO_ENCOMENDA_DIAS if tem_sob_encomenda else 0
        doc["aceitePrazoEncomenda"] = (
            bool(payload.aceitePrazoEncomenda) if tem_sob_encomenda else False
        )
        doc["aceitePrazoEncomendaEm"] = doc["criadoEm"] if tem_sob_encomenda else None
        await validar_estoque(
            db,
            itens_doc,
            somente_reservaveis=True,
        )
        doc["seq"] = await next_seq(db, "pedidos")
        resultado = await db.pedidos.insert_one(doc)
        invalidate_catalog_cache()
    # O pedido pendente reserva a quantidade no resumo, sem alterar o saldo
    # físico. A saída será lançada quando o status mudar para "preparando".

    if payload.formaPagamento:
        doc = await _assegurar_pagamento_checkout(
            db,
            await db.pedidos.find_one({"_id": resultado.inserted_id}) or doc,
        )

    nova = await db.pedidos.find_one({"_id": resultado.inserted_id}) or doc
    invalidate_catalog_cache()
    return _compra_publica(nova)


class CompraStatusIn(BaseModel):
    status: Literal[
        "pendente",
        "pagamento_confirmado",
        "preparando",
        "pronto",
        "enviado",
        "entregue",
        "cancelado",
    ]


@router.patch("/{compra_id}")
async def atualizar_status_compra(
    compra_id: str, payload: CompraStatusIn, _: str = Depends(require_atelie_auth)
):
    db = get_db()
    async with stock_lock(db):
        try:
            oid = ObjectId(compra_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Id de compra inválido.")

        legado = await db.compras.find_one({"_id": oid})
        if legado:
            await db.compras.update_one(
                {"_id": oid},
                {"$set": {"status": payload.status}},
            )
            return serialize(await db.compras.find_one({"_id": oid}))

        pedido = await db.pedidos.find_one({"_id": oid, "origem": "vitrine"})
        if not pedido:
            raise HTTPException(
                status_code=404,
                detail="Pedido de compra não encontrado.",
            )
        itens = list(pedido.get("itens", []))
        await _validar_status_estoque(
            db,
            itens=itens,
            status=payload.status,
            pedido_id=compra_id,
            pedido_anterior=pedido,
        )
        atualizacao = {"status": payload.status}
        await _persistir_pedido_e_estoque(
            db,
            pedido_id=compra_id,
            existente=pedido,
            atualizacao=atualizacao,
            itens=itens,
            novo_status=payload.status,
        )
        invalidate_catalog_cache()
        return serialize(await db.pedidos.find_one({"_id": oid}))


@router.delete("/{compra_id}")
async def apagar_compra(compra_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    try:
        oid = ObjectId(compra_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de compra inválido.")
    async with stock_lock(db):
        agora = datetime.now(timezone.utc)
        resultado = await db.compras.update_one(
            {"_id": oid, "arquivadoEm": None},
            {"$set": {"arquivadoEm": agora, "arquivadoPor": "administrador"}},
        )
        if resultado.matched_count == 0:
            pedido = await db.pedidos.find_one({"_id": oid, "origem": "vitrine"})
            if not pedido:
                raise HTTPException(
                    status_code=404, detail="Pedido de compra não encontrado."
                )
            if pedido.get("status") not in {"cancelado", "entregue"}:
                raise HTTPException(
                    status_code=409,
                    detail="Cancele ou conclua o pedido antes de arquivá-lo.",
                )
            await db.pedidos.update_one(
                {"_id": oid, "arquivadoEm": None},
                {"$set": {"arquivadoEm": agora, "arquivadoPor": "administrador"}},
            )
        await registrar_auditoria(
            db,
            acao="arquivar",
            recurso="compra",
            recurso_id=compra_id,
            titulo="Compra arquivada",
            detalhes="Registro retirado do fluxo ativo com histórico preservado.",
        )
        invalidate_catalog_cache()
    return {"status": "Pedido de compra arquivado."}
