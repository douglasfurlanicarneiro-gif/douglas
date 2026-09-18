"""Cupons percentuais administrados pelo painel e validados no servidor."""

import re
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from pymongo.errors import DuplicateKeyError

from audit import registrar_auditoria
from database import get_db
from rate_limit import coupon_rate_limit
from security import require_atelie_auth
from utils import serialize


router = APIRouter(tags=["cupons"])
CODIGO_PATTERN = re.compile(r"^[A-Z0-9_-]{3,24}$")


def normalizar_codigo_cupom(valor: str) -> str:
    codigo = re.sub(r"\s+", "", str(valor or "").upper())
    if not CODIGO_PATTERN.fullmatch(codigo):
        raise ValueError(
            "Use de 3 a 24 caracteres: letras, números, hífen ou sublinhado."
        )
    return codigo


def calcular_desconto_cupom(subtotal_centavos: int, percentual: int) -> int:
    """Arredonda uma única vez e nunca permite que o abatimento exceda produtos."""
    subtotal_seguro = max(0, int(subtotal_centavos))
    percentual_seguro = min(90, max(0, int(percentual)))
    return min(
        subtotal_seguro,
        (subtotal_seguro * percentual_seguro + 50) // 100,
    )


class CupomIn(BaseModel):
    codigo: str = Field(min_length=3, max_length=32)
    percentual: int = Field(ge=1, le=90)
    descricao: str = Field(default="", max_length=160)
    ativo: bool = True

    @field_validator("codigo")
    @classmethod
    def validar_codigo(cls, valor: str) -> str:
        return normalizar_codigo_cupom(valor)


class CupomValidacaoIn(BaseModel):
    codigo: str = Field(min_length=1, max_length=32)


def _oid(valor: str) -> ObjectId:
    try:
        return ObjectId(valor)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Cupom inválido.") from exc


async def obter_cupom_ativo(db, codigo: str | None) -> dict | None:
    if not str(codigo or "").strip():
        return None
    try:
        normalizado = normalizar_codigo_cupom(str(codigo))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Cupom inválido ou indisponível.") from exc
    cupom = await db.cupons.find_one(
        {"codigo": normalizado, "ativo": True, "arquivadoEm": None}
    )
    if not cupom:
        raise HTTPException(status_code=400, detail="Cupom inválido ou indisponível.")
    return cupom


@router.post(
    "/api/cupons/validar",
    dependencies=[Depends(coupon_rate_limit)],
)
async def validar_cupom_publico(payload: CupomValidacaoIn):
    cupom = await obter_cupom_ativo(get_db(), payload.codigo)
    if not cupom:
        raise HTTPException(status_code=400, detail="Cupom inválido ou indisponível.")
    return {
        "codigo": cupom["codigo"],
        "percentual": int(cupom["percentual"]),
        "descricao": cupom.get("descricao", ""),
    }


@router.get("/api/admin/cupons")
async def listar_cupons(_: str = Depends(require_atelie_auth)):
    cupons = await get_db().cupons.find({"arquivadoEm": None}).sort("codigo", 1).to_list(1000)
    return [serialize(cupom) for cupom in cupons]


@router.post("/api/admin/cupons")
async def criar_cupom(payload: CupomIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    agora = datetime.now(timezone.utc)
    doc = {**payload.model_dump(), "criadoEm": agora, "atualizadoEm": agora, "arquivadoEm": None}
    try:
        resultado = await db.cupons.insert_one(doc)
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Já existe um cupom com esse código.") from exc
    await registrar_auditoria(
        db,
        acao="criar",
        recurso="cupom",
        recurso_id=str(resultado.inserted_id),
        titulo=f"Cupom {payload.codigo} criado",
        detalhes=f"Desconto de {payload.percentual}% somente nos perfumes.",
    )
    return serialize(await db.cupons.find_one({"_id": resultado.inserted_id}))


@router.put("/api/admin/cupons/{cupom_id}")
async def atualizar_cupom(
    cupom_id: str,
    payload: CupomIn,
    _: str = Depends(require_atelie_auth),
):
    db = get_db()
    oid = _oid(cupom_id)
    atual = await db.cupons.find_one({"_id": oid, "arquivadoEm": None})
    if not atual:
        raise HTTPException(status_code=404, detail="Cupom não encontrado.")
    try:
        await db.cupons.update_one(
            {"_id": oid},
            {"$set": {**payload.model_dump(), "atualizadoEm": datetime.now(timezone.utc)}},
        )
    except DuplicateKeyError as exc:
        raise HTTPException(status_code=409, detail="Já existe um cupom com esse código.") from exc
    await registrar_auditoria(
        db,
        acao="atualizar",
        recurso="cupom",
        recurso_id=cupom_id,
        titulo=f"Cupom {payload.codigo} atualizado",
        detalhes=(
            f"Desconto de {payload.percentual}% somente nos perfumes; "
            f"cupom {'ativo' if payload.ativo else 'pausado'}."
        ),
    )
    return serialize(await db.cupons.find_one({"_id": oid}))


@router.delete("/api/admin/cupons/{cupom_id}")
async def arquivar_cupom(cupom_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    oid = _oid(cupom_id)
    cupom = await db.cupons.find_one({"_id": oid, "arquivadoEm": None})
    if not cupom:
        raise HTTPException(status_code=404, detail="Cupom não encontrado.")
    agora = datetime.now(timezone.utc)
    await db.cupons.update_one(
        {"_id": oid},
        {"$set": {"ativo": False, "arquivadoEm": agora, "atualizadoEm": agora}},
    )
    await registrar_auditoria(
        db,
        acao="arquivar",
        recurso="cupom",
        recurso_id=cupom_id,
        titulo=f"Cupom {cupom.get('codigo', '')} arquivado",
        detalhes="Cupom removido do uso público com o histórico preservado.",
    )
    return {"status": "Cupom arquivado."}
