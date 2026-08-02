from routers.movimentos import calcular_ajuste_contagem


def test_contagem_maior_gera_entrada():
    assert calcular_ajuste_contagem(700, 850) == ("entrada", 150)


def test_contagem_menor_gera_saida():
    assert calcular_ajuste_contagem(700, 625) == ("saida", 75)


def test_contagem_igual_nao_gera_movimento():
    assert calcular_ajuste_contagem(700, 700) is None
