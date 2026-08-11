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

router = APIRouter(prefix="/api/opinioes", tags=["opinioes"])


class OpiniaoIn(BaseModel):
    perfumeId: str = Field(min_length=1, max_length=80)
    cliente: str = Field(default="", max_length=120)
    nota: int = Field(ge=1, le=5)
    comentario: str = Field(default="", max_length=1000)


class ModeracaoOpiniaoIn(BaseModel):
    aprovada: bool


def _nome_publico(nome: str) -> str:
    partes = [parte for parte in nome.strip().split() if parte]
    if not partes:
        return "Cliente"
    if len(partes) == 1:
        return partes[0]
    return f"{partes[0]} {partes[-1][0].upper()}."


def _opiniao_publica(documento: dict) -> dict:
    return {
        "id": str(documento["_id"]),
        "perfumeId": str(documento.get("perfumeId") or ""),
        "cliente": _nome_publico(str(documento.get("cliente") or "")),
        "nota": int(documento.get("nota") or 0),
        "comentario": str(documento.get("comentario") or ""),
        "data": documento.get("data"),
    }


@router.get("")
async def listar_opinioes():
    db = get_db()
    opinioes = await db.opinioes.find(
        {"arquivadoEm": None, "aprovada": True}
    ).sort("data", -1).to_list(2000)
    return [_opiniao_publica(o) for o in opinioes]


@router.get("/admin")
async def listar_opinioes_admin(_: str = Depends(require_atelie_auth)):
    db = get_db()
    opinioes = await db.opinioes.find(
        {"arquivadoEm": None}
    ).sort("data", -1).to_list(2000)
    return [serialize(o) for o in opinioes]


@router.post("", dependencies=[Depends(feedback_rate_limit)])
async def criar_opiniao(payload: OpiniaoIn):
    db = get_db()
    try:
        perfume_oid = ObjectId(payload.perfumeId)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Perfume inválido.") from exc
    perfume = await db.perfumes.find_one(
        {"_id": perfume_oid, "arquivadoEm": None, "publicavel": True}, {"_id": 1}
    )
    if not perfume:
        raise HTTPException(status_code=404, detail="Perfume não encontrado na vitrine.")
    doc = payload.model_dump()
    doc["cliente"] = doc["cliente"].strip()
    doc["comentario"] = doc["comentario"].strip()
    doc["data"] = datetime.now(timezone.utc)
    doc["aprovada"] = False
    doc["moderadaEm"] = None
    resultado = await db.opinioes.insert_one(doc)
    nova = await db.opinioes.find_one({"_id": resultado.inserted_id})
    return serialize(nova)


@router.patch("/{opiniao_id}/moderacao")
async def moderar_opiniao(
    opiniao_id: str,
    payload: ModeracaoOpiniaoIn,
    _: str = Depends(require_atelie_auth),
):
    db = get_db()
    try:
        oid = ObjectId(opiniao_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de opinião inválido.")
    agora = datetime.now(timezone.utc)
    resultado = await db.opinioes.update_one(
        {"_id": oid, "arquivadoEm": None},
        {"$set": {"aprovada": payload.aprovada, "moderadaEm": agora}},
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Opinião não encontrada.")
    await registrar_auditoria(
        db,
        acao="aprovar" if payload.aprovada else "ocultar",
        recurso="opiniao",
        recurso_id=opiniao_id,
        titulo="Avaliação aprovada" if payload.aprovada else "Avaliação ocultada",
        detalhes=(
            "Avaliação liberada para exibição na vitrine."
            if payload.aprovada
            else "Avaliação retirada da exibição pública sem apagar o registro."
        ),
    )
    atualizada = await db.opinioes.find_one({"_id": oid})
    return serialize(atualizada)


@router.delete("/{opiniao_id}")
async def apagar_opiniao(opiniao_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    try:
        oid = ObjectId(opiniao_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de opinião inválido.")
    agora = datetime.now(timezone.utc)
    resultado = await db.opinioes.update_one(
        {"_id": oid, "arquivadoEm": None},
        {"$set": {"arquivadoEm": agora, "arquivadoPor": "administrador"}},
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Opinião não encontrada.")
    await registrar_auditoria(
        db,
        acao="arquivar",
        recurso="opiniao",
        recurso_id=opiniao_id,
        titulo="Avaliação arquivada",
        detalhes="Avaliação retirada da vitrine com registro preservado.",
    )
    return {"status": "Opinião arquivada."}
