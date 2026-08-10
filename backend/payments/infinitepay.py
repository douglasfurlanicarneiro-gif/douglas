"""Checkout hospedado e confirmacao de pagamentos da InfinitePay.

O sistema nunca recebe numero, validade ou codigo de seguranca do cartao. Esses
dados sao digitados somente no ambiente da InfinitePay. Um pagamento so e
aceito depois da consulta server-to-server em ``payment_check``.
"""

import asyncio
import hashlib
import hmac
from typing import Any
from urllib.parse import urlparse

import requests

from config import (
    INFINITEPAY_API_URL,
    INFINITEPAY_HANDLE,
    INFINITEPAY_WEBHOOK_SECRET,
    PUBLIC_API_URL,
    STOREFRONT_URL,
)
from money import valor_em_centavos
from payments.base import PaymentProvider, PaymentProviderError


class InfinitePayError(PaymentProviderError):
    pass


def normalizar_handle(valor: str | None) -> str:
    return (valor or "").strip().lstrip("$").strip()


def normalizar_telefone(valor: str | None) -> str:
    """Converte celular brasileiro para o formato internacional aceito no checkout."""
    digitos = "".join(caractere for caractere in (valor or "") if caractere.isdigit())
    if len(digitos) in {10, 11}:
        digitos = f"55{digitos}"
    if len(digitos) in {12, 13} and digitos.startswith("55"):
        return f"+{digitos}"
    return ""


def _token_webhook(referencia: str) -> str:
    if not INFINITEPAY_WEBHOOK_SECRET:
        raise InfinitePayError(
            "A assinatura do webhook da InfinitePay ainda nao foi configurada."
        )
    segredo = INFINITEPAY_WEBHOOK_SECRET.encode("utf-8")
    return hmac.new(segredo, referencia.encode("utf-8"), hashlib.sha256).hexdigest()


def token_webhook_valido(referencia: str, token: str) -> bool:
    return bool(token) and hmac.compare_digest(_token_webhook(referencia), token)


def _checkout_url_valida(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and (
        host == "infinitepay.com.br"
        or host.endswith(".infinitepay.com.br")
        or host == "infinitepay.io"
        or host.endswith(".infinitepay.io")
    )


async def _post_json(caminho: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{INFINITEPAY_API_URL}/{caminho.lstrip('/')}"

    def enviar() -> requests.Response:
        return requests.post(url, json=payload, timeout=15)

    try:
        resposta = await asyncio.to_thread(enviar)
    except requests.RequestException as exc:
        raise InfinitePayError(
            "A InfinitePay nao respondeu. Aguarde um instante e tente novamente."
        ) from exc

    if resposta.status_code < 200 or resposta.status_code >= 300:
        if caminho.strip("/") == "links" and resposta.status_code in {400, 401, 403}:
            raise InfinitePayError(
                "A InfinitePay recusou a criação do checkout. Confira se o "
                "Checkout Integrado está habilitado na sua conta e se a "
                "InfiniteTag foi digitada corretamente."
            )
        raise InfinitePayError(
            "Não foi possível iniciar ou confirmar o pagamento na InfinitePay."
        )
    try:
        dados = resposta.json()
    except ValueError as exc:
        raise InfinitePayError("A InfinitePay devolveu uma resposta invalida.") from exc
    if not isinstance(dados, dict):
        raise InfinitePayError("A InfinitePay devolveu uma resposta invalida.")
    return dados


def _itens_checkout(
    configuracao: dict[str, Any], total_centavos: int
) -> list[dict[str, Any]]:
    itens: list[dict[str, Any]] = []
    for item in configuracao.get("itens", []):
        quantidade = max(1, int(item.get("quantidade", 1)))
        preco = valor_em_centavos(item.get("precoUnitario", 0))
        if preco <= 0:
            continue
        descricao = f"{item.get('perfumeNome', 'Perfume')} - {item.get('ml', '')}ml"
        itens.append(
            {
                "quantity": quantidade,
                "price": preco,
                "description": descricao[:120],
            }
        )

    frete = valor_em_centavos(configuracao.get("frete", 0))
    if frete > 0:
        itens.append({"quantity": 1, "price": frete, "description": "Frete"})

    soma = sum(item["quantity"] * item["price"] for item in itens)
    if not itens or soma != total_centavos:
        # Protecao contra divergencias de arredondamento ou pedidos legados.
        return [
            {
                "quantity": 1,
                "price": total_centavos,
                "description": "Pedido L'Essence Furlani",
            }
        ]
    return itens


class InfinitePayProvider(PaymentProvider):
    async def criar_cobranca(self, referencia: str, valor: float, configuracao=None):
        configuracao = configuracao or {}
        handle = normalizar_handle(
            configuracao.get("infinitePayHandle") or INFINITEPAY_HANDLE
        )
        if not handle:
            raise InfinitePayError(
                "O pagamento por cartao ainda nao foi ativado pela loja."
            )

        total_centavos = valor_em_centavos(valor)
        cliente = configuracao.get("cliente") or {}
        endereco = configuracao.get("endereco") or {}
        token = _token_webhook(referencia)
        payload: dict[str, Any] = {
            "handle": handle,
            "items": _itens_checkout(configuracao, total_centavos),
            "order_nsu": referencia,
            "redirect_url": f"{STOREFRONT_URL}/?pagamento=infinitepay",
            "webhook_url": (
                f"{PUBLIC_API_URL}/api/pagamentos/infinitepay/webhook?token={token}"
            ),
        }
        customer = {
            "name": str(cliente.get("nome", "")).strip(),
            "email": str(cliente.get("email", "")).strip(),
            "phone_number": normalizar_telefone(str(cliente.get("telefone", ""))),
        }
        if all(customer.values()):
            payload["customer"] = customer
        if endereco:
            payload["address"] = {
                "cep": str(endereco.get("cep", "")).replace("-", ""),
                "street": str(endereco.get("endereco", "")).strip(),
                "neighborhood": str(endereco.get("bairro", "")).strip(),
                "number": str(endereco.get("numero", "")).strip(),
                "complement": str(endereco.get("complemento", "")).strip(),
            }

        resposta = await _post_json("links", payload)
        checkout_url = str(resposta.get("url", "")).strip()
        if not _checkout_url_valida(checkout_url):
            raise InfinitePayError("A InfinitePay nao devolveu um checkout seguro.")
        return {
            "metodo": "cartao",
            "provedor": "infinitepay",
            "status": "aguardando_pagamento",
            "referencia": referencia,
            "orderNsu": referencia,
            "valor": round(float(valor), 2),
            "checkoutUrl": checkout_url,
            "observacao": "Pagamento processado no ambiente seguro da InfinitePay.",
        }


async def verificar_pagamento(
    *,
    handle: str,
    order_nsu: str,
    transaction_nsu: str,
    slug: str,
) -> dict[str, Any]:
    handle_normalizado = normalizar_handle(handle or INFINITEPAY_HANDLE)
    if not handle_normalizado:
        raise InfinitePayError("InfinitePay nao configurada.")
    return await _post_json(
        "payment_check",
        {
            "handle": handle_normalizado,
            "order_nsu": order_nsu,
            "transaction_nsu": transaction_nsu,
            "slug": slug,
        },
    )
