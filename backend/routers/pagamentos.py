"""Confirmacao automatica de pagamentos processados pela InfinitePay."""

from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from catalog_cache import invalidate_catalog_cache
from config import INFINITEPAY_HANDLE
from database import get_db
from locks import stock_lock
from payments.infinitepay import (InfinitePayError, token_webhook_valido,
                                  valor_em_centavos, verificar_pagamento)
from rate_limit import payment_rate_limit
from stock import pedido_tem_reserva_ativa, validar_estoque
from utils import pagamento_publico, serialize

router = APIRouter(prefix="/api/pagamentos", tags=["pagamentos"])


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

    esperado = valor_em_centavos(pedido.get("total", 0))
    try:
        recebido = int(verificacao.get("amount", -1))
    except (TypeError, ValueError):
        recebido = -1
    if recebido != esperado:
        raise HTTPException(
            status_code=409,
            detail="O valor confirmado não corresponde ao total do pedido.",
        )

    agora = datetime.now(timezone.utc).isoformat()
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
        "pagoEm": pagamento_atual.get("pagoEm") or agora,
    }

    # A confirmação disputa a mesma trava do cancelamento. Assim um pagamento
    # confirmado nunca perde sua reserva por uma atualização simultânea.
    async with stock_lock(db):
        atual = await db.pedidos.find_one({"_id": oid})
        if not atual:
            raise HTTPException(status_code=404, detail="Pedido não encontrado.")
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

        await db.pedidos.update_one(
            {"_id": oid},
            {
                "$set": {
                    "pagamento": pagamento_confirmado,
                    "formaPagamento": forma_pagamento,
                    "estoquePendente": estoque_pendente,
                },
            },
        )
        if atual.get("status") == "pendente":
            await db.pedidos.update_one(
                {"_id": oid, "status": "pendente"},
                {
                    "$set": {"status": "pagamento_confirmado"},
                    "$push": {
                        "historicoStatus": {
                            "status": "pagamento_confirmado",
                            "data": agora,
                        }
                    },
                },
            )

        atualizado = await db.pedidos.find_one({"_id": oid})
        invalidate_catalog_cache()
    return atualizado or pedido


@router.post("/infinitepay/webhook")
async def webhook_infinitepay(
    payload: InfinitePayWebhookIn,
    token: str = Query(default="", max_length=128),
):
    if not token_webhook_valido(payload.order_nsu, token):
        raise HTTPException(status_code=401, detail="Webhook não autorizado.")
    try:
        pedido = await _confirmar_pagamento(
            order_nsu=payload.order_nsu,
            transaction_nsu=payload.transaction_nsu,
            slug=payload.invoice_slug,
            installments=payload.installments,
            capture_method=payload.capture_method,
        )
    except HTTPException as exc:
        # A InfinitePay repete webhooks que recebem HTTP 400. Isso cobre a
        # pequena janela em que o aviso chega antes do payment_check atualizar.
        if exc.status_code in {409, 502}:
            raise HTTPException(status_code=400, detail=exc.detail) from exc
        raise
    return {"recebido": True, "pago": True, "pedidoId": str(pedido["_id"])}


@router.post("/infinitepay/confirmar", dependencies=[Depends(payment_rate_limit)])
async def confirmar_retorno_infinitepay(payload: InfinitePayConfirmacaoIn):
    pedido = await _confirmar_pagamento(
        order_nsu=payload.orderNsu,
        transaction_nsu=payload.transactionNsu,
        slug=payload.slug,
    )
    return {"pago": True, "pedido": _pedido_publico(pedido)}
