"""Autenticação do Ateliê: hashing de senha (bcrypt) + token (JWT).

Importante: o app (frontend/src/api.ts) sempre envia o token no header
`x-atelie-token` — não em `Authorization: Bearer`. A dependência
`require_atelie_auth` abaixo lê exatamente esse header para não quebrar
o contrato já existente no app.
"""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import bcrypt
import jwt
from fastapi import Header, HTTPException, status

from config import JWT_ALGORITHM, JWT_EXPIRE_HOURS, JWT_SECRET
from database import get_db

def hash_password(senha: str) -> str:
    return bcrypt.hashpw(senha.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(senha: str, senha_hash: str) -> bool:
    try:
        return bcrypt.checkpw(senha.encode("utf-8"), senha_hash.encode("utf-8"))
    except (TypeError, ValueError):
        return False


def create_token(subject: str, auth_version: int = 1) -> str:
    if not JWT_SECRET:
        raise RuntimeError(
            "JWT_SECRET não configurado. Defina uma string longa e aleatória "
            "nas variáveis de ambiente antes de fazer login funcionar."
        )
    agora = datetime.now(timezone.utc)
    expira_em = agora + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {
        "sub": subject,
        "iat": agora,
        "exp": expira_em,
        "jti": secrets.token_urlsafe(24),
        "av": auth_version,
        "typ": "atelie-admin",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token_claims(token: str) -> Optional[dict[str, Any]]:
    if not JWT_SECRET:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("typ") != "atelie-admin":
            return None
        if not payload.get("sub") or not payload.get("jti"):
            return None
        return payload
    except jwt.InvalidTokenError:
        return None


def decode_token(token: str) -> Optional[str]:
    claims = decode_token_claims(token)
    return str(claims["sub"]) if claims else None


async def require_atelie_auth(
    x_atelie_token: Optional[str] = Header(default=None),
) -> str:
    """Dependência usada em toda rota privada do Ateliê (dono/admin)."""
    if not x_atelie_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token ausente.")
    claims = decode_token_claims(x_atelie_token)
    if not claims:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido ou expirado.")
    db = get_db()
    usuario = str(claims["sub"])
    admin = await db.admins.find_one(
        {"usuario": usuario},
        {"authVersion": 1},
    )
    if not admin or int(admin.get("authVersion", 1)) != int(claims.get("av", 0)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão revogada. Entre novamente.")
    if await db.auth_revoked_tokens.find_one({"_id": claims["jti"]}, {"_id": 1}):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão encerrada. Entre novamente.")
    return usuario
