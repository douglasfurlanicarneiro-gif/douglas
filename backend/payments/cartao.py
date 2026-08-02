"""Compatibilidade do servico de cartao com o checkout da InfinitePay."""

from payments.infinitepay import InfinitePayProvider


class CartaoProvider(InfinitePayProvider):
    """Mantem o nome historico usado pelo servico de pagamentos."""

    pass
