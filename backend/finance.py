"""Cálculo centralizado de custos e rentabilidade.

Os custos administrativos nunca são enviados para a vitrine pública. O módulo
é compartilhado pelo dashboard, checkout e painel de custos para que todos
usem exatamente a mesma fórmula.
"""
from __future__ import annotations

from typing import Any, Mapping

DEFAULT_COST_CONFIG: dict[str, Any] = {
    "custoBasePorMl": 0.0,
    "custoValvula": 0.0,
    "custoTampa": 0.0,
    "custoEtiqueta": 0.0,
    "custoEmbalagem": 0.0,
    "outrosPorFrasco": 0.0,
    "taxaPagamentoPercentual": 0.0,
    "concentracaoPadraoPercentual": 25.0,
    "frascos": {"30": 0.0, "50": 0.0, "100": 0.0},
}


def normalizar_config_custos(doc: Mapping[str, Any] | None = None) -> dict[str, Any]:
    origem = dict(doc or {})
    frascos_originais = origem.get("frascos") or {}
    frascos = {
        str(chave): max(0.0, float(valor or 0))
        for chave, valor in DEFAULT_COST_CONFIG["frascos"].items()
    }
    for chave, valor in dict(frascos_originais).items():
        try:
            frascos[str(int(chave))] = max(0.0, float(valor or 0))
        except (TypeError, ValueError):
            continue

    resultado = {
        chave: max(0.0, float(origem.get(chave, padrao) or 0))
        for chave, padrao in DEFAULT_COST_CONFIG.items()
        if chave != "frascos"
    }
    resultado["taxaPagamentoPercentual"] = min(
        100.0,
        resultado["taxaPagamentoPercentual"],
    )
    resultado["concentracaoPadraoPercentual"] = min(
        100.0,
        resultado["concentracaoPadraoPercentual"],
    )
    resultado["frascos"] = frascos
    return resultado


async def obter_config_custos(db) -> dict[str, Any]:
    doc = await db.configuracoes.find_one({"_id": "custos"}) or {}
    return normalizar_config_custos(doc)


def estimar_custo_unitario(
    perfume: Mapping[str, Any],
    ml: int,
    preco: float,
    config: Mapping[str, Any],
) -> dict[str, float | bool]:
    """Estima custo e lucro de um frasco com os dados atuais de cadastro."""
    volume = max(0, int(ml or 0))
    valor_venda = max(0.0, float(preco or 0))
    concentracao = float(
        perfume.get("concentracaoPercentual")
        or config.get("concentracaoPadraoPercentual")
        or 0
    )
    concentracao = min(100.0, max(0.0, concentracao))
    essencia_ml = volume * concentracao / 100.0
    base_ml = max(0.0, volume - essencia_ml)

    custo_essencia_ml = max(0.0, float(perfume.get("custoEssenciaPorMl", 0) or 0))
    custo_essencia = essencia_ml * custo_essencia_ml
    custo_base = base_ml * max(0.0, float(config.get("custoBasePorMl", 0) or 0))
    frascos = config.get("frascos") or {}
    custo_frasco = max(0.0, float(frascos.get(str(volume), 0) or 0))
    custo_fixo = sum(
        max(0.0, float(config.get(chave, 0) or 0))
        for chave in (
            "custoValvula",
            "custoTampa",
            "custoEtiqueta",
            "custoEmbalagem",
            "outrosPorFrasco",
        )
    )
    custo_producao = custo_essencia + custo_base + custo_frasco + custo_fixo
    taxa_pagamento = valor_venda * min(
        100.0,
        max(0.0, float(config.get("taxaPagamentoPercentual", 0) or 0)),
    ) / 100.0
    custo_total = custo_producao + taxa_pagamento
    lucro = valor_venda - custo_total
    margem = (lucro / valor_venda * 100.0) if valor_venda > 0 else 0.0

    return {
        "essenciaMl": round(essencia_ml, 3),
        "baseMl": round(base_ml, 3),
        "custoEssencia": round(custo_essencia, 4),
        "custoBase": round(custo_base, 4),
        "custoFrasco": round(custo_frasco, 4),
        "custoFixo": round(custo_fixo, 4),
        "custoProducao": round(custo_producao, 4),
        "taxaPagamento": round(taxa_pagamento, 4),
        "custoTotal": round(custo_total, 4),
        "lucro": round(lucro, 4),
        "margemPercentual": round(margem, 2),
        "custoConfigurado": bool(custo_essencia_ml > 0),
    }
