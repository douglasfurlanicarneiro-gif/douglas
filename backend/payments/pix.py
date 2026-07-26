"""Pix — implementação inicial, sem PSP real ainda ligado.

O que já funciona hoje: ao escolher Pix no fechamento do pedido, o app recebe
de volta uma cobrança com status "aguardando_confirmacao_manual" e um
identificador único. O Ateliê confirma o recebimento manualmente no painel de
Pedidos (mudando o status), o mesmo fluxo que já existe hoje.

Quando você tiver conta em um PSP (Mercado Pago, Efí/Gerencianet, Asaas...),
troque só o corpo de `criar_cobranca` pela chamada real à API do PSP — devolva
o QR Code / "Pix copia e cola" retornado por ele no mesmo formato de
dicionário. Nenhuma rota do backend nem tela do app precisa mudar.
"""
import uuid
from datetime import datetime, timezone

from payments.base import PaymentProvider


class PixProvider(PaymentProvider):
    async def criar_cobranca(self, referencia: str, valor: float):
        return {
            "metodo": "pix",
            "status": "aguardando_confirmacao_manual",
            "referencia": referencia,
            "valor": valor,
            "cobrancaId": f"pix_{uuid.uuid4().hex[:12]}",
            "criadoEm": datetime.now(timezone.utc).isoformat(),
            "observacao": (
                "Pix ainda não integrado a um PSP real — confirme o "
                "recebimento manualmente no painel de Pedidos."
            ),
        }
