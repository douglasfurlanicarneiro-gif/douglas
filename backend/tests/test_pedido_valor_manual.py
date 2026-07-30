import pytest
from pydantic import ValidationError

from routers.pedidos import PedidoIn


def pedido_com_valor(total: float, ajuste: float) -> PedidoIn:
    return PedidoIn(
        cliente="Cliente de teste",
        itens=[
            {
                "perfumeId": "perfume-1",
                "ml": 50,
                "quantidade": 1,
                "precoUnitario": 80,
                "subtotal": 80,
            }
        ],
        subtotalTabela=80,
        ajusteManual=ajuste,
        total=total,
    )


def test_pedido_aceita_desconto_manual_e_preserva_preco_de_tabela():
    pedido = pedido_com_valor(total=65, ajuste=-15)

    assert pedido.subtotalTabela == 80
    assert pedido.ajusteManual == -15
    assert pedido.total == 65
    assert pedido.itens[0].precoUnitario == 80
    assert pedido.itens[0].subtotal == 80


def test_pedido_rejeita_total_final_negativo():
    with pytest.raises(ValidationError):
        pedido_com_valor(total=-1, ajuste=-81)
