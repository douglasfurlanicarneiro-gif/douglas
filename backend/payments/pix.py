"""Pix manual no PicPay.

O BR Code é gerado no servidor com a chave Pix e o valor exato do pedido.
O recebimento continua sendo confirmado manualmente no painel. Quando houver
um PSP com API, esta classe pode ser substituída sem alterar o checkout.
"""
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
import unicodedata

from payments.base import PaymentProvider


PIX_KEY = os.getenv("PIX_KEY", "douglasfurlanicarneiro@gmail.com").strip()
PIX_RECEIVER_NAME = os.getenv("PIX_RECEIVER_NAME", "L ESSENCE FURLANI").strip()
PIX_RECEIVER_CITY = os.getenv("PIX_RECEIVER_CITY", "SAO PAULO").strip()


def _tlv(tag: str, value: str) -> str:
    return f"{tag}{len(value):02d}{value}"


def _pix_text(value: str, maximum: int) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_value.upper().split())[:maximum]


def _crc16(payload: str) -> str:
    crc = 0xFFFF
    for byte in payload.encode("utf-8"):
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return f"{crc:04X}"


def criar_pix_copia_e_cola(referencia: str, valor: float) -> str:
    if not PIX_KEY:
        raise RuntimeError("Configure PIX_KEY para habilitar o Pix manual.")

    txid = "".join(char for char in referencia.upper() if char.isalnum())[:25] or "***"
    merchant_account = _tlv("00", "BR.GOV.BCB.PIX") + _tlv("01", PIX_KEY)
    payload = "".join([
        _tlv("00", "01"),
        _tlv("01", "11"),
        _tlv("26", merchant_account),
        _tlv("52", "0000"),
        _tlv("53", "986"),
        _tlv("54", f"{Decimal(str(valor)):.2f}"),
        _tlv("58", "BR"),
        _tlv("59", _pix_text(PIX_RECEIVER_NAME, 25)),
        _tlv("60", _pix_text(PIX_RECEIVER_CITY, 15)),
        _tlv("62", _tlv("05", txid)),
    ])
    payload_com_crc = f"{payload}6304"
    return f"{payload_com_crc}{_crc16(payload_com_crc)}"


class PixProvider(PaymentProvider):
    async def criar_cobranca(self, referencia: str, valor: float):
        copia_e_cola = criar_pix_copia_e_cola(referencia, valor)
        return {
            "metodo": "pix",
            "status": "aguardando_confirmacao_manual",
            "referencia": referencia,
            "valor": valor,
            "cobrancaId": f"pix_{uuid.uuid4().hex[:12]}",
            "pixCopiaECola": copia_e_cola,
            "recebedor": PIX_RECEIVER_NAME,
            "instituicao": "PicPay",
            "criadoEm": datetime.now(timezone.utc).isoformat(),
            "observacao": (
                "Aguardando pagamento via Pix. Confirme o recebimento "
                "manualmente no painel de Pedidos."
            ),
        }
