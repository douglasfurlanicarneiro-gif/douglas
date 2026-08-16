"""Telemetria sanitizada e gratuita para falhas recuperadas no cliente."""

import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel, Field

from database import get_db
from rate_limit import frontend_error_rate_limit

router = APIRouter(prefix="/api/observabilidade", tags=["observabilidade"])

_EMAIL = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
_LONG_NUMBER = re.compile(r"(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)")


class FrontendErrorIn(BaseModel):
    tipo: Literal["react_boundary", "window_error", "unhandled_rejection"]
    mensagem: str = Field(min_length=1, max_length=500)
    componentStack: str = Field(default="", max_length=3000)
    plataforma: str = Field(default="desconhecida", max_length=40)
    caminho: str = Field(default="/", max_length=300)
    versao: str = Field(default="", max_length=80)


def _sanitizar(value: str, limit: int) -> str:
    texto = _EMAIL.sub("[email]", str(value or ""))
    texto = _LONG_NUMBER.sub("[numero]", texto)
    return texto[:limit]


@router.post(
    "/frontend",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(frontend_error_rate_limit)],
)
async def registrar_erro_frontend(payload: FrontendErrorIn, request: Request):
    agora = datetime.now(timezone.utc)
    mensagem = _sanitizar(payload.mensagem, 500)
    component_stack = _sanitizar(payload.componentStack, 3000)
    material = f"{payload.tipo}|{mensagem}|{component_stack[:1000]}"
    fingerprint = hashlib.sha256(material.encode("utf-8")).hexdigest()[:32]
    request_id = str(getattr(request.state, "request_id", ""))[:80]
    await get_db().frontend_errors.update_one(
        {"_id": fingerprint},
        {
            "$setOnInsert": {
                "tipo": payload.tipo,
                "mensagem": mensagem,
                "componentStack": component_stack,
                "primeiraOcorrenciaEm": agora,
                "expireAt": agora + timedelta(days=30),
            },
            "$set": {
                "ultimaOcorrenciaEm": agora,
                "plataforma": _sanitizar(payload.plataforma, 40),
                "caminho": _sanitizar(payload.caminho.split("?", 1)[0], 300),
                "versao": _sanitizar(payload.versao, 80),
                "ultimoRequestId": request_id,
            },
            # Uma nova ocorrência reabre automaticamente um alerta que o
            # administrador já havia marcado como resolvido.
            "$unset": {"resolvidoEm": ""},
            "$inc": {"ocorrencias": 1},
        },
        upsert=True,
    )
    return {"recebido": True, "requestId": request_id}
