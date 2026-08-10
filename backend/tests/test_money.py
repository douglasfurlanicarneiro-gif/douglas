from decimal import Decimal

import pytest

from money import centavos_em_valor, subtotal_em_centavos, valor_em_centavos


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        (0.1 + 0.2, 30),
        ("24.505", 2451),
        (Decimal("19.994"), 1999),
        (160, 16000),
        (None, 0),
    ],
)
def test_valor_em_centavos_elimina_erros_de_float(valor, esperado):
    assert valor_em_centavos(valor) == esperado


def test_total_de_checkout_e_soma_exata_em_centavos():
    produtos = subtotal_em_centavos("0.10", 3)
    frete = valor_em_centavos("24.51")

    assert produtos == 30
    assert centavos_em_valor(produtos + frete) == 24.81


@pytest.mark.parametrize("valor", [float("nan"), float("inf"), "infinito"])
def test_valor_monetario_invalido_e_rejeitado(valor):
    with pytest.raises(ValueError, match="monetário"):
        valor_em_centavos(valor)
