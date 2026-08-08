from finance import estimar_custo_unitario, normalizar_config_custos


def test_estimativa_custo_unitario_basica():
    config = normalizar_config_custos({
        "custoBasePorMl": 0.025,
        "custoValvula": 1.0,
        "custoTampa": 1.5,
        "custoEtiqueta": 0.5,
        "custoEmbalagem": 2.0,
        "taxaPagamentoPercentual": 0,
        "concentracaoPadraoPercentual": 25,
        "frascos": {"30": 15.0},
    })
    perfume = {"custoEssenciaPorMl": 1.0, "concentracaoPercentual": 25}
    result = estimar_custo_unitario(perfume, 30, 70, config)

    assert result["essenciaMl"] == 7.5
    assert result["baseMl"] == 22.5
    assert result["custoProducao"] == 28.0625
    assert result["lucro"] == 41.9375
    assert result["custoConfigurado"] is True


def test_taxa_pagamento_entra_no_lucro():
    config = normalizar_config_custos({"taxaPagamentoPercentual": 5})
    result = estimar_custo_unitario({"custoEssenciaPorMl": 0}, 30, 100, config)
    assert result["taxaPagamento"] == 5
    assert result["custoTotal"] == 5
    assert result["lucro"] == 95
