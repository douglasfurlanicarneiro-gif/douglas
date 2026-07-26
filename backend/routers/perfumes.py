from typing import List

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from database import get_db
from security import require_atelie_auth
from utils import next_seq, serialize

router = APIRouter(prefix="/api/perfumes", tags=["perfumes"])


class Preco(BaseModel):
    ml: int = Field(gt=0, le=1000)
    preco: float = Field(ge=0, le=1_000_000)


class PerfumeIn(BaseModel):
    nome: str = Field(min_length=2, max_length=160)
    inspiracao: str = Field(default="", max_length=160)
    imagemUrl: str = Field(default="", max_length=2000)
    ocasioes: List[str] = Field(default_factory=list, max_length=12)
    familia: str = Field(min_length=2, max_length=80)
    concentracao: str = Field(min_length=2, max_length=40)
    notasSaida: str = Field(default="", max_length=500)
    notasCoracao: str = Field(default="", max_length=500)
    notasFundo: str = Field(default="", max_length=500)
    precos: List[Preco] = Field(default_factory=list, max_length=30)
    estoqueMinimoMl: int = Field(default=0, ge=0, le=1_000_000)
    publicavel: bool = False

    @model_validator(mode="after")
    def validar_publicacao(self):
        if self.publicavel and not any(preco.preco > 0 for preco in self.precos):
            raise ValueError("Informe ao menos um preço válido antes de publicar.")
        return self


def _oid(perfume_id: str) -> ObjectId:
    try:
        return ObjectId(perfume_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de perfume inválido.")


@router.get("")
async def listar_perfumes():
    db = get_db()
    perfumes = await db.perfumes.find().sort("seq", 1).to_list(2000)
    return [serialize(p) for p in perfumes]


@router.post("")
async def criar_perfume(payload: PerfumeIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    doc = payload.model_dump()
    doc["seq"] = await next_seq(db, "perfumes")
    resultado = await db.perfumes.insert_one(doc)
    novo = await db.perfumes.find_one({"_id": resultado.inserted_id})
    return serialize(novo)


@router.put("/{perfume_id}")
async def atualizar_perfume(perfume_id: str, payload: PerfumeIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    resultado = await db.perfumes.update_one({"_id": _oid(perfume_id)}, {"$set": payload.model_dump()})
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Perfume não encontrado.")
    atualizado = await db.perfumes.find_one({"_id": _oid(perfume_id)})
    return serialize(atualizado)


@router.delete("/{perfume_id}")
async def apagar_perfume(perfume_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    resultado = await db.perfumes.delete_one({"_id": _oid(perfume_id)})
    if resultado.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Perfume não encontrado.")
    return {"status": "Perfume apagado."}


class BulkImportPayload(BaseModel):
    nomes: List[str]


@router.post("/bulk-import")
async def bulk_import(payload: BulkImportPayload, _: str = Depends(require_atelie_auth)):
    db = get_db()
    adicionados = 0
    for nome_bruto in payload.nomes:
        nome = nome_bruto.strip()
        if not nome:
            continue
        existe = await db.perfumes.find_one({"nome": nome})
        if existe:
            continue
        seq = await next_seq(db, "perfumes")
        await db.perfumes.insert_one({
            "nome": nome,
            "inspiracao": "",
            "imagemUrl": "",
            "ocasioes": [],
            "familia": "Amadeirado",
            "concentracao": "EDP",
            "notasSaida": "",
            "notasCoracao": "",
            "notasFundo": "",
            "precos": [],
            "estoqueMinimoMl": 0,
            # Trava de segurança (auditoria A6): item importado em massa nunca
            # entra publicável por padrão — sem preço/estoque revisados, não
            # pode aparecer na vitrine pública até alguém editar e confirmar.
            "publicavel": False,
            "seq": seq,
        })
        adicionados += 1
    return {"adicionados": adicionados}


@router.post("/padronizar-tamanhos")
async def padronizar_tamanhos(_: str = Depends(require_atelie_auth)):
    db = get_db()
    default_precos = [{"ml": 30, "preco": 0}, {"ml": 50, "preco": 0}, {"ml": 100, "preco": 0}]
    atualizados = 0
    cursor = db.perfumes.find({"$or": [{"precos": {"$size": 0}}, {"precos": {"$exists": False}}]})
    async for p in cursor:
        await db.perfumes.update_one({"_id": p["_id"]}, {"$set": {"precos": default_precos}})
        atualizados += 1
    return {"atualizados": atualizados}
