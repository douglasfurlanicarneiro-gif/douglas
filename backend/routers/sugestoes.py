from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_db
from rate_limit import feedback_rate_limit
from security import require_atelie_auth
from utils import serialize

router = APIRouter(prefix="/api/sugestoes", tags=["sugestoes"])


class SugestaoIn(BaseModel):
    cliente: str = Field(default="", max_length=120)
    contato: str = Field(default="", max_length=160)
    mensagem: str = Field(min_length=1, max_length=2000)


@router.post("", dependencies=[Depends(feedback_rate_limit)])
async def criar_sugestao(payload: SugestaoIn):
    if not payload.mensagem.strip():
        raise HTTPException(status_code=400, detail="Mensagem obrigatória.")
    db = get_db()
    doc = payload.model_dump()
    doc = {chave: valor.strip() for chave, valor in doc.items()}
    doc["data"] = datetime.now(timezone.utc).isoformat()
    doc["lida"] = False
    resultado = await db.sugestoes.insert_one(doc)
    nova = await db.sugestoes.find_one({"_id": resultado.inserted_id})
    return serialize(nova)


@router.get("")
async def listar_sugestoes(_: str = Depends(require_atelie_auth)):
    db = get_db()
    sugestoes = await db.sugestoes.find().sort("data", -1).to_list(2000)
    return [serialize(s) for s in sugestoes]


@router.delete("/{sugestao_id}")
async def apagar_sugestao(sugestao_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    try:
        oid = ObjectId(sugestao_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de sugestão inválido.")
    resultado = await db.sugestoes.delete_one({"_id": oid})
    if resultado.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sugestão não encontrada.")
    return {"status": "Sugestão apagada."}
