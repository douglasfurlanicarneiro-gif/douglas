import pytest
from fastapi import HTTPException

from routers.movimentos import calcular_ajuste_contagem, validar_saida_disponivel


def test_contagem_maior_gera_entrada():
    assert calcular_ajuste_contagem(700, 850) == ("entrada", 150)


def test_contagem_menor_gera_saida():
    assert calcular_ajuste_contagem(700, 625) == ("saida", 75)


def test_contagem_igual_nao_gera_movimento():
    assert calcular_ajuste_contagem(700, 700) is None


def test_saida_manual_respeita_reserva_de_pedidos():
    with pytest.raises(HTTPException) as erro:
        validar_saida_disponivel(250, saldo=500, reservado=300)
    assert erro.value.status_code == 409
    assert "200ml" in str(erro.value.detail)


def test_saida_manual_aceita_apenas_saldo_livre():
    validar_saida_disponivel(200, saldo=500, reservado=300)
