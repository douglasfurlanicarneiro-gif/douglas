import asyncio

import pytest
from fastapi import HTTPException, Response

import server


class _ReadyDatabase:
    async def command(self, command):
        assert command == "ping"
        return {"ok": 1}


def test_ready_exige_bootstrap_integral(monkeypatch):
    monkeypatch.setattr(server, "get_db", lambda: _ReadyDatabase())
    monkeypatch.setitem(server._BOOTSTRAP_STATE, "status", "iniciando")
    monkeypatch.setitem(server._BOOTSTRAP_STATE, "tentativas", 1)

    with pytest.raises(HTTPException) as erro:
        asyncio.run(server.health_ready(Response()))

    assert erro.value.status_code == 503
    assert erro.value.headers["Retry-After"] == "5"


def test_ready_confirma_esquema_e_banco(monkeypatch):
    monkeypatch.setattr(server, "get_db", lambda: _ReadyDatabase())
    monkeypatch.setitem(server._BOOTSTRAP_STATE, "status", "pronto")
    monkeypatch.setitem(server._BOOTSTRAP_STATE, "tentativas", 2)
    response = Response()

    result = asyncio.run(server.health_ready(response))

    assert result["status"] == "ready"
    assert result["database"] == "ok"
    assert result["databaseSchema"] == "ok"
    assert result["bootstrapAttempts"] == 2
    assert response.headers["Cache-Control"] == "no-store"
