import asyncio

from bson import ObjectId
from fastapi import HTTPException
import pytest

from routers import acompanhamento
from routers.acompanhamento import pode_cancelar_pedido


def test_cliente_pode_cancelar_enquanto_aguarda_pagamento():
    assert pode_cancelar_pedido({"status": "pendente"}) is True


def test_cliente_nao_pode_cancelar_depois_da_confirmacao():
    for status in (
        "pagamento_confirmado",
        "preparando",
        "pronto",
        "enviado",
        "entregue",
        "cancelado",
    ):
        assert pode_cancelar_pedido({"status": status}) is False


class FakePedidos:
    def __init__(self, pedido):
        self.pedido = pedido

    async def find_one(self, query):
        if "_id" in query:
            return self.pedido if self.pedido["_id"] == query["_id"] else None
        return self.pedido if self.pedido["codigoAcompanhamento"] == query.get("codigoAcompanhamento") else None

    async def update_one(self, query, update):
        if self.pedido["_id"] == query["_id"] and self.pedido["status"] == query["status"]:
            self.pedido.update(update["$set"])


class FakeDb:
    def __init__(self, pedido):
        self.pedidos = FakePedidos(pedido)


def test_cancelamento_publico_preserva_historico(monkeypatch):
    pedido = {
        "_id": ObjectId(),
        "seq": 2,
        "codigoAcompanhamento": "codigo-seguro-123",
        "status": "pendente",
        "itens": [],
        "total": 181.39,
        "criadoEm": "2026-07-28T20:00:00+00:00",
        "historicoStatus": [{"status": "pendente", "data": "2026-07-28T20:00:00+00:00"}],
    }
    db = FakeDb(pedido)

    async def fake_reverter(_db, _pedido_id):
        return None

    monkeypatch.setattr(acompanhamento, "get_db", lambda: db)
    monkeypatch.setattr(acompanhamento, "_reverter_movimentos_do_pedido", fake_reverter)

    resposta = asyncio.run(acompanhamento.cancelar_pedido_cliente("codigo-seguro-123"))

    assert resposta["status"] == "cancelado"
    assert resposta["historicoStatus"][-1]["status"] == "cancelado"


def test_cancelamento_publico_bloqueia_pedido_em_atendimento(monkeypatch):
    pedido = {
        "_id": ObjectId(),
        "codigoAcompanhamento": "codigo-seguro-456",
        "status": "preparando",
    }
    monkeypatch.setattr(acompanhamento, "get_db", lambda: FakeDb(pedido))

    with pytest.raises(HTTPException) as error:
        asyncio.run(acompanhamento.cancelar_pedido_cliente("codigo-seguro-456"))

    assert error.value.status_code == 409
