"""Interface comum a qualquer gateway de pagamento.

Trocar de provedor no futuro (Mercado Pago, Stripe, Asaas, PagSeguro...)
significa só criar uma nova classe que implemente `criar_cobranca` — nenhuma
rota, tela ou lógica de pedido precisa mudar.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict


class PaymentProvider(ABC):
    @abstractmethod
    async def criar_cobranca(self, referencia: str, valor: float) -> Dict[str, Any]:
        """Inicia uma cobrança para `referencia` (id do pedido/compra) no
        valor informado. Deve devolver um dicionário serializável contendo
        pelo menos: metodo, status, referencia."""
        ...
