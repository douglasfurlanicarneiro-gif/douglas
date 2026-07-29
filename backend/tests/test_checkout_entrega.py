import pytest
from pydantic import ValidationError

from routers.compras import CompraIn


def payload_base():
    return {
        "itens": [
            {
                "perfumeId": "507f1f77bcf86cd799439011",
                "ml": 50,
                "quantidade": 1,
            }
        ],
        "cliente": "Cliente Teste",
        "contato": "11999999999",
        "nomeCompleto": "Cliente Teste",
        "whatsapp": "11999999999",
        "email": "cliente@example.com",
        "formaPagamento": "pix",
    }


def test_retirada_nao_exige_endereco_nem_frete():
    compra = CompraIn(**payload_base(), tipoEntrega="retirada")

    assert compra.tipoEntrega == "retirada"
    assert compra.endereco is None
    assert compra.freteEscolhido is None


def test_entrega_exige_endereco_e_opcao_de_frete():
    with pytest.raises(ValidationError, match="endereço"):
        CompraIn(**payload_base(), tipoEntrega="entrega")


def test_checkout_rejeita_email_incompleto():
    payload = payload_base()
    payload["email"] = "@"

    with pytest.raises(ValidationError):
        CompraIn(**payload, tipoEntrega="retirada")


def test_entrega_aceita_endereco_e_frete():
    compra = CompraIn(
        **payload_base(),
        tipoEntrega="entrega",
        endereco={
            "cep": "03630010",
            "endereco": "Rua Cirino de Abreu",
            "numero": "10",
            "complemento": "",
            "bairro": "Guaiaúna",
            "cidade": "São Paulo",
            "estado": "SP",
        },
        freteEscolhido={"serviceId": 3},
    )

    assert compra.tipoEntrega == "entrega"
    assert compra.freteEscolhido.serviceId == 3
