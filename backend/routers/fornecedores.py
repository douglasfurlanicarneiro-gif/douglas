"""Cadastro de fornecedores e histórico de cotações."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from audit import registrar_auditoria
from database import get_db
from security import require_atelie_auth
from utils import serialize

router = APIRouter(prefix="/api/admin/fornecedores", tags=["fornecedores"])


class FornecedorIn(BaseModel):
    nome: str = Field(min_length=2, max_length=160)
    site: str = Field(default="", max_length=1000)
    contato: str = Field(default="", max_length=160)
    whatsapp: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=160)
    documento: str = Field(default="", max_length=40)
    pedidoMinimo: float = Field(default=0, ge=0, le=100_000_000)
    prazoDias: int = Field(default=0, ge=0, le=3650)
    observacoes: str = Field(default="", max_length=2000)
    ativo: bool = True


class CotacaoIn(BaseModel):
    perfumeId: str | None = None
    produto: str = Field(min_length=2, max_length=240)
    codigo: str = Field(default="", max_length=120)
    quantidade: float = Field(gt=0, le=100_000_000)
    unidade: Literal["ml", "g", "kg", "un"] = "ml"
    precoTotal: float = Field(ge=0, le=100_000_000)
    frete: float = Field(default=0, ge=0, le=100_000_000)
    link: str = Field(default="", max_length=2000)
    observacoes: str = Field(default="", max_length=2000)
    aplicarAoPerfume: bool = False


def _oid(valor: str, label: str = "Registro") -> ObjectId:
    try:
        return ObjectId(valor)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail=f"{label} inválido.") from exc


@router.get("")
async def listar_fornecedores(_: str = Depends(require_atelie_auth)):
    db = get_db()
    fornecedores = await db.fornecedores.find().sort("nome", 1).to_list(1000)
    ids = [str(item["_id"]) for item in fornecedores]
    contagens: dict[str, int] = {item: 0 for item in ids}
    if ids:
        async for linha in await db.cotacoes_fornecedores.aggregate([
            {"$match": {"fornecedorId": {"$in": ids}, "arquivadoEm": None}},
            {"$group": {"_id": "$fornecedorId", "total": {"$sum": 1}}},
        ]):
            contagens[str(linha["_id"])] = int(linha.get("total", 0))
    return [
        {**serialize(item), "cotacoes": contagens.get(str(item["_id"]), 0)}
        for item in fornecedores
    ]


@router.post("")
async def criar_fornecedor(payload: FornecedorIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    agora = datetime.now(timezone.utc).isoformat()
    doc = {**payload.model_dump(), "criadoEm": agora, "atualizadoEm": agora}
    resultado = await db.fornecedores.insert_one(doc)
    return serialize(await db.fornecedores.find_one({"_id": resultado.inserted_id}))


@router.put("/{fornecedor_id}")
async def atualizar_fornecedor(
    fornecedor_id: str,
    payload: FornecedorIn,
    _: str = Depends(require_atelie_auth),
):
    db = get_db()
    oid = _oid(fornecedor_id, "Fornecedor")
    dados = {**payload.model_dump(), "atualizadoEm": datetime.now(timezone.utc).isoformat()}
    resultado = await db.fornecedores.update_one({"_id": oid}, {"$set": dados})
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")
    return serialize(await db.fornecedores.find_one({"_id": oid}))


@router.delete("/{fornecedor_id}")
async def arquivar_fornecedor(fornecedor_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    oid = _oid(fornecedor_id, "Fornecedor")
    resultado = await db.fornecedores.update_one(
        {"_id": oid},
        {"$set": {"ativo": False, "atualizadoEm": datetime.now(timezone.utc).isoformat()}},
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")
    return {"status": "Fornecedor arquivado."}


@router.get("/comparativo/{perfume_id}")
async def comparar_fornecedores(perfume_id: str, _: str = Depends(require_atelie_auth)):
    """Última cotação de cada fornecedor para uma mesma essência/perfume."""
    _oid(perfume_id, "Perfume")
    docs = await get_db().cotacoes_fornecedores.find(
        {"perfumeId": perfume_id, "arquivadoEm": None}
    ).sort("data", -1).to_list(5000)
    ultimas: dict[str, dict] = {}
    for item in docs:
        fornecedor_id = str(item.get("fornecedorId") or "")
        if fornecedor_id and fornecedor_id not in ultimas:
            ultimas[fornecedor_id] = item
    comparativo = sorted(
        ultimas.values(),
        key=lambda item: (
            0 if item.get("unidade") == "ml" else 1,
            float(item.get("custoUnitario", 0) or 0),
        ),
    )
    return [serialize(item) for item in comparativo]


@router.get("/{fornecedor_id}/cotacoes")
async def listar_cotacoes(fornecedor_id: str, _: str = Depends(require_atelie_auth)):
    _oid(fornecedor_id, "Fornecedor")
    docs = await get_db().cotacoes_fornecedores.find(
        {"fornecedorId": fornecedor_id, "arquivadoEm": None}
    ).sort("data", -1).to_list(2000)
    return [serialize(item) for item in docs]


@router.post("/{fornecedor_id}/cotacoes")
async def criar_cotacao(
    fornecedor_id: str,
    payload: CotacaoIn,
    _: str = Depends(require_atelie_auth),
):
    db = get_db()
    fornecedor_oid = _oid(fornecedor_id, "Fornecedor")
    fornecedor = await db.fornecedores.find_one({"_id": fornecedor_oid})
    if not fornecedor:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado.")

    perfume = None
    if payload.perfumeId:
        perfume = await db.perfumes.find_one({"_id": _oid(payload.perfumeId, "Perfume")})
        if not perfume:
            raise HTTPException(status_code=404, detail="Perfume não encontrado.")

    custo_total = float(payload.precoTotal) + float(payload.frete)
    custo_unitario = custo_total / float(payload.quantidade)
    agora = datetime.now(timezone.utc).isoformat()
    doc = {
        **payload.model_dump(exclude={"aplicarAoPerfume"}),
        "fornecedorId": fornecedor_id,
        "fornecedorNome": fornecedor.get("nome", "Fornecedor"),
        "perfumeNome": perfume.get("nome") if perfume else None,
        "custoUnitario": round(custo_unitario, 6),
        "data": agora,
    }
    resultado = await db.cotacoes_fornecedores.insert_one(doc)

    if payload.aplicarAoPerfume and perfume and payload.unidade == "ml":
        custo_aplicado = round(custo_unitario, 6)
        await db.perfumes.update_one(
            {"_id": perfume["_id"]},
            {"$set": {
                "custoEssenciaPorMl": custo_aplicado,
                "fornecedorId": fornecedor_id,
                "fornecedorCodigo": payload.codigo.strip(),
            }},
        )
        # Se a essência já estiver no estoque de matérias-primas, a cotação
        # passa a ser também o custo operacional usado na próxima produção.
        await db.insumos.update_many(
            {"categoria": "essencia", "perfumeId": payload.perfumeId, "ativo": {"$ne": False}},
            {"$set": {
                "custoUnitario": custo_aplicado,
                "fornecedorId": fornecedor_id,
                "atualizadoEm": agora,
            }},
        )

    return serialize(await db.cotacoes_fornecedores.find_one({"_id": resultado.inserted_id}))


@router.delete("/cotacoes/{cotacao_id}")
async def apagar_cotacao(cotacao_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    agora = datetime.now(timezone.utc).isoformat()
    resultado = await db.cotacoes_fornecedores.update_one(
        {"_id": _oid(cotacao_id, "Cotação"), "arquivadoEm": None},
        {"$set": {"arquivadoEm": agora, "arquivadoPor": "administrador"}},
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Cotação não encontrada.")
    await registrar_auditoria(
        db,
        acao="arquivar",
        recurso="cotacao_fornecedor",
        recurso_id=cotacao_id,
        titulo="Cotação arquivada",
        detalhes="Cotação removida do comparativo com histórico preservado.",
    )
    return {"status": "Cotação arquivada."}
