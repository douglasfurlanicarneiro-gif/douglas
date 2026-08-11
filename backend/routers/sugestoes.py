from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from audit import registrar_auditoria
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
    doc["data"] = datetime.now(timezone.utc)
    doc["lida"] = False
    resultado = await db.sugestoes.insert_one(doc)
    nova = await db.sugestoes.find_one({"_id": resultado.inserted_id})
    return serialize(nova)


@router.get("")
async def listar_sugestoes(_: str = Depends(require_atelie_auth)):
    db = get_db()
    sugestoes = await db.sugestoes.find(
        {"arquivadoEm": None}
    ).sort("data", -1).to_list(2000)
    return [serialize(s) for s in sugestoes]


@router.delete("/{sugestao_id}")
async def apagar_sugestao(sugestao_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    try:
        oid = ObjectId(sugestao_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de sugestão inválido.")
    agora = datetime.now(timezone.utc)
    resultado = await db.sugestoes.update_one(
        {"_id": oid, "arquivadoEm": None},
        {"$set": {"arquivadoEm": agora, "arquivadoPor": "administrador"}},
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sugestão não encontrada.")
    await registrar_auditoria(
        db,
        acao="arquivar",
        recurso="sugestao",
        recurso_id=sugestao_id,
        titulo="Sugestão arquivada",
        detalhes="Sugestão removida da caixa de entrada com registro preservado.",
    )
    return {"status": "Sugestão arquivada."}
