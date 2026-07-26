"""Autenticação do Ateliê: hashing de senha (bcrypt) + token (JWT).

Importante: o app (frontend/src/api.ts) sempre envia o token no header
`x-atelie-token` — não em `Authorization: Bearer`. A dependência
`require_atelie_auth` abaixo lê exatamente esse header para não quebrar
o contrato já existente no app.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Header, HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext

from config import JWT_ALGORITHM, JWT_EXPIRE_HOURS, JWT_SECRET

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(senha: str) -> str:
    return pwd_context.hash(senha)


def verify_password(senha: str, senha_hash: str) -> bool:
    return pwd_context.verify(senha, senha_hash)


def create_token(subject: str) -> str:
    if not JWT_SECRET:
        raise RuntimeError(
            "JWT_SECRET não configurado. Defina uma string longa e aleatória "
            "nas variáveis de ambiente antes de fazer login funcionar."
        )
    expira_em = datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS)
    payload = {"sub": subject, "exp": expira_em}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Optional[str]:
    if not JWT_SECRET:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


async def require_atelie_auth(
    x_atelie_token: Optional[str] = Header(default=None),
) -> str:
    """Dependência usada em toda rota privada do Ateliê (dono/admin)."""
    if not x_atelie_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token ausente.")
    usuario = decode_token(x_atelie_token)
    if not usuario:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token inválido ou expirado.")
    return usuario
