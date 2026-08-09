import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from routers import vitrine


class FakeConfiguracoes:
    def __init__(self):
        self.document = None

    async def find_one(self, query):
        if self.document and self.document.get("_id") == query.get("_id"):
            return dict(self.document)
        return None

    async def update_one(self, query, update, upsert=False):
        if self.document is None:
            if not upsert:
                return
            self.document = {"_id": query["_id"]}
            self.document.update(update.get("$setOnInsert", {}))
        if "revisao" in query and self.document.get("revisao") != query["revisao"]:
            return
        for key, value in update.get("$inc", {}).items():
            self.document[key] = self.document.get(key, 0) + value
        self.document.update(update.get("$set", {}))


class FakeDb:
    def __init__(self):
        self.configuracoes = FakeConfiguracoes()


def test_edicoes_seguidas_incrementam_revisao_e_mantem_publicacao_pendente(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(vitrine, "_agendar_publicacao", lambda _: None)

    asyncio.run(vitrine.marcar_vitrine_pendente(db))
    asyncio.run(vitrine.marcar_vitrine_pendente(db))

    assert db.configuracoes.document["revisao"] == 2
    assert db.configuracoes.document["pendente"] is True
    assert isinstance(db.configuracoes.document["alteradaEm"], datetime)


def test_atualizacao_forcada_publica_mesmo_durante_janela_de_agrupamento(monkeypatch):
    db = FakeDb()
    db.configuracoes.document = {
        "_id": vitrine._PUBLICATION_STATE_ID,
        "revisao": 3,
        "pendente": True,
        "alteradaEm": datetime.now(timezone.utc),
    }
    chamadas = []

    @asynccontextmanager
    async def fake_lock(*args, **kwargs):
        yield

    async def fake_publish(_db, registrar_operacao=True):
        chamadas.append(registrar_operacao)
        db.configuracoes.document["pendente"] = False
        return {"itensPublicados": 10}

    monkeypatch.setattr(vitrine, "distributed_lock", fake_lock)
    monkeypatch.setattr(vitrine, "_publicar_snapshot_sem_trava", fake_publish)

    resultado = asyncio.run(vitrine.garantir_vitrine_atualizada(db, forcar=True))

    assert resultado == {"itensPublicados": 10}
    assert chamadas == [True]


def test_janela_de_agrupamento_evitas_publicacoes_intermediarias(monkeypatch):
    db = FakeDb()
    db.configuracoes.document = {
        "_id": vitrine._PUBLICATION_STATE_ID,
        "revisao": 1,
        "pendente": True,
        "alteradaEm": datetime.now(timezone.utc),
    }

    async def fail_publish(*args, **kwargs):
        raise AssertionError("não deveria publicar antes do fim da janela")

    monkeypatch.setattr(vitrine, "_publicar_snapshot_sem_trava", fail_publish)

    assert asyncio.run(vitrine.garantir_vitrine_atualizada(db)) is None
    assert db.configuracoes.document["pendente"] is True
