from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_db
from rate_limit import feedback_rate_limit
from security import require_atelie_auth
from utils import serialize

router = APIRouter(prefix="/api/opinioes", tags=["opinioes"])


class OpiniaoIn(BaseModel):
    perfumeId: str = Field(min_length=1, max_length=80)
    cliente: str = Field(default="", max_length=120)
    nota: int = Field(ge=1, le=5)
    comentario: str = Field(default="", max_length=1000)


@router.get("")
async def listar_opinioes():
    db = get_db()
    opinioes = await db.opinioes.find().sort("data", -1).to_list(2000)
    return [serialize(o) for o in opinioes]


@router.post("", dependencies=[Depends(feedback_rate_limit)])
async def criar_opiniao(payload: OpiniaoIn):
    db = get_db()
    doc = payload.model_dump()
    doc["cliente"] = doc["cliente"].strip()
    doc["comentario"] = doc["comentario"].strip()
    doc["data"] = datetime.now(timezone.utc).isoformat()
    resultado = await db.opinioes.insert_one(doc)
    nova = await db.opinioes.find_one({"_id": resultado.inserted_id})
    return serialize(nova)


@router.delete("/{opiniao_id}")
async def apagar_opiniao(opiniao_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    try:
        oid = ObjectId(opiniao_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de opinião inválido.")
    resultado = await db.opinioes.delete_one({"_id": oid})
    if resultado.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Opinião não encontrada.")
    return {"status": "Opinião apagada."}
