import asyncio
from contextlib import asynccontextmanager

import pytest
from bson import ObjectId
from fastapi import HTTPException

from routers import movimentos, pedidos
from routers.pedidos import _sincronizar_movimentos_do_pedido


class Result:
    def __init__(self, *, matched_count=1, inserted_id=None):
        self.matched_count = matched_count
        self.inserted_id = inserted_id or ObjectId()


class FakeCollection:
    def __init__(self, document=None):
        self.document = document
        self.inserted = []

    async def find_one(self, query):
        if self.document and self.document.get("_id") == query.get("_id"):
            return dict(self.document)
        return None

    async def update_one(self, query, update):
        if not self.document or self.document.get("_id") != query.get("_id"):
            return Result(matched_count=0)
        for key, value in update.get("$set", {}).items():
            self.document[key] = value
        for key in update.get("$unset", {}):
            self.document.pop(key, None)
        return Result()

    async def insert_one(self, document):
        saved = {"_id": ObjectId(), **document}
        self.inserted.append(saved)
        return Result(inserted_id=saved["_id"])


class FakeDb:
    def __init__(self, *, pedido=None, movimento=None):
        self.pedidos = FakeCollection(pedido)
        self.movimentos = FakeCollection(movimento)
        self.operacoes_sistema = FakeCollection()


@asynccontextmanager
async def unlocked(*_args, **_kwargs):
    yield


def test_pedido_cancelado_e_arquivado_sem_excluir(monkeypatch):
    pedido = {
        "_id": ObjectId(),
        "seq": 42,
        "status": "cancelado",
        "cliente": "Cliente",
    }
    db = FakeDb(pedido=pedido)
    monkeypatch.setattr(pedidos, "get_db", lambda: db)
    monkeypatch.setattr(pedidos, "stock_lock", unlocked)

    resposta = asyncio.run(pedidos.apagar_pedido(str(pedido["_id"]), "admin"))

    assert "arquivado" in resposta["status"].lower()
    assert db.pedidos.document["arquivadoPor"] == "administrador"
    assert db.pedidos.document["status"] == "cancelado"
    assert db.operacoes_sistema.inserted[0]["acao"] == "arquivar"


def test_pedido_ativo_nao_pode_ser_arquivado(monkeypatch):
    pedido = {"_id": ObjectId(), "seq": 43, "status": "preparando"}
    db = FakeDb(pedido=pedido)
    monkeypatch.setattr(pedidos, "get_db", lambda: db)
    monkeypatch.setattr(pedidos, "stock_lock", unlocked)

    with pytest.raises(HTTPException) as erro:
        asyncio.run(pedidos.apagar_pedido(str(pedido["_id"]), "admin"))

    assert erro.value.status_code == 409
    assert "arquivadoEm" not in db.pedidos.document


def test_exclusao_de_movimento_cria_estorno_e_preserva_original(monkeypatch):
    movimento = {
        "_id": ObjectId(),
        "perfumeId": "perfume-1",
        "tipo": "entrada",
        "quantidadeMl": 100,
        "categoria": "ajuste",
        "origem": "manual",
    }
    db = FakeDb(movimento=movimento)
    monkeypatch.setattr(movimentos, "get_db", lambda: db)
    monkeypatch.setattr(movimentos, "stock_lock", unlocked)

    resposta = asyncio.run(
        movimentos.apagar_movimento(str(movimento["_id"]), "admin")
    )

    assert "estornado" in resposta["status"].lower()
    assert db.movimentos.document["anuladoPor"] == "administrador"
    estorno = db.movimentos.inserted[0]
    assert estorno["tipo"] == "saida"
    assert estorno["quantidadeMl"] == 100
    assert estorno["categoria"] == "estorno"
    assert db.operacoes_sistema.inserted[0]["acao"] == "estornar"


class LedgerCursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, _length):
        return [dict(item) for item in self.documents]


class LedgerMovimentos:
    def __init__(self):
        self.documents = []

    def find(self, query, _projection):
        return LedgerCursor([
            item for item in self.documents if item.get("origem") == query["origem"]
        ])

    async def insert_many(self, documents):
        self.documents.extend(dict(item) for item in documents)


def test_baixa_de_pedido_e_idempotente_e_cancelamento_cria_estorno():
    class LedgerDb:
        movimentos = LedgerMovimentos()

    db = LedgerDb()
    itens = [{"perfumeId": "perfume-1", "ml": 50, "quantidade": 2}]

    asyncio.run(_sincronizar_movimentos_do_pedido(db, "pedido-1", itens, "preparando"))
    asyncio.run(_sincronizar_movimentos_do_pedido(db, "pedido-1", itens, "preparando"))
    assert len(db.movimentos.documents) == 1
    assert db.movimentos.documents[0]["tipo"] == "saida"
    assert db.movimentos.documents[0]["quantidadeMl"] == 100

    asyncio.run(_sincronizar_movimentos_do_pedido(db, "pedido-1", [], "cancelado"))
    assert len(db.movimentos.documents) == 2
    assert db.movimentos.documents[1]["tipo"] == "entrada"
    assert db.movimentos.documents[1]["quantidadeMl"] == 100
