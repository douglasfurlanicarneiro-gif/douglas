import asyncio

import pytest

from database_integrity import (
    DATABASE_SCHEMA_VERSION,
    INDEX_SPECS,
    ensure_database_schema,
)


class _Collection:
    def __init__(self, *, fail_once=False):
        self.indexes = {"_id_": {"key": [("_id", 1)]}}
        self.fail_once = fail_once
        self.updates = []

    async def create_index(self, keys, *, name, **options):
        if self.fail_once:
            self.fail_once = False
            raise RuntimeError("falha transitória")
        normalized = [(keys, 1)] if isinstance(keys, str) else list(keys)
        self.indexes[name] = {"key": normalized, **options}
        return name

    async def index_information(self):
        return dict(self.indexes)

    async def update_one(self, query, update, *, upsert=False):
        self.updates.append((query, update, upsert))


class _Database:
    def __init__(self, *, failing_collection=None):
        self.collections = {}
        for spec in INDEX_SPECS:
            self.collections.setdefault(
                spec.collection,
                _Collection(fail_once=spec.collection == failing_collection),
            )
        self.collections["configuracoes"] = _Collection()

    def __getitem__(self, name):
        return self.collections.setdefault(name, _Collection())

    def __getattr__(self, name):
        return self[name]


def test_schema_e_idempotente_e_confirma_todos_os_indices():
    db = _Database()

    first = asyncio.run(ensure_database_schema(db))
    second = asyncio.run(ensure_database_schema(db))

    assert first["status"] == second["status"] == "pronto"
    assert first["versao"] == DATABASE_SCHEMA_VERSION
    assert first["indicesConfirmados"] == len(INDEX_SPECS)
    for spec in INDEX_SPECS:
        assert spec.name in db[spec.collection].indexes

    schema_updates = db.configuracoes.updates
    assert schema_updates[-1][1]["$set"]["status"] == "pronto"
    assert schema_updates[-1][1]["$set"]["versao"] == DATABASE_SCHEMA_VERSION


def test_schema_registra_falha_e_pode_ser_repetido_com_sucesso():
    db = _Database(failing_collection="perfumes")

    with pytest.raises(RuntimeError, match="falha transitória"):
        asyncio.run(ensure_database_schema(db))

    assert db.configuracoes.updates[-1][1]["$set"]["status"] == "erro"
    recovered = asyncio.run(ensure_database_schema(db))
    assert recovered["status"] == "pronto"


def test_indices_criticos_preservam_unicidade():
    unique = {
        (spec.collection, spec.name)
        for spec in INDEX_SPECS
        if spec.options.get("unique")
    }

    assert ("admins", "usuario_1") in unique
    assert ("perfumes", "perfumes_seq_unico") in unique
    assert ("pedidos", "pedidos_seq_unico") in unique
    assert ("pedidos", "checkoutIdempotencyKey_1") in unique
    assert ("pedidos", "codigoAcompanhamento_1") in unique
    assert ("solicitacoes_privacidade", "protocolo_1") in unique
