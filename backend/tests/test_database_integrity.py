import asyncio

import pytest

from database_integrity import (
    DATABASE_SCHEMA_VERSION,
    INDEX_SPECS,
    MIGRATIONS,
    _migrate_dates_and_money_v2,
    ensure_database_schema,
)


class _Collection:
    def __init__(self, *, fail_once=False):
        self.indexes = {"_id_": {"key": [("_id", 1)]}}
        self.fail_once = fail_once
        self.updates = []
        self.bulk_updates = []
        self.documents = {}
        self.aggregate_results = []

    async def create_index(self, keys, *, name, **options):
        if self.fail_once:
            self.fail_once = False
            raise RuntimeError("falha transitória")
        normalized = [(keys, 1)] if isinstance(keys, str) else list(keys)
        self.indexes[name] = {"key": normalized, **options}
        return name

    async def index_information(self):
        return dict(self.indexes)

    async def drop_index(self, name):
        self.indexes.pop(name, None)

    async def update_one(self, query, update, *, upsert=False):
        self.updates.append((query, update, upsert))
        document_id = query.get("_id")
        document = self.documents.setdefault(document_id, {"_id": document_id})
        document.update(update.get("$set", {}))
        for key in update.get("$unset", {}):
            document.pop(key, None)

    async def find_one(self, query):
        document = self.documents.get(query.get("_id"))
        return dict(document) if document else None

    async def update_many(self, query, update):
        self.bulk_updates.append((query, update))
        return type("UpdateResult", (), {"modified_count": 0})()

    async def count_documents(self, _query):
        return 0

    def aggregate(self, pipeline):
        self.bulk_updates.append(({"aggregate": True}, pipeline))
        return _AggregationCursor(self.aggregate_results)


class _AggregationCursor:
    def __init__(self, values):
        self.values = values

    async def to_list(self, limit):
        return list(self.values[:limit])


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
    assert first["migracoesAplicadas"] == [2]
    assert second["migracoesAplicadas"] == []
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
    assert ("pedidos", "pagamento_transaction_nsu_unico") in unique
    assert ("pedidos", "codigoAcompanhamento_1") in unique
    assert ("solicitacoes_privacidade", "protocolo_1") in unique


def test_migracao_v2_converte_datas_e_valores_sem_processar_documentos_em_memoria():
    db = _Database()

    result = asyncio.run(ensure_database_schema(db))

    assert DATABASE_SCHEMA_VERSION == 2
    assert [migration.version for migration in MIGRATIONS] == [2]
    assert result["migracoesAplicadas"] == [2]
    assert db.pedidos.bulk_updates
    assert any(
        "totalCentavos" in str(pipeline)
        for _query, pipeline in db.pedidos.bulk_updates
    )
    migration = db.database_migrations.documents[2]
    assert migration["status"] == "concluida"
    assert migration["nome"] == "datas_bson_e_valores_em_centavos"
    assert "pedidos.valoresCentavos" in migration["plano"]


def test_migracao_interrompe_antes_do_indice_se_houver_transacao_duplicada():
    db = _Database()
    db.pedidos.aggregate_results = [{"_id": "transaction-duplicada", "quantidade": 2}]

    with pytest.raises(RuntimeError, match="transaction-duplicada"):
        asyncio.run(_migrate_dates_and_money_v2(db))

    assert not any(
        query.get("$or")
        for query, _pipeline in db.pedidos.bulk_updates
        if isinstance(query, dict)
    )
