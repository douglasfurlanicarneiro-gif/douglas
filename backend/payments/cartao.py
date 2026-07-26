"""Cartão de crédito — ainda não integrado a nenhum gateway.

Este é o ponto de extensão combinado com você: quando escolher o gateway
(Mercado Pago, Stripe, Asaas ou PagSeguro), implemente `criar_cobranca`
chamando a API de checkout/tokenização dele. A rota de compras já está pronta
para receber o retorno — não precisa mexer em mais nada além deste arquivo.
"""
from payments.base import PaymentProvider


class CartaoProvider(PaymentProvider):
    async def criar_cobranca(self, referencia: str, valor: float):
        return {
            "metodo": "cartao",
            "status": "gateway_nao_configurado",
            "referencia": referencia,
            "valor": valor,
            "observacao": "Integração com gateway de cartão ainda não configurada.",
        }
