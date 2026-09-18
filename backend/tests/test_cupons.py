import asyncio

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from payments.infinitepay import _itens_checkout
from routers import cupons
from routers.cupons import CupomIn, CupomValidacaoIn, calcular_desconto_cupom, normalizar_codigo_cupom


def test_codigo_de_cupom_e_normalizado_e_validado():
    assert normalizar_codigo_cupom(" bem-vindo10 ") == "BEM-VINDO10"
    with pytest.raises(ValueError):
        normalizar_codigo_cupom("x")
    with pytest.raises(ValueError):
        normalizar_codigo_cupom("CUPOM INVÁLIDO")


def test_percentual_administrativo_e_limitado_a_noventa_por_cento():
    assert CupomIn(codigo="teste10", percentual=10).codigo == "TESTE10"
    with pytest.raises(ValidationError):
        CupomIn(codigo="TESTE100", percentual=100)


def test_validacao_publica_nao_revela_cupom_inativo(monkeypatch):
    class Colecao:
        async def find_one(self, query):
            if query == {"codigo": "ATIVO10", "ativo": True, "arquivadoEm": None}:
                return {"codigo": "ATIVO10", "percentual": 10, "descricao": "Campanha"}
            return None

    banco = type("Banco", (), {"cupons": Colecao()})()
    monkeypatch.setattr(cupons, "get_db", lambda: banco)

    resposta = asyncio.run(
        cupons.validar_cupom_publico(CupomValidacaoIn(codigo="ativo10"))
    )
    assert resposta == {"codigo": "ATIVO10", "percentual": 10, "descricao": "Campanha"}

    with pytest.raises(HTTPException, match="inválido ou indisponível"):
        asyncio.run(
            cupons.validar_cupom_publico(CupomValidacaoIn(codigo="pausado10"))
        )

    with pytest.raises(HTTPException, match="inválido ou indisponível"):
        asyncio.run(cupons.validar_cupom_publico(CupomValidacaoIn(codigo="   ")))


def test_desconto_percentual_incide_somente_no_subtotal_dos_perfumes():
    subtotal_centavos = 10_000
    frete_centavos = 2_451
    desconto_centavos = calcular_desconto_cupom(subtotal_centavos, 15)

    assert desconto_centavos == 1_500
    assert subtotal_centavos - desconto_centavos + frete_centavos == 10_951
    assert frete_centavos == 2_451


def test_checkout_infinitepay_mantem_frete_integral_com_cupom():
    itens = _itens_checkout(
        {
            "itens": [
                {
                    "perfumeNome": "Perfume Teste",
                    "ml": 50,
                    "quantidade": 1,
                    "precoUnitario": 100,
                }
            ],
            "frete": 24.51,
            "desconto": 15,
            "cupom": {"codigo": "BEM-VINDO15", "percentual": 15},
        },
        10_951,
    )

    assert itens == [
        {
            "quantity": 1,
            "price": 8_500,
            "description": "Perfumes com desconto - cupom BEM-VINDO15",
        },
        {"quantity": 1, "price": 2_451, "description": "Frete"},
    ]
    assert sum(item["quantity"] * item["price"] for item in itens) == 10_951
