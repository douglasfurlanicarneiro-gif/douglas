import asyncio

from bson import ObjectId

from routers import movimentos


class FakeCursor:
    def __init__(self, documentos):
        self.documentos = documentos

    async def to_list(self, _limite):
        return list(self.documentos)


class FakePerfumes:
    def __init__(self, documentos):
        self.documentos = documentos

    def find(self, _filtro, _projecao):
        return FakeCursor(self.documentos)


class FakeDb:
    def __init__(self, documentos):
        self.perfumes = FakePerfumes(documentos)


def test_resumo_inclui_perfume_novo_sem_movimento(monkeypatch):
    perfume_id = ObjectId()
    db = FakeDb([{"_id": perfume_id}])

    async def fake_saldo(_db):
        return {}

    async def fake_reservado(_db):
        return {}

    monkeypatch.setattr(movimentos, "get_db", lambda: db)
    monkeypatch.setattr(movimentos, "mapa_saldo_fisico", fake_saldo)
    monkeypatch.setattr(movimentos, "mapa_reservado", fake_reservado)

    resumo = asyncio.run(movimentos.resumo_estoque())

    assert resumo[str(perfume_id)] == {
        "saldoAtualMl": 0,
        "reservadoMl": 0,
        "disponivelMl": 0,
    }
