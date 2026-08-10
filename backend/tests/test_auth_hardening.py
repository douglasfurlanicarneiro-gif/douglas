import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from routers import auth


class RequisicaoFalsa:
    headers = {"cf-connecting-ip": "198.51.100.10"}
    client = None


class TentativasFalsas:
    def __init__(self, documento=None):
        self.documento = documento or {}
        self.atualizacao = None

    async def find_one(self, _query):
        return dict(self.documento)

    async def update_one(self, _query, update, upsert=False):
        self.atualizacao = update

    async def delete_one(self, _query):
        return None


class AdminsFalsos:
    def __init__(self, documento=None):
        self.documento = documento
        self.consulta = None

    async def find_one(self, query):
        self.consulta = query
        return self.documento


class BancoFalso:
    def __init__(self, *, tentativa=None, admin=None):
        self.auth_login_attempts = TentativasFalsas(tentativa)
        self.admins = AdminsFalsos(admin)


def test_bloqueio_com_data_mongodb_sem_fuso_retorna_429(monkeypatch):
    banco = BancoFalso(
        tentativa={
            "bloqueadoAte": datetime.now(timezone.utc).replace(tzinfo=None)
            + timedelta(minutes=10)
        }
    )
    monkeypatch.setattr(auth, "get_db", lambda: banco)

    with pytest.raises(HTTPException) as bloqueio:
        asyncio.run(
            auth.login(
                auth.LoginPayload(usuario="admin", senha="incorreta"),
                RequisicaoFalsa(),
            )
        )

    assert bloqueio.value.status_code == 429
    assert int(bloqueio.value.headers["Retry-After"]) > 0


def test_usuario_inexistente_executa_bcrypt_e_normaliza_data(monkeypatch):
    banco = BancoFalso(
        tentativa={"janelaInicio": datetime.now(timezone.utc).replace(tzinfo=None)}
    )
    hashes_verificados = []

    def verificar(_senha, senha_hash):
        hashes_verificados.append(senha_hash)
        return False

    monkeypatch.setattr(auth, "get_db", lambda: banco)
    monkeypatch.setattr(auth, "verify_password", verificar)

    resposta = asyncio.run(
        auth.login(
            auth.LoginPayload(usuario="  admin  ", senha="incorreta"),
            RequisicaoFalsa(),
        )
    )

    assert resposta == {"ok": False}
    assert banco.admins.consulta == {"usuario": "admin"}
    assert hashes_verificados == [auth._DUMMY_PASSWORD_HASH]
    janela = banco.auth_login_attempts.atualizacao["$set"]["janelaInicio"]
    assert janela.tzinfo is not None
