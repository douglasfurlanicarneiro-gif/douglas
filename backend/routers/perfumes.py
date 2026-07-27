from typing import List

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from database import get_db
from security import require_atelie_auth
from utils import next_seq, serialize

router = APIRouter(prefix="/api/perfumes", tags=["perfumes"])

CONCENTRACOES_LEGADAS = {
    "EDP": "Eau De Parfum",
    "EDT": "Eau De Toilette",
    "EDC": "Eau De Toilette",
    "Extrait": "Elixir",
}

ORDEM_OCASIOES = [
    "Academia",
    "Casual",
    "Dia",
    "Encontros",
    "Festa",
    "Inverno",
    "Meia-estação",
    "Noite",
    "Ocasiões especiais",
    "Outono",
    "Primavera",
    "Trabalho",
    "Uso diário",
    "Verão",
    "Viagem",
]


def _valores_unicos(valores) -> list[str]:
    return list(dict.fromkeys(
        str(valor).strip()
        for valor in (valores or [])
        if str(valor).strip()
    ))


def _metadados_normalizados(documento: dict) -> dict:
    familias = _valores_unicos(documento.get("familias"))
    if not familias and documento.get("familia"):
        familias = [str(documento["familia"]).strip()]
    if not familias:
        familias = ["Amadeirado"]

    ocasioes = _valores_unicos(documento.get("ocasioes"))
    ordem = {nome: indice for indice, nome in enumerate(ORDEM_OCASIOES)}
    ocasioes.sort(key=lambda nome: (ordem.get(nome, len(ordem)), nome.casefold()))

    concentracao_atual = str(documento.get("concentracao") or "Eau De Parfum").strip()
    return {
        "inspiracao": "",
        "familia": familias[0],
        "familias": familias,
        "ocasioes": ocasioes,
        "concentracao": CONCENTRACOES_LEGADAS.get(concentracao_atual, concentracao_atual),
    }


class Preco(BaseModel):
    ml: int = Field(gt=0, le=1000)
    preco: float = Field(ge=0, le=1_000_000)


class PerfumeIn(BaseModel):
    nome: str = Field(min_length=2, max_length=160)
    inspiracao: str = Field(default="", max_length=160)
    imagemUrl: str = Field(default="", max_length=2000)
    ocasioes: List[str] = Field(default_factory=list, max_length=15)
    familia: str = Field(min_length=2, max_length=80)
    familias: List[str] = Field(default_factory=list, max_length=14)
    concentracao: str = Field(min_length=2, max_length=40)
    notasSaida: str = Field(default="", max_length=500)
    notasCoracao: str = Field(default="", max_length=500)
    notasFundo: str = Field(default="", max_length=500)
    precos: List[Preco] = Field(default_factory=list, max_length=30)
    estoqueMinimoMl: int = Field(default=0, ge=0, le=1_000_000)
    publicavel: bool = False

    @model_validator(mode="after")
    def validar_publicacao(self):
        metadados = _metadados_normalizados(self.model_dump())
        self.inspiracao = ""
        self.familia = metadados["familia"]
        self.familias = metadados["familias"]
        self.ocasioes = metadados["ocasioes"]
        self.concentracao = metadados["concentracao"]
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
            "familias": ["Amadeirado"],
            "concentracao": "Eau De Parfum",
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
    precos_padrao = {30: 50.0, 50: 80.0, 100: 120.0}
    atualizados = 0
    cursor = db.perfumes.find({"publicavel": True})
    async for p in cursor:
        atuais = {
            int(item.get("ml", 0)): float(item.get("preco", 0))
            for item in p.get("precos", [])
            if item.get("ml")
        }
        novos = []
        mudou = False
        for ml, preco_padrao in precos_padrao.items():
            preco_atual = atuais.get(ml, 0)
            preco_final = preco_atual if preco_atual > 0 else preco_padrao
            novos.append({"ml": ml, "preco": preco_final})
            if preco_atual != preco_final:
                mudou = True

        # Mantém tamanhos personalizados que não fazem parte de 30/50/100ml.
        novos.extend(
            {"ml": ml, "preco": preco}
            for ml, preco in atuais.items()
            if ml not in precos_padrao
        )
        if not mudou:
            continue
        await db.perfumes.update_one({"_id": p["_id"]}, {"$set": {"precos": novos}})
        atualizados += 1
    return {
        "atualizados": atualizados,
        "precosPadrao": [{"ml": ml, "preco": preco} for ml, preco in precos_padrao.items()],
    }


@router.post("/padronizar-metadados")
async def padronizar_metadados(_: str = Depends(require_atelie_auth)):
    db = get_db()
    atualizados = 0

    async for perfume in db.perfumes.find():
        metadados = _metadados_normalizados(perfume)
        await db.perfumes.update_one(
            {"_id": perfume["_id"]},
            {"$set": metadados},
        )
        atualizados += 1

    snapshot = await db.vitrine.find_one({"_id": "snapshot"})
    itens_snapshot = []
    if snapshot:
        for item in snapshot.get("itens", []):
            atualizado = dict(item)
            atualizado.update(_metadados_normalizados(atualizado))
            itens_snapshot.append(atualizado)
        await db.vitrine.update_one(
            {"_id": "snapshot"},
            {"$set": {"itens": itens_snapshot}},
        )

    return {
        "atualizados": atualizados,
        "itensVitrineAtualizados": len(itens_snapshot),
        "concentracoes": ["Eau De Parfum", "Eau De Toilette", "Elixir"],
    }
