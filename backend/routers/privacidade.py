"""Canal formal para exercício dos direitos de privacidade/LGPD."""

import secrets
from datetime import datetime, timezone
from typing import Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, model_validator

from audit import registrar_auditoria
from database import get_db
from rate_limit import feedback_rate_limit, tracking_rate_limit
from security import require_atelie_auth
from utils import serialize

router = APIRouter(prefix="/api/privacidade", tags=["privacidade"])


class SolicitacaoPrivacidadeIn(BaseModel):
    tipo: Literal["acesso", "correcao", "exclusao", "revogacao"]
    nome: str = Field(min_length=2, max_length=120)
    contato: str = Field(min_length=8, max_length=160)
    email: EmailStr | None = None
    mensagem: str = Field(default="", max_length=1000)
    confirmacaoTitularidade: bool = False

    @model_validator(mode="after")
    def confirmar_titularidade(self):
        if not self.confirmacaoTitularidade:
            raise ValueError("Confirme que a solicitação se refere aos seus dados.")
        return self


class AtualizarSolicitacaoIn(BaseModel):
    status: Literal["recebida", "em_analise", "concluida", "recusada"]
    observacaoInterna: str = Field(default="", max_length=1000)


def _protocolo() -> str:
    return f"LFE-{secrets.token_hex(6).upper()}"


@router.post("/solicitacoes", dependencies=[Depends(feedback_rate_limit)])
async def criar_solicitacao(payload: SolicitacaoPrivacidadeIn):
    db = get_db()
    agora = datetime.now(timezone.utc).isoformat()
    doc = {
        **payload.model_dump(mode="json"),
        "nome": payload.nome.strip(),
        "contato": payload.contato.strip(),
        "mensagem": payload.mensagem.strip(),
        "protocolo": _protocolo(),
        "status": "recebida",
        "criadoEm": agora,
        "atualizadoEm": agora,
    }
    resultado = await db.solicitacoes_privacidade.insert_one(doc)
    await registrar_auditoria(
        db,
        acao="receber",
        recurso="solicitacao_privacidade",
        recurso_id=str(resultado.inserted_id),
        titulo="Solicitação de privacidade recebida",
        detalhes=f"Protocolo {doc['protocolo']} aberto para análise.",
        metadados={"tipo": payload.tipo},
    )
    return {
        "protocolo": doc["protocolo"],
        "status": doc["status"],
        "criadoEm": agora,
    }


@router.get(
    "/solicitacoes/status/{protocolo}",
    dependencies=[Depends(tracking_rate_limit)],
)
async def consultar_status(protocolo: str):
    if len(protocolo) != 16 or not protocolo.startswith("LFE-"):
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    doc = await get_db().solicitacoes_privacidade.find_one({"protocolo": protocolo})
    if not doc:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    return {
        "protocolo": doc["protocolo"],
        "tipo": doc["tipo"],
        "status": doc["status"],
        "criadoEm": doc["criadoEm"],
        "atualizadoEm": doc["atualizadoEm"],
    }


@router.get("/solicitacoes")
async def listar_solicitacoes(_: str = Depends(require_atelie_auth)):
    docs = await get_db().solicitacoes_privacidade.find().sort(
        "criadoEm", -1
    ).to_list(2000)
    return [serialize(item) for item in docs]


@router.patch("/solicitacoes/{solicitacao_id}")
async def atualizar_solicitacao(
    solicitacao_id: str,
    payload: AtualizarSolicitacaoIn,
    _: str = Depends(require_atelie_auth),
):
    try:
        oid = ObjectId(solicitacao_id)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Solicitação inválida.") from exc
    db = get_db()
    agora = datetime.now(timezone.utc).isoformat()
    resultado = await db.solicitacoes_privacidade.update_one(
        {"_id": oid},
        {"$set": {
            **payload.model_dump(),
            "atualizadoEm": agora,
            "concluidoEm": agora if payload.status in {"concluida", "recusada"} else None,
        }},
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Solicitação não encontrada.")
    await registrar_auditoria(
        db,
        acao="atualizar",
        recurso="solicitacao_privacidade",
        recurso_id=solicitacao_id,
        titulo="Solicitação de privacidade atualizada",
        detalhes=f"Status alterado para {payload.status}.",
    )
    return serialize(await db.solicitacoes_privacidade.find_one({"_id": oid}))
