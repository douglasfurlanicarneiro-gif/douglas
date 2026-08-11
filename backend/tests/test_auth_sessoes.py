import asyncio

import pytest
from fastapi import HTTPException

import security
from routers.auth import _login_key


class ColecaoAdminFalsa:
    def __init__(self, auth_version=1):
        self.auth_version = auth_version

    async def find_one(self, _query, _projection=None):
        return {"usuario": "admin", "authVersion": self.auth_version}


class ColecaoRevogacaoFalsa:
    def __init__(self, revogado=False):
        self.revogado = revogado

    async def find_one(self, _query, _projection=None):
        return {"_id": "revogado"} if self.revogado else None


class BancoFalso:
    def __init__(self, *, auth_version=1, revogado=False):
        self.admins = ColecaoAdminFalsa(auth_version)
        self.auth_revoked_tokens = ColecaoRevogacaoFalsa(revogado)


class RequisicaoFalsa:
    headers = {"x-forwarded-for": "198.51.100.1, 203.0.113.8"}
    client = None


def test_token_tem_identificador_tipo_e_versao(monkeypatch):
    monkeypatch.setattr(security, "JWT_SECRET", "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres")
    token = security.create_token("admin", auth_version=7)
    claims = security.decode_token_claims(token)

    assert claims is not None
    assert claims["sub"] == "admin"
    assert claims["typ"] == "atelie-admin"
    assert claims["av"] == 7
    assert len(claims["jti"]) >= 24


def test_sessao_revogada_e_versao_antiga_sao_rejeitadas(monkeypatch):
    monkeypatch.setattr(security, "JWT_SECRET", "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres")
    token = security.create_token("admin", auth_version=1)

    monkeypatch.setattr(
        security,
        "get_db",
        lambda: BancoFalso(auth_version=1, revogado=True),
    )
    with pytest.raises(HTTPException) as revogada:
        asyncio.run(security.require_atelie_auth(token))
    assert revogada.value.status_code == 401

    monkeypatch.setattr(
        security,
        "get_db",
        lambda: BancoFalso(auth_version=2, revogado=False),
    )
    with pytest.raises(HTTPException) as antiga:
        asyncio.run(security.require_atelie_auth(token))
    assert antiga.value.status_code == 401


def test_limitador_de_login_anonimiza_ip_e_normaliza_usuario():
    primeira = _login_key(RequisicaoFalsa(), " Admin ")
    segunda = _login_key(RequisicaoFalsa(), "admin")

    assert primeira == segunda
    assert len(primeira) == 32
    assert "198.51.100.1" not in primeira
    assert "203.0.113.8" not in primeira


def test_token_excessivamente_longo_e_rejeitado_antes_da_decodificacao(monkeypatch):
    def nao_deveria_decodificar(_token):
        raise AssertionError("token excessivo nao deve chegar ao decodificador")

    monkeypatch.setattr(security, "decode_token_claims", nao_deveria_decodificar)
    with pytest.raises(HTTPException) as erro:
        asyncio.run(security.require_atelie_auth("x" * 4_097))

    assert erro.value.status_code == 401


def test_step_up_tem_escopo_curto_e_nao_aceita_token_comum(monkeypatch):
    monkeypatch.setattr(security, "JWT_SECRET", "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres")
    token = security.create_step_up_token("admin", auth_version=3)
    claims = security.decode_step_up_token_claims(token)

    assert claims is not None
    assert claims["typ"] == "atelie-step-up"
    assert claims["scope"] == "critical:write"
    assert claims["av"] == 3
    assert claims["exp"] - claims["iat"] == 300
    assert security.decode_step_up_token_claims(
        security.create_token("admin", auth_version=3)
    ) is None


def test_step_up_exige_mesmo_usuario_e_versao_atual(monkeypatch):
    monkeypatch.setattr(security, "JWT_SECRET", "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres")
    monkeypatch.setattr(
        security,
        "get_db",
        lambda: BancoFalso(auth_version=4, revogado=False),
    )
    token = security.create_step_up_token("admin", auth_version=4)
    assert asyncio.run(security.require_step_up_auth("admin", token)) == "admin"

    with pytest.raises(HTTPException) as usuario_incorreto:
        asyncio.run(security.require_step_up_auth("outra-conta", token))
    assert usuario_incorreto.value.status_code == 403

    token_antigo = security.create_step_up_token("admin", auth_version=3)
    with pytest.raises(HTTPException) as versao_antiga:
        asyncio.run(security.require_step_up_auth("admin", token_antigo))
    assert versao_antiga.value.status_code == 403
