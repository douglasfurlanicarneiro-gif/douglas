from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from audit import registrar_auditoria
from client_identity import anonymous_client_key
from database import get_db
from rate_limit import login_rate_limit
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

# Hash valido usado quando o usuario nao existe. Executar bcrypt mesmo nesse
# caso reduz a diferenca de tempo que poderia revelar o nome administrativo.
# O valor nao e uma credencial e nunca pode autenticar uma conta.
_DUMMY_PASSWORD_HASH = "$2b$12$3Y5/o15n9qBg4OLhlXB7VevIdB53DByS3aenCb7NUPIl8jm6WnD5G"


class LoginPayload(BaseModel):
    usuario: str = Field(min_length=1, max_length=120)
    senha: str = Field(min_length=1, max_length=300)


def _login_key(request: Request, usuario: str) -> str:
    usuario_normalizado = usuario.strip().casefold()
    return anonymous_client_key(request, f"login:{usuario_normalizado}")


def _utc_datetime(value: object) -> datetime | None:
    """Normaliza datas do MongoDB, que podem retornar sem fuso horario."""
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@router.post("/login", dependencies=[Depends(login_rate_limit)])
async def login(payload: LoginPayload, request: Request):
    db = get_db()
    agora = datetime.now(timezone.utc)
    usuario = payload.usuario.strip()
    chave = _login_key(request, usuario)
    tentativa = await db.auth_login_attempts.find_one({"_id": chave}) or {}
    bloqueado_ate = _utc_datetime(tentativa.get("bloqueadoAte"))
    if bloqueado_ate and bloqueado_ate > agora:
        segundos = max(1, int((bloqueado_ate - agora).total_seconds()))
        raise HTTPException(
            status_code=429,
            detail=f"Muitas tentativas de acesso. Aguarde cerca de {max(1, segundos // 60)} minuto(s).",
            headers={"Retry-After": str(segundos)},
        )

    admin = await db.admins.find_one({"usuario": usuario})
    senha_hash = str((admin or {}).get("senhaHash") or _DUMMY_PASSWORD_HASH)
    senha_valida = verify_password(payload.senha, senha_hash)
    if not admin or not senha_valida:
        inicio = _utc_datetime(tentativa.get("janelaInicio"))
        dentro_janela = bool(
            inicio and inicio >= agora - timedelta(minutes=LOGIN_WINDOW_MINUTES)
        )
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
