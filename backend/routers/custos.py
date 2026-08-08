"""Custos de produção e rentabilidade do catálogo."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_db
from finance import estimar_custo_unitario, normalizar_config_custos, obter_config_custos
from security import require_atelie_auth

router = APIRouter(prefix="/api/admin/custos", tags=["custos"])


class CustosConfigIn(BaseModel):
    custoBasePorMl: float = Field(default=0, ge=0, le=100_000)
    custoValvula: float = Field(default=0, ge=0, le=100_000)
    custoTampa: float = Field(default=0, ge=0, le=100_000)
    custoEtiqueta: float = Field(default=0, ge=0, le=100_000)
    custoEmbalagem: float = Field(default=0, ge=0, le=100_000)
    outrosPorFrasco: float = Field(default=0, ge=0, le=100_000)
    taxaPagamentoPercentual: float = Field(default=0, ge=0, le=100)
    concentracaoPadraoPercentual: float = Field(default=25, ge=0, le=100)
    frascos: dict[str, float] = Field(default_factory=lambda: {"30": 0, "50": 0, "100": 0})


@router.get("")
async def obter_custos(_: str = Depends(require_atelie_auth)):
    return await obter_config_custos(get_db())


@router.put("")
async def salvar_custos(payload: CustosConfigIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    dados = normalizar_config_custos(payload.model_dump())
    await db.configuracoes.update_one(
        {"_id": "custos"},
        {"$set": dados},
        upsert=True,
    )
    return dados


@router.get("/rentabilidade")
async def rentabilidade_catalogo(_: str = Depends(require_atelie_auth)):
    db = get_db()
    config = await obter_config_custos(db)
    perfumes = await db.perfumes.find(
        {},
        {
            "nome": 1,
            "precos": 1,
            "custoEssenciaPorMl": 1,
            "concentracaoPercentual": 1,
            "publicavel": 1,
        },
    ).sort("nome", 1).to_list(5000)

    linhas = []
    for perfume in perfumes:
        for opcao in perfume.get("precos", []):
            ml = int(opcao.get("ml", 0) or 0)
            preco = float(opcao.get("preco", 0) or 0)
            if ml <= 0 or preco <= 0:
                continue
            calculo = estimar_custo_unitario(perfume, ml, preco, config)
            linhas.append({
                "perfumeId": str(perfume["_id"]),
                "nome": perfume.get("nome", "Perfume"),
                "ml": ml,
                "preco": round(preco, 2),
                "publicavel": perfume.get("publicavel") is True,
                **calculo,
            })
    return {"config": config, "itens": linhas}


@router.get("/perfume/{perfume_id}")
async def rentabilidade_perfume(perfume_id: str, _: str = Depends(require_atelie_auth)):
    from bson import ObjectId
    from bson.errors import InvalidId

    db = get_db()
    try:
        oid = ObjectId(perfume_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Perfume inválido.") from exc
    perfume = await db.perfumes.find_one({"_id": oid})
    if not perfume:
        raise HTTPException(status_code=404, detail="Perfume não encontrado.")
    config = await obter_config_custos(db)
    return {
        "perfumeId": perfume_id,
        "nome": perfume.get("nome", "Perfume"),
        "itens": [
            {
                "ml": int(opcao.get("ml", 0) or 0),
                "preco": float(opcao.get("preco", 0) or 0),
                **estimar_custo_unitario(
                    perfume,
                    int(opcao.get("ml", 0) or 0),
                    float(opcao.get("preco", 0) or 0),
                    config,
                ),
            }
            for opcao in perfume.get("precos", [])
            if int(opcao.get("ml", 0) or 0) > 0
        ],
    }
