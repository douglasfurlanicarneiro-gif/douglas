"""Esquema verificavel e idempotente do MongoDB.

O MongoDB cria colecoes sob demanda, mas os indices fazem parte do contrato de
integridade da aplicacao. Este modulo concentra esse contrato, reaplica-o com
seguranca em cada inicializacao e registra a versao efetivamente confirmada.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


DATABASE_SCHEMA_VERSION = 1
DATABASE_SCHEMA_DOCUMENT_ID = "database_schema"


@dataclass(frozen=True)
class IndexSpec:
    collection: str
    keys: str | list[tuple[str, int]]
    name: str
    options: dict[str, Any] = field(default_factory=dict)


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
    IndexSpec(
        "pedidos",
        "checkoutIdempotencyKey",
        "checkoutIdempotencyKey_1",
        {"unique": True, "sparse": True},
    ),
    IndexSpec("pedidos", "pagamento.transactionNsu", "pagamento.transactionNsu_1", {"sparse": True}),
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
        concluidoEm=completed_at,
    )
    return {
        "status": "pronto",
        "versao": DATABASE_SCHEMA_VERSION,
        "indicesConfirmados": len(INDEX_SPECS),
        "concluidoEm": completed_at,
    }
