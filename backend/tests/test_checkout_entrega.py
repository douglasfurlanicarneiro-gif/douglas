import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from routers.compras import (
    PRAZO_ENCOMENDA_DIAS,
    CompraIn,
    _validar_aceite_prazo_encomenda,
)


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


def test_sob_encomenda_exige_confirmacao_do_prazo():
    itens = [{"tipoAtendimento": "sob_encomenda", "prontaEntrega": False}]

    with pytest.raises(HTTPException, match=f"{PRAZO_ENCOMENDA_DIAS} dias"):
        _validar_aceite_prazo_encomenda(itens, False)


def test_sob_encomenda_aceita_confirmacao_e_pronta_entrega_nao_exige():
    itens_encomenda = [
        {"tipoAtendimento": "sob_encomenda", "prontaEntrega": False},
    ]
    itens_pronta = [
        {"tipoAtendimento": "pronta_entrega", "prontaEntrega": True},
    ]

    assert _validar_aceite_prazo_encomenda(itens_encomenda, True) is True
    assert _validar_aceite_prazo_encomenda(itens_pronta, False) is False
