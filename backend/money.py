"""Primitivas monetárias exatas para preços, frete e pagamentos.

Valores persistidos continuam sendo expostos como números decimais para manter
compatibilidade com o aplicativo e com os documentos existentes. Toda soma e
multiplicação comercial, porém, acontece em centavos inteiros.
"""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

CENTAVOS = Decimal("100")


def decimal_monetario(valor: Any) -> Decimal:
    """Converte entrada numérica em Decimal finito sem herdar erro de float."""
    try:
        convertido = Decimal(str(0 if valor is None else valor))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError("Valor monetário inválido.") from exc
    if not convertido.is_finite():
        raise ValueError("Valor monetário precisa ser finito.")
    return convertido


def valor_em_centavos(valor: Any) -> int:
    """Arredonda comercialmente para o centavo e devolve um inteiro."""
    return int(
        (decimal_monetario(valor) * CENTAVOS).quantize(
            Decimal("1"),
            rounding=ROUND_HALF_UP,
        )
    )


def centavos_em_valor(centavos: int) -> float:
    """Converte centavos para o contrato JSON legado de duas casas decimais."""
    return float((Decimal(int(centavos)) / CENTAVOS).quantize(Decimal("0.01")))


def subtotal_em_centavos(preco_unitario: Any, quantidade: int) -> int:
    """Multiplica o preço unitário já normalizado por uma quantidade inteira."""
    quantidade_inteira = int(quantidade)
    if quantidade_inteira < 0:
        raise ValueError("Quantidade monetária não pode ser negativa.")
    return valor_em_centavos(preco_unitario) * quantidade_inteira
