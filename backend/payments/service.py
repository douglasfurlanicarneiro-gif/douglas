"""Ponto único que as rotas chamam — não conhecem Pix nem cartão diretamente."""
from payments.cartao import CartaoProvider
from payments.pix import PixProvider

_PROVIDERS = {
    "pix": PixProvider(),
    "cartao": CartaoProvider(),
}


async def iniciar_pagamento(
    metodo: str,
    referencia: str,
    valor: float,
    configuracao: dict | None = None,
) -> dict:
    provider = _PROVIDERS.get(metodo)
    if not provider:
        return {"metodo": metodo, "status": "metodo_desconhecido", "referencia": referencia}
    return await provider.criar_cobranca(referencia, valor, configuracao)
