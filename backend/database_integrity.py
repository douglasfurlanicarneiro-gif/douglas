"""Esquema verificavel e idempotente do MongoDB.

O MongoDB cria colecoes sob demanda, mas os indices fazem parte do contrato de
integridade da aplicacao. Este modulo concentra esse contrato, reaplica-o com
seguranca em cada inicializacao e registra a versao efetivamente confirmada.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from collections.abc import Awaitable, Callable
from typing import Any

from pymongo.errors import OperationFailure


DATABASE_SCHEMA_VERSION = 2
DATABASE_SCHEMA_DOCUMENT_ID = "database_schema"


@dataclass(frozen=True)
class IndexSpec:
    collection: str
    keys: str | list[tuple[str, int]]
    name: str
    options: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class MigrationSpec:
    version: int
    name: str
    runner: Callable[[Any], Awaitable[dict[str, int]]]
    preflight: Callable[[Any], Awaitable[dict[str, int]]] | None = None


INDEX_SPECS = (
    IndexSpec("admins", "usuario", "usuario_1", {"unique": True}),
    IndexSpec("auth_login_attempts", "expireAt", "expireAt_1", {"expireAfterSeconds": 0}),
    IndexSpec("auth_revoked_tokens", "expireAt", "expireAt_1", {"expireAfterSeconds": 0}),
    IndexSpec("api_rate_limits", "expiresAt", "expiresAt_1", {"expireAfterSeconds": 0}),
    IndexSpec("oauth_states", "expiraEm", "expiraEm_1", {"expireAfterSeconds": 0}),
    IndexSpec("perfumes", [("publicavel", 1), ("arquivadoEm", 1)], "publicavel_1_arquivadoEm_1"),
    IndexSpec("perfumes", [("arquivadoEm", 1), ("nome", 1)], "arquivadoEm_1_nome_1"),
    IndexSpec("perfumes", "seq", "perfumes_seq_unico", {"unique": True}),
    IndexSpec("pedidos", [("arquivadoEm", 1), ("seq", -1)], "arquivadoEm_1_seq_-1"),
    IndexSpec("pedidos", "seq", "pedidos_seq_unico", {"unique": True}),
    IndexSpec("pedidos", "status", "status_1"),
    IndexSpec("pedidos", [("status", 1), ("arquivadoEm", 1)], "status_1_arquivadoEm_1"),
    IndexSpec("pedidos", [("status", 1), ("criadoEm", -1)], "status_1_criadoEm_-1"),
    IndexSpec(
        "pedidos",
        [("pagamento.status", 1), ("criadoEm", -1)],
        "pagamento.status_1_criadoEm_-1",
    ),
    IndexSpec(
        "pedidos",
        "checkoutIdempotencyKey",
        "checkoutIdempotencyKey_1",
        {"unique": True, "sparse": True},
    ),
    IndexSpec(
        "pedidos",
        "pagamento.transactionNsu",
        "pagamento_transaction_nsu_unico",
        {
            "unique": True,
            "partialFilterExpression": {
                "pagamento.transactionNsu": {"$type": "string"}
            },
        },
    ),
    IndexSpec(
        "pedidos",
        [("pagamentoRequerRevisao", 1), ("criadoEm", -1)],
        "pagamentoRequerRevisao_1_criadoEm_-1",
    ),
    IndexSpec(
        "pedidos",
        "codigoAcompanhamento",
        "codigoAcompanhamento_1",
        {"unique": True, "sparse": True},
    ),
    IndexSpec(
        "eventos_pagamento",
        [("status", 1), ("proximaTentativaEm", 1)],
        "status_1_proximaTentativaEm_1",
    ),
    IndexSpec(
        "database_migrations",
        [("status", 1), ("concluidoEm", -1)],
        "status_1_concluidoEm_-1",
    ),
    IndexSpec(
        "eventos_pagamento",
        [("status", 1), ("leaseExpiraEm", 1)],
        "status_1_leaseExpiraEm_1",
    ),
    IndexSpec("movimentos", [("perfumeId", 1), ("data", -1)], "perfumeId_1_data_-1"),
    IndexSpec("movimentos", "origem", "origem_1"),
    IndexSpec("operacoes_sistema", "data", "data_1"),
    IndexSpec("opinioes", [("arquivadoEm", 1), ("data", -1)], "arquivadoEm_1_data_-1"),
    IndexSpec(
        "opinioes",
        [("aprovada", 1), ("arquivadoEm", 1), ("data", -1)],
        "aprovada_1_arquivadoEm_1_data_-1",
    ),
    IndexSpec("sugestoes", [("arquivadoEm", 1), ("data", -1)], "arquivadoEm_1_data_-1"),
    IndexSpec("compras", [("arquivadoEm", 1), ("data", -1)], "arquivadoEm_1_data_-1"),
    IndexSpec("clientes", "contato", "contato_1"),
    IndexSpec("fornecedores", "nome", "nome_1"),
    IndexSpec(
        "cotacoes_fornecedores",
        [("fornecedorId", 1), ("data", -1)],
        "fornecedorId_1_data_-1",
    ),
    IndexSpec(
        "cotacoes_fornecedores",
        [("perfumeId", 1), ("data", -1)],
        "perfumeId_1_data_-1",
    ),
    IndexSpec("insumos", [("categoria", 1), ("ativo", -1)], "categoria_1_ativo_-1"),
    IndexSpec("insumos", "perfumeId", "perfumeId_1"),
    IndexSpec(
        "movimentos_insumos",
        [("insumoId", 1), ("data", -1)],
        "insumoId_1_data_-1",
    ),
    IndexSpec("producoes", [("perfumeId", 1), ("data", -1)], "perfumeId_1_data_-1"),
    IndexSpec("solicitacoes_privacidade", "protocolo", "protocolo_1", {"unique": True}),
    IndexSpec(
        "solicitacoes_privacidade",
        [("status", 1), ("criadoEm", -1)],
        "status_1_criadoEm_-1",
    ),
)


def _utc_now():
    return datetime.now(timezone.utc)


DATE_FIELDS_BY_COLLECTION: dict[str, tuple[str, ...]] = {
    "perfumes": ("atualizadoEm", "arquivadoEm"),
    "vitrine": ("atualizadoEm",),
    "configuracoes": (
        "atualizadoEm",
        "alteradaEm",
        "publicadaEm",
        "iniciadoEm",
        "concluidoEm",
    ),
    "integracoes": ("expiraEm", "atualizadoEm"),
    "pedidos": (
        "data",
        "criadoEm",
        "reservaExpiraEm",
        "aceitePoliticaPrivacidadeEm",
        "aceitePrazoEncomendaEm",
        "arquivadoEm",
        "checkoutUltimaTentativaEm",
        "checkoutFalhouEm",
        "checkoutConcluidoEm",
    ),
    "compras": ("data", "criadoEm", "arquivadoEm"),
    "movimentos": ("data", "arquivadoEm"),
    "operacoes_sistema": ("data",),
    "opinioes": ("data", "atualizadoEm", "moderadaEm", "arquivadoEm"),
    "sugestoes": ("data", "arquivadoEm"),
    "clientes": ("atualizadoEm", "consentimentoCadastroEm"),
    "fornecedores": ("criadoEm", "atualizadoEm", "arquivadoEm"),
    "cotacoes_fornecedores": ("data",),
    "insumos": ("criadoEm", "atualizadoEm", "arquivadoEm"),
    "movimentos_insumos": ("data",),
    "producoes": ("data",),
    "solicitacoes_privacidade": ("criadoEm", "atualizadoEm", "concluidoEm"),
}


def _date_conversion_expression(field_name: str) -> dict:
    reference = f"${field_name}"
    return {
        "$cond": [
            {"$eq": [{"$type": reference}, "string"]},
            {
                "$convert": {
                    "input": reference,
                    "to": "date",
                    "onError": None,
                    "onNull": None,
                }
            },
            reference,
        ]
    }


def _money_to_cents_expression(reference: Any) -> dict:
    return {
        "$toInt": {
            "$round": [
                {
                    "$multiply": [
                        {
                            "$convert": {
                                "input": reference,
                                "to": "decimal",
                                "onError": 0,
                                "onNull": 0,
                            }
                        },
                        100,
                    ]
                },
                0,
            ]
        }
    }


async def _migrate_dates_and_money_v2(db) -> dict[str, int]:
    """Converte datas ISO e cria a representação monetária em centavos."""
    modified: dict[str, int] = {}
    # O projeto usa ``pymongo.AsyncMongoClient`` (não Motor). Neste driver,
    # ``aggregate`` é assíncrono e precisa ser aguardado antes de ``to_list``.
    duplicate_cursor = await db.pedidos.aggregate(
        [
            {"$match": {"pagamento.transactionNsu": {"$type": "string"}}},
            {
                "$group": {
                    "_id": "$pagamento.transactionNsu",
                    "quantidade": {"$sum": 1},
                }
            },
            {"$match": {"quantidade": {"$gt": 1}}},
            {"$limit": 5},
        ]
    )
    duplicate_transactions = await duplicate_cursor.to_list(5)
    if duplicate_transactions:
        references = ", ".join(str(item.get("_id")) for item in duplicate_transactions)
        raise RuntimeError(
            "Transações InfinitePay duplicadas precisam de conferência antes da "
            f"migração: {references}"
        )
    for collection_name, fields in DATE_FIELDS_BY_COLLECTION.items():
        result = await db[collection_name].update_many(
            {"$or": [{field: {"$type": "string"}} for field in fields]},
            [{"$set": {field: _date_conversion_expression(field) for field in fields}}],
        )
        modified[f"{collection_name}.datas"] = int(result.modified_count)

    history_result = await db.pedidos.update_many(
        {"historicoStatus.data": {"$type": "string"}},
        [
            {
                "$set": {
                    "historicoStatus": {
                        "$map": {
                            "input": {"$ifNull": ["$historicoStatus", []]},
                            "as": "entry",
                            "in": {
                                "$mergeObjects": [
                                    "$$entry",
                                    {
                                        "data": {
                                            "$cond": [
                                                {
                                                    "$eq": [
                                                        {"$type": "$$entry.data"},
                                                        "string",
                                                    ]
                                                },
                                                {
                                                    "$convert": {
                                                        "input": "$$entry.data",
                                                        "to": "date",
                                                        "onError": None,
                                                        "onNull": None,
                                                    }
                                                },
                                                "$$entry.data",
                                            ]
                                        }
                                    },
                                ]
                            },
                        }
                    }
                }
            }
        ],
    )
    modified["pedidos.historicoStatus"] = int(history_result.modified_count)

    money_result = await db.pedidos.update_many(
        {
            "$or": [
                {"subtotalCentavos": {"$exists": False}},
                {"freteCentavos": {"$exists": False}},
                {"totalCentavos": {"$exists": False}},
                {"subtotalTabelaCentavos": {"$exists": False}},
                {"ajusteManualCentavos": {"$exists": False}},
                {"itens.precoUnitarioCentavos": {"$exists": False}},
                {"pagamento.valorCentavos": {"$exists": False}},
                {"pagamento.pagoEm": {"$type": "string"}},
                {"entrega.precoCentavos": {"$exists": False}},
            ]
        },
        [
            {
                "$set": {
                    "subtotalCentavos": {
                        "$ifNull": [
                            "$subtotalCentavos",
                            _money_to_cents_expression("$subtotal"),
                        ]
                    },
                    "freteCentavos": {
                        "$ifNull": [
                            "$freteCentavos",
                            _money_to_cents_expression("$frete"),
                        ]
                    },
                    "totalCentavos": {
                        "$ifNull": [
                            "$totalCentavos",
                            _money_to_cents_expression("$total"),
                        ]
                    },
                    "subtotalTabelaCentavos": {
                        "$ifNull": [
                            "$subtotalTabelaCentavos",
                            _money_to_cents_expression("$subtotalTabela"),
                        ]
                    },
                    "ajusteManualCentavos": {
                        "$ifNull": [
                            "$ajusteManualCentavos",
                            _money_to_cents_expression("$ajusteManual"),
                        ]
                    },
                    "pagamento": {
                        "$cond": [
                            {"$eq": [{"$type": "$pagamento"}, "object"]},
                            {
                                "$mergeObjects": [
                                    "$pagamento",
                                    {
                                        "valorCentavos": {
                                            "$ifNull": [
                                                "$pagamento.valorCentavos",
                                                _money_to_cents_expression(
                                                    {
                                                        "$ifNull": [
                                                            "$pagamento.valor",
                                                            "$total",
                                                        ]
                                                    }
                                                ),
                                            ]
                                        },
                                        "pagoEm": {
                                            "$cond": [
                                                {
                                                    "$eq": [
                                                        {"$type": "$pagamento.pagoEm"},
                                                        "string",
                                                    ]
                                                },
                                                {
                                                    "$convert": {
                                                        "input": "$pagamento.pagoEm",
                                                        "to": "date",
                                                        "onError": None,
                                                        "onNull": None,
                                                    }
                                                },
                                                "$pagamento.pagoEm",
                                            ]
                                        },
                                    },
                                ]
                            },
                            "$pagamento",
                        ]
                    },
                    "entrega": {
                        "$cond": [
                            {"$eq": [{"$type": "$entrega"}, "object"]},
                            {
                                "$mergeObjects": [
                                    "$entrega",
                                    {
                                        "precoCentavos": {
                                            "$ifNull": [
                                                "$entrega.precoCentavos",
                                                _money_to_cents_expression(
                                                    "$entrega.preco"
                                                ),
                                            ]
                                        }
                                    },
                                ]
                            },
                            "$entrega",
                        ]
                    },
                    "itens": {
                        "$map": {
                            "input": {"$ifNull": ["$itens", []]},
                            "as": "item",
                            "in": {
                                "$mergeObjects": [
                                    "$$item",
                                    {
                                        "precoUnitarioCentavos": {
                                            "$ifNull": [
                                                "$$item.precoUnitarioCentavos",
                                                _money_to_cents_expression(
                                                    "$$item.precoUnitario"
                                                ),
                                            ]
                                        },
                                        "subtotalCentavos": {
                                            "$ifNull": [
                                                "$$item.subtotalCentavos",
                                                _money_to_cents_expression(
                                                    {
                                                        "$ifNull": [
                                                            "$$item.subtotal",
                                                            {
                                                                "$multiply": [
                                                                    {
                                                                        "$ifNull": [
                                                                            "$$item.precoUnitario",
                                                                            0,
                                                                        ]
                                                                    },
                                                                    {
                                                                        "$ifNull": [
                                                                            "$$item.quantidade",
                                                                            1,
                                                                        ]
                                                                    },
                                                                ]
                                                            },
                                                        ]
                                                    }
                                                ),
                                            ]
                                        },
                                    },
                                ]
                            },
                        }
                    },
                }
            }
        ],
    )
    modified["pedidos.valoresCentavos"] = int(money_result.modified_count)
    # A versão anterior possuía o mesmo campo sem unicidade. Removê-la antes
    # de criar o índice único evita opções conflitantes no MongoDB.
    try:
        await db.pedidos.drop_index("pagamento.transactionNsu_1")
        modified["pedidos.indicePagamentoLegadoRemovido"] = 1
    except OperationFailure as exc:
        if exc.code != 27:  # IndexNotFound
            raise
        modified["pedidos.indicePagamentoLegadoRemovido"] = 0
    return modified


async def _preflight_dates_and_money_v2(db) -> dict[str, int]:
    """Conta o impacto esperado sem modificar qualquer documento."""
    plan: dict[str, int] = {}
    for collection_name, fields in DATE_FIELDS_BY_COLLECTION.items():
        plan[f"{collection_name}.datas"] = int(
            await db[collection_name].count_documents(
                {"$or": [{field: {"$type": "string"}} for field in fields]}
            )
        )
    plan["pedidos.historicoStatus"] = int(
        await db.pedidos.count_documents(
            {"historicoStatus.data": {"$type": "string"}}
        )
    )
    plan["pedidos.valoresCentavos"] = int(
        await db.pedidos.count_documents(
            {
                "$or": [
                    {"subtotalCentavos": {"$exists": False}},
                    {"freteCentavos": {"$exists": False}},
                    {"totalCentavos": {"$exists": False}},
                    {"itens.precoUnitarioCentavos": {"$exists": False}},
                ]
            }
        )
    )
    return plan


MIGRATIONS = (
    MigrationSpec(
        2,
        "datas_bson_e_valores_em_centavos",
        _migrate_dates_and_money_v2,
        _preflight_dates_and_money_v2,
    ),
)


async def _apply_pending_migrations(db) -> list[int]:
    state = await db.configuracoes.find_one({"_id": DATABASE_SCHEMA_DOCUMENT_ID}) or {}
    current_version = int(state.get("versao", 0) or 0)
    applied: list[int] = []
    for migration in MIGRATIONS:
        if migration.version <= current_version:
            continue
        plan = await migration.preflight(db) if migration.preflight else {}
        await db.database_migrations.update_one(
            {"_id": migration.version},
            {
                "$set": {
                    "nome": migration.name,
                    "status": "aplicando",
                    "iniciadoEm": _utc_now(),
                    "plano": plan,
                },
                "$unset": {"erro": "", "concluidoEm": ""},
            },
            upsert=True,
        )
        try:
            result = await migration.runner(db)
        except Exception as exc:
            await db.database_migrations.update_one(
                {"_id": migration.version},
                {
                    "$set": {
                        "status": "erro",
                        "erro": f"{type(exc).__name__}: {str(exc)[:500]}",
                        "falhouEm": _utc_now(),
                    }
                },
                upsert=True,
            )
            raise
        completed_at = _utc_now()
        await db.database_migrations.update_one(
            {"_id": migration.version},
            {
                "$set": {
                    "status": "concluida",
                    "resultado": result,
                    "concluidoEm": completed_at,
                },
                "$unset": {"erro": "", "falhouEm": ""},
            },
            upsert=True,
        )
        await db.configuracoes.update_one(
            {"_id": DATABASE_SCHEMA_DOCUMENT_ID},
            {"$set": {"versao": migration.version, "atualizadoEm": completed_at}},
            upsert=True,
        )
        current_version = migration.version
        applied.append(migration.version)
    return applied


async def _record_schema_state(db, *, status: str, **values) -> None:
    update = {
        "$set": {
            "status": status,
            "versaoAlvo": DATABASE_SCHEMA_VERSION,
            "atualizadoEm": _utc_now(),
            **values,
        }
    }
    if status != "erro":
        update["$unset"] = {"erro": ""}
    await db.configuracoes.update_one(
        {"_id": DATABASE_SCHEMA_DOCUMENT_ID},
        update,
        upsert=True,
    )


async def ensure_database_schema(db) -> dict:
    """Cria e confirma todos os indices, podendo ser executado repetidamente."""
    await _record_schema_state(db, status="aplicando", iniciadoEm=_utc_now())
    try:
        migrations_applied = await _apply_pending_migrations(db)
        for spec in INDEX_SPECS:
            await db[spec.collection].create_index(
                spec.keys,
                name=spec.name,
                **spec.options,
            )

        by_collection: dict[str, set[str]] = {}
        for spec in INDEX_SPECS:
            by_collection.setdefault(spec.collection, set()).add(spec.name)
        for collection_name, expected_names in by_collection.items():
            current = await db[collection_name].index_information()
            missing = expected_names.difference(current)
            if missing:
                names = ", ".join(sorted(missing))
                raise RuntimeError(
                    f"Indices nao confirmados em {collection_name}: {names}"
                )
    except Exception as exc:
        try:
            await _record_schema_state(
                db,
                status="erro",
                erro=f"{type(exc).__name__}: {str(exc)[:300]}",
            )
        except Exception:
            # A falha original é a informação mais importante; o bootstrap
            # registrará e repetirá a aplicação mesmo se o ledger estiver
            # temporariamente indisponível.
            pass
        raise

    completed_at = _utc_now()
    await _record_schema_state(
        db,
        status="pronto",
        versao=DATABASE_SCHEMA_VERSION,
        indicesConfirmados=len(INDEX_SPECS),
        migracoesAplicadas=migrations_applied,
        concluidoEm=completed_at,
    )
    return {
        "status": "pronto",
        "versao": DATABASE_SCHEMA_VERSION,
        "indicesConfirmados": len(INDEX_SPECS),
        "migracoesAplicadas": migrations_applied,
        "concluidoEm": completed_at,
    }
