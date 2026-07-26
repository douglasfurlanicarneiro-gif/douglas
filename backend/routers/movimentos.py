from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_db
from security import require_atelie_auth
from utils import serialize

router = APIRouter(tags=["estoque"])

# Soma de entradas menos saídas, agrupado por perfume — é assim que o
# estoque "atual" é sempre calculado, nunca guardado como um número solto
# no documento do perfume (ver auditoria: única fonte da verdade).
_PIPELINE_ESTOQUE = [
    {
        "$group": {
            "_id": "$perfumeId",
            "total": {
                "$sum": {
                    "$cond": [
                        {"$eq": ["$tipo", "entrada"]},
                        "$quantidadeMl",
                        {"$multiply": ["$quantidadeMl", -1]},
                    ]
                }
            },
        }
    },
]


class MovimentoIn(BaseModel):
    perfumeId: str
    tipo: str  # 'entrada' | 'saida'
    quantidadeMl: int
    motivo: str = ""


@router.get("/api/movimentos")
async def listar_movimentos(_: str = Depends(require_atelie_auth)):
    db = get_db()
    movimentos = await db.movimentos.find().sort("data", -1).to_list(5000)
    return [serialize(m) for m in movimentos]


@router.post("/api/movimentos")
async def criar_movimento(payload: MovimentoIn, _: str = Depends(require_atelie_auth)):
    if payload.tipo not in ("entrada", "saida"):
        raise HTTPException(status_code=400, detail="Tipo de movimento inválido.")
    if payload.quantidadeMl <= 0:
        raise HTTPException(status_code=400, detail="Quantidade deve ser maior que zero.")
    db = get_db()
    doc = payload.model_dump()
    doc["data"] = datetime.now(timezone.utc).isoformat()
    doc["origem"] = "manual"
    resultado = await db.movimentos.insert_one(doc)
    novo = await db.movimentos.find_one({"_id": resultado.inserted_id})
    return serialize(novo)


@router.delete("/api/movimentos/{movimento_id}")
async def apagar_movimento(movimento_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    try:
        oid = ObjectId(movimento_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de movimento inválido.")
    resultado = await db.movimentos.delete_one({"_id": oid})
    if resultado.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Movimento não encontrado.")
    return {"status": "Movimento apagado."}


@router.get("/api/estoque")
async def mapa_estoque():
    db = get_db()
    mapa: dict[str, int] = {}
    async for linha in db.movimentos.aggregate(_PIPELINE_ESTOQUE):
        mapa[linha["_id"]] = linha["total"]
    return mapa
