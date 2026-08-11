"""Confirmacao e conciliacao de pagamentos processados pela InfinitePay."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pymongo import ReturnDocument
from pydantic import BaseModel, Field

from audit import registrar_auditoria
from catalog_cache import invalidate_catalog_cache
from config import INFINITEPAY_HANDLE
from database import get_db
from locks import stock_lock
from payment_status import validar_operacao_pagamento
from payments.infinitepay import (InfinitePayError, token_webhook_valido,
                                  valor_em_centavos, verificar_pagamento)
from rate_limit import payment_rate_limit
from security import require_atelie_auth
from stock import pedido_tem_reserva_ativa, validar_estoque
from utils import pagamento_publico, serialize

router = APIRouter(prefix="/api/pagamentos", tags=["pagamentos"])
logger = logging.getLogger("atelie.pagamentos")

_RECONCILIATION_BATCH_SIZE = 20
_RECONCILIATION_MAX_ATTEMPTS = 8
_RECONCILIATION_INTERVAL_SECONDS = 20


class InfinitePayWebhookIn(BaseModel):
    invoice_slug: str = Field(min_length=1, max_length=300)
    amount: int | float | None = None
    paid_amount: int | float | None = None
    installments: int | None = None
    capture_method: str | None = None
    transaction_nsu: str = Field(min_length=1, max_length=300)
    order_nsu: str = Field(min_length=1, max_length=80)
    receipt_url: str | None = None
    items: list[dict] = Field(default_factory=list)


class InfinitePayConfirmacaoIn(BaseModel):
    orderNsu: str = Field(min_length=1, max_length=80)
    transactionNsu: str = Field(min_length=1, max_length=300)
    slug: str = Field(min_length=1, max_length=300)


class OperacaoFinanceiraIn(BaseModel):
    operacao: Literal[
        "solicitar_estorno",
        "confirmar_estorno",
        "registrar_contestacao",
        "resolver_contestacao_favoravel",
        "resolver_chargeback",
    ]
    motivo: str = Field(min_length=5, max_length=500)
    referencia: str = Field(default="", max_length=160)


def _webhook_event_id(order_nsu: str, transaction_nsu: str) -> str:
    return f"infinitepay:{order_nsu}:{transaction_nsu}"


def _retry_delay(attempt: int) -> int:
    """Backoff curto no inicio e limitado a quinze minutos."""
    return min(15 * (2 ** max(0, attempt - 1)), 900)


async def _registrar_webhook(payload: InfinitePayWebhookIn) -> str:
    """Persiste o aviso antes de responder ao provedor."""
    db = get_db()
    event_id = _webhook_event_id(payload.order_nsu, payload.transaction_nsu)
    agora = datetime.now(timezone.utc)
    await db.eventos_pagamento.update_one(
        {"_id": event_id},
        {
            "$setOnInsert": {
                "provedor": "infinitepay",
                "status": "pendente",
                "tentativas": 0,
                "payload": payload.model_dump(),
                "criadoEm": agora,
                "proximaTentativaEm": agora,
            },
            "$set": {"ultimoRecebimentoEm": agora},
        },
        upsert=True,
    )
    return event_id


def _pedido_publico(pedido: dict) -> dict:
    dados = serialize(pedido)
    campos = (
        "id",
        "seq",
        "codigoAcompanhamento",
        "status",
        "itens",
        "subtotal",
        "frete",
        "entrega",
        "total",
        "formaPagamento",
        "pagamento",
        "criadoEm",
        "data",
        "historicoStatus",
    )
    resposta = {campo: dados.get(campo) for campo in campos if campo in dados}
    resposta["pagamento"] = pagamento_publico(dados.get("pagamento"))
    return resposta


async def _confirmar_pagamento(
    *,
    order_nsu: str,
    transaction_nsu: str,
    slug: str,
    installments: int | None = None,
    capture_method: str | None = None,
) -> dict:
    try:
        oid = ObjectId(order_nsu)
    except InvalidId as exc:
        raise HTTPException(
            status_code=400, detail="Referência de pedido inválida."
        ) from exc

    db = get_db()
    pedido = await db.pedidos.find_one({"_id": oid})
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")
    pagamento_atual = pedido.get("pagamento") or {}
    if pagamento_atual.get("provedor") != "infinitepay":
        raise HTTPException(
            status_code=409, detail="Este pedido não usa a InfinitePay."
        )

    config_loja = await db.configuracoes.find_one({"_id": "loja"}) or {}
    handle = (
        str(config_loja.get("infinitePayHandle", "")).strip().lstrip("$")
        or INFINITEPAY_HANDLE
    )
    try:
        verificacao = await verificar_pagamento(
            handle=handle,
            order_nsu=order_nsu,
            transaction_nsu=transaction_nsu,
            slug=slug,
        )
    except InfinitePayError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if not verificacao.get("success") or not verificacao.get("paid"):
        raise HTTPException(
            status_code=409,
            detail="O pagamento ainda não foi confirmado pela InfinitePay.",
        )

    esperado = int(
        pedido.get("totalCentavos") or valor_em_centavos(pedido.get("total", 0))
    )
    try:
        recebido = int(verificacao.get("amount", -1))
    except (TypeError, ValueError):
        recebido = -1
    if recebido != esperado:
        raise HTTPException(
            status_code=409,
            detail="O valor confirmado não corresponde ao total do pedido.",
        )

    agora = datetime.now(timezone.utc)
    captura = str(
        verificacao.get("capture_method") or capture_method or "credit_card"
    ).strip()
    forma_pagamento = "pix" if captura == "pix" else "cartao"
    parcelas = verificacao.get("installments") or installments or 1
    pagamento_confirmado = {
        **pagamento_atual,
        "metodo": forma_pagamento,
        "provedor": "infinitepay",
        "status": "pago",
        "transactionNsu": transaction_nsu,
        "invoiceSlug": slug,
        "captureMethod": captura,
        "parcelas": int(parcelas),
        "valorCentavos": esperado,
        "pagoEm": pagamento_atual.get("pagoEm") or agora,
    }

    # A confirmação disputa a mesma trava do cancelamento. Assim um pagamento
    # confirmado nunca perde sua reserva por uma atualização simultânea.
    async with stock_lock(db):
        atual = await db.pedidos.find_one({"_id": oid})
        if not atual:
            raise HTTPException(status_code=404, detail="Pedido não encontrado.")
        pagamento_mais_recente = atual.get("pagamento") or {}
        if pagamento_mais_recente.get("status") == "pago":
            if pagamento_mais_recente.get("transactionNsu") == transaction_nsu:
                return atual
            logger.error(
                "duplicate_paid_transaction order_nsu=%s current=%s received=%s",
                order_nsu,
                pagamento_mais_recente.get("transactionNsu"),
                transaction_nsu,
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "PAGAMENTO_DUPLICADO",
                    "message": (
                        "O pedido já possui outro pagamento confirmado. "
                        "A transação adicional precisa de conferência e eventual estorno."
                    ),
                },
            )
        if atual.get("status") == "cancelado":
            pagamento_confirmado["observacao"] = (
                "Pagamento recebido após o cancelamento. Confira a transação e "
                "realize o estorno pela InfinitePay, se necessário."
            )

        estoque_pendente = False
        if atual.get("status") == "pendente" and not pedido_tem_reserva_ativa(atual):
            try:
                await validar_estoque(
                    db,
                    atual.get("itens", []),
                    excluir_pedido_id=oid,
                    somente_reservaveis=True,
                )
            except HTTPException as exc:
                if exc.status_code != 409:
                    raise
                # O valor já foi recebido. O pedido é confirmado e passa a
                # bloquear novas vendas, mas fica sinalizado para reposição.
                estoque_pendente = True
                pagamento_confirmado["observacao"] = (
                    "Pagamento confirmado após a reserva expirar. "
                    "É necessário repor o estoque antes de iniciar a preparação."
                )

        campos_confirmados = {
            "pagamento": pagamento_confirmado,
            "formaPagamento": forma_pagamento,
            "estoquePendente": estoque_pendente,
        }
        if atual.get("status") == "cancelado":
            campos_confirmados.update(
                {
                    "pagamentoRequerRevisao": True,
                    "motivoRevisaoPagamento": "pago_apos_cancelamento",
                }
            )
        if atual.get("status") == "pendente":
            await db.pedidos.update_one(
                {"_id": oid, "status": "pendente"},
                {
                    "$set": {**campos_confirmados, "status": "pagamento_confirmado"},
                    "$push": {
                        "historicoStatus": {
                            "status": "pagamento_confirmado",
                            "data": agora,
                        }
                    },
                },
            )
        else:
            await db.pedidos.update_one(
                {"_id": oid, "status": atual.get("status")},
                {"$set": campos_confirmados},
            )

        atualizado = await db.pedidos.find_one({"_id": oid})
        invalidate_catalog_cache()
    return atualizado or pedido


async def processar_evento_pagamento(event_id: str) -> bool:
    """Confirma um webhook duravel com claim atomico e repeticao controlada."""
    db = get_db()
    agora = datetime.now(timezone.utc)
    evento = await db.eventos_pagamento.find_one_and_update(
        {
            "_id": event_id,
            "$or": [
                {
                    "status": {"$in": ["pendente", "repetir"]},
                    "proximaTentativaEm": {"$lte": agora},
                },
                {"status": "processando", "leaseExpiraEm": {"$lte": agora}},
            ],
        },
        {
            "$set": {
                "status": "processando",
                "iniciadoEm": agora,
                "leaseExpiraEm": agora + timedelta(minutes=2),
            },
            "$inc": {"tentativas": 1},
        },
        return_document=ReturnDocument.AFTER,
    )
    if not evento:
        return False

    payload = evento.get("payload") or {}
    try:
        await _confirmar_pagamento(
            order_nsu=str(payload.get("order_nsu", "")),
            transaction_nsu=str(payload.get("transaction_nsu", "")),
            slug=str(payload.get("invoice_slug", "")),
            installments=payload.get("installments"),
            capture_method=payload.get("capture_method"),
        )
    except HTTPException as exc:
        tentativas = int(evento.get("tentativas", 1))
        codigo = exc.detail.get("code") if isinstance(exc.detail, dict) else None
        requer_revisao = codigo == "PAGAMENTO_DUPLICADO"
        deve_repetir = (
            not requer_revisao
            and exc.status_code in {409, 502}
            and tentativas < _RECONCILIATION_MAX_ATTEMPTS
        )
        atualizacao = {
            "status": (
                "revisao_manual"
                if requer_revisao
                else ("repetir" if deve_repetir else "falhou")
            ),
            "ultimoErro": str(exc.detail)[:500],
            "ultimaTentativaEm": datetime.now(timezone.utc),
        }
        if deve_repetir:
            atualizacao["proximaTentativaEm"] = datetime.now(timezone.utc) + timedelta(
                seconds=_retry_delay(tentativas)
            )
        await db.eventos_pagamento.update_one(
            {"_id": event_id, "status": "processando"},
            {"$set": atualizacao, "$unset": {"leaseExpiraEm": ""}},
        )
        logger.warning(
            "payment_reconciliation_failed event_id=%s attempt=%s retry=%s status=%s",
            event_id,
            tentativas,
            deve_repetir,
            exc.status_code,
        )
        return False
    except Exception as exc:
        tentativas = int(evento.get("tentativas", 1))
        deve_repetir = tentativas < _RECONCILIATION_MAX_ATTEMPTS
        await db.eventos_pagamento.update_one(
            {"_id": event_id, "status": "processando"},
            {
                "$set": {
                    "status": "repetir" if deve_repetir else "falhou",
                    "ultimoErro": type(exc).__name__,
                    "ultimaTentativaEm": datetime.now(timezone.utc),
                    "proximaTentativaEm": datetime.now(timezone.utc)
                    + timedelta(seconds=_retry_delay(tentativas)),
                },
                "$unset": {"leaseExpiraEm": ""},
            },
        )
        logger.exception("payment_reconciliation_error event_id=%s", event_id)
        return False

    await db.eventos_pagamento.update_one(
        {"_id": event_id},
        {
            "$set": {
                "status": "processado",
                "processadoEm": datetime.now(timezone.utc),
            },
            "$unset": {
                "ultimoErro": "",
                "proximaTentativaEm": "",
                "leaseExpiraEm": "",
            },
        },
    )
    return True


async def processar_fila_pagamentos(limit: int = _RECONCILIATION_BATCH_SIZE) -> int:
    """Retoma eventos pendentes apos reinicios e falhas temporarias."""
    db = get_db()
    agora = datetime.now(timezone.utc)
    cursor = (
        db.eventos_pagamento.find(
            {
                "$or": [
                    {
                        "status": {"$in": ["pendente", "repetir"]},
                        "proximaTentativaEm": {"$lte": agora},
                    },
                    {"status": "processando", "leaseExpiraEm": {"$lte": agora}},
                ]
            },
            {"_id": 1},
        )
        .sort("proximaTentativaEm", 1)
        .limit(max(1, min(limit, 100)))
    )
    ids = [documento["_id"] async for documento in cursor]
    resultados = await asyncio.gather(
        *(processar_evento_pagamento(event_id) for event_id in ids),
        return_exceptions=True,
    )
    return sum(resultado is True for resultado in resultados)


async def reconciliacao_pagamentos_worker() -> None:
    """Worker leve executado no mesmo processo da API."""
    while True:
        try:
            await processar_fila_pagamentos()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("payment_reconciliation_worker_failed")
        await asyncio.sleep(_RECONCILIATION_INTERVAL_SECONDS)


@router.post("/infinitepay/webhook")
async def webhook_infinitepay(
    payload: InfinitePayWebhookIn,
    background_tasks: BackgroundTasks,
    token: str = Query(default="", max_length=128),
):
    if not token_webhook_valido(payload.order_nsu, token):
        raise HTTPException(status_code=401, detail="Webhook não autorizado.")
    event_id = await _registrar_webhook(payload)
    background_tasks.add_task(processar_evento_pagamento, event_id)
    return {"success": True, "recebido": True}


@router.post("/infinitepay/confirmar", dependencies=[Depends(payment_rate_limit)])
async def confirmar_retorno_infinitepay(payload: InfinitePayConfirmacaoIn):
    pedido = await _confirmar_pagamento(
        order_nsu=payload.orderNsu,
        transaction_nsu=payload.transactionNsu,
        slug=payload.slug,
    )
    return {"pago": True, "pedido": _pedido_publico(pedido)}


@router.post("/pedidos/{pedido_id}/operacoes")
async def registrar_operacao_financeira(
    pedido_id: str,
    payload: OperacaoFinanceiraIn,
    usuario: str = Depends(require_atelie_auth),
):
    """Registra a conciliação feita no provedor sem simular movimentação bancária."""
    try:
        oid = ObjectId(pedido_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Id de pedido inválido.") from exc

    referencia = payload.referencia.strip()
    if payload.operacao in {
        "confirmar_estorno",
        "resolver_contestacao_favoravel",
        "resolver_chargeback",
    } and len(referencia) < 3:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "REFERENCIA_FINANCEIRA_OBRIGATORIA",
                "message": "Informe o protocolo, NSU ou referência exibida pelo provedor.",
            },
        )

    db = get_db()
    async with stock_lock(db):
        pedido = await db.pedidos.find_one({"_id": oid})
        if not pedido:
            raise HTTPException(status_code=404, detail="Pedido não encontrado.")
        pagamento = dict(pedido.get("pagamento") or {})
        status_anterior = str(pagamento.get("status") or "")

        # Repetir exatamente a mesma confirmação é seguro e não duplica o histórico.
        ultimo = (pagamento.get("historico") or [{}])[-1]
        if (
            ultimo.get("operacao") == payload.operacao
            and str(ultimo.get("referencia") or "") == referencia
        ):
            return serialize(pedido)

        novo_status = validar_operacao_pagamento(status_anterior, payload.operacao)
        agora = datetime.now(timezone.utc)
        evento = {
            "operacao": payload.operacao,
            "statusAnterior": status_anterior,
            "status": novo_status,
            "motivo": payload.motivo.strip(),
            "referencia": referencia,
            "ator": usuario,
            "data": agora,
        }
        pagamento["status"] = novo_status
        pagamento["historico"] = [*(pagamento.get("historico") or []), evento]
        pagamento["observacao"] = payload.motivo.strip()
        if novo_status == "estornado":
            pagamento["estornadoEm"] = agora
        elif novo_status == "chargeback_confirmado":
            pagamento["chargebackEm"] = agora

        requer_revisao = novo_status in {"estorno_solicitado", "contestado"}
        motivo_revisao = {
            "estorno_solicitado": "estorno_aguardando_confirmacao",
            "contestado": "pagamento_contestado",
        }.get(novo_status)
        campos = {
            "pagamento": pagamento,
            "pagamentoRequerRevisao": requer_revisao,
        }
        if motivo_revisao:
            campos["motivoRevisaoPagamento"] = motivo_revisao
        resultado = await db.pedidos.update_one(
            {"_id": oid, "pagamento.status": status_anterior},
            {
                "$set": campos,
                **({"$unset": {"motivoRevisaoPagamento": ""}} if not motivo_revisao else {}),
            },
        )
        if resultado.matched_count == 0:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "PAGAMENTO_ATUALIZADO_EM_OUTRA_SESSAO",
                    "message": "O pagamento mudou em outra sessão. Atualize o painel.",
                },
            )
        await registrar_auditoria(
            db,
            acao=payload.operacao,
            recurso="pagamento",
            recurso_id=pedido_id,
            titulo="Situação financeira atualizada",
            detalhes=(
                f"Pedido Nº {pedido.get('seq', 0)}: "
                f"{status_anterior} → {novo_status}."
            ),
            metadados={
                "pedidoSeq": pedido.get("seq"),
                "statusAnterior": status_anterior,
                "status": novo_status,
                "referencia": referencia,
                "ator": usuario,
            },
        )
        atualizado = await db.pedidos.find_one({"_id": oid})
        invalidate_catalog_cache()
        return serialize(atualizado)
