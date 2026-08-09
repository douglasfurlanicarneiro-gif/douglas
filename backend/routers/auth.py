from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from audit import registrar_auditoria
from database import get_db
from security import (
    create_token,
    decode_token_claims,
    require_atelie_auth,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_MINUTES = 15
LOGIN_BLOCK_MINUTES = 15


class LoginPayload(BaseModel):
    usuario: str = Field(min_length=1, max_length=120)
    senha: str = Field(min_length=1, max_length=300)


def _login_key(request: Request, usuario: str) -> str:
    forwarded = [
        item.strip()
        for item in request.headers.get("x-forwarded-for", "").split(",")
        if item.strip()
    ]
    ip = forwarded[-1] if forwarded else (
        request.client.host if request.client else "unknown"
    )
    return f"{ip}:{usuario.strip().casefold()}"


@router.post("/login")
async def login(payload: LoginPayload, request: Request):
    db = get_db()
    agora = datetime.now(timezone.utc)
    chave = _login_key(request, payload.usuario)
    tentativa = await db.auth_login_attempts.find_one({"_id": chave}) or {}
    bloqueado_ate = tentativa.get("bloqueadoAte")
    if isinstance(bloqueado_ate, datetime) and bloqueado_ate > agora:
        segundos = max(1, int((bloqueado_ate - agora).total_seconds()))
        raise HTTPException(
            status_code=429,
            detail=f"Muitas tentativas de acesso. Aguarde cerca de {max(1, segundos // 60)} minuto(s).",
            headers={"Retry-After": str(segundos)},
        )

    admin = await db.admins.find_one({"usuario": payload.usuario})
    if not admin or not verify_password(payload.senha, admin["senhaHash"]):
        inicio = tentativa.get("janelaInicio")
        dentro_janela = isinstance(inicio, datetime) and inicio >= agora - timedelta(minutes=LOGIN_WINDOW_MINUTES)
        quantidade = int(tentativa.get("tentativas", 0) or 0) + 1 if dentro_janela else 1
        atualizacao = {
            "janelaInicio": inicio if dentro_janela else agora,
            "tentativas": quantidade,
            "ultimaTentativa": agora,
            "expireAt": agora + timedelta(days=1),
        }
        if quantidade >= MAX_LOGIN_ATTEMPTS:
            atualizacao["bloqueadoAte"] = agora + timedelta(minutes=LOGIN_BLOCK_MINUTES)
        await db.auth_login_attempts.update_one({"_id": chave}, {"$set": atualizacao}, upsert=True)
        return {"ok": False}

    await db.auth_login_attempts.delete_one({"_id": chave})
    token = create_token(admin["usuario"], int(admin.get("authVersion", 1)))
    await registrar_auditoria(
        db,
        acao="login",
        recurso="sessao_administrativa",
        recurso_id=admin["usuario"],
        titulo="Acesso administrativo realizado",
        detalhes="Uma nova sessão segura foi iniciada no painel.",
    )
    return {"ok": True, "token": token}


@router.post("/logout")
async def logout(
    usuario: str = Depends(require_atelie_auth),
    x_atelie_token: str = Header(),
):
    claims = decode_token_claims(x_atelie_token)
    if not claims:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada.")
    expira_em = datetime.fromtimestamp(float(claims["exp"]), timezone.utc)
    db = get_db()
    await db.auth_revoked_tokens.update_one(
        {"_id": claims["jti"]},
        {"$set": {"usuario": usuario, "expireAt": expira_em}},
        upsert=True,
    )
    await registrar_auditoria(
        db,
        acao="logout",
        recurso="sessao_administrativa",
        recurso_id=usuario,
        titulo="Sessão administrativa encerrada",
        detalhes="O token desta sessão foi revogado no servidor.",
    )
    return {"ok": True}
