"""Travas distribuídas para operações críticas de estoque.

A trava fica no MongoDB, portanto continua válida mesmo quando o Render abre
mais de um processo ou substitui uma instância durante um deploy. O prazo de
validade impede que uma falha no meio da operação bloqueie o estoque para
sempre.
"""

import asyncio
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from time import monotonic

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError


_process_fallback_lock = asyncio.Lock()
_LOCK_ID = "estoque-global"
logger = logging.getLogger("atelie.stock-lock")


@asynccontextmanager
async def _fallback_lock():
    """Mantém testes e ambientes sem Mongo funcionais."""
    async with _process_fallback_lock:
        yield


@asynccontextmanager
async def stock_lock(db, *, wait_seconds: float = 5, lease_seconds: int = 60):
    """Adquire uma trava de estoque compartilhada por todas as instâncias.

    A coleção é criada automaticamente pelo MongoDB. Em objetos falsos usados
    por testes unitários, a trava local é suficiente e evita exigir uma
    implementação completa do banco.
    """
    collection = getattr(db, "system_locks", None)
    if collection is None or not hasattr(collection, "find_one_and_update"):
        async with _fallback_lock():
            yield
        return

    owner = secrets.token_hex(16)
    deadline = monotonic() + wait_seconds
    acquired = False

    while monotonic() < deadline:
        now = datetime.now(timezone.utc)
        try:
            document = await collection.find_one_and_update(
                {
                    "_id": _LOCK_ID,
                    "$or": [
                        {"owner": {"$exists": False}},
                        {"owner": None},
                        {"expiresAt": {"$lte": now}},
                    ],
                },
                {
                    "$set": {
                        "owner": owner,
                        "expiresAt": now + timedelta(seconds=lease_seconds),
                        "updatedAt": now,
                    }
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
        except DuplicateKeyError:
            # Outra instância adquiriu a trava entre a busca e o upsert.
            document = None

        if document and document.get("owner") == owner:
            acquired = True
            break
        await asyncio.sleep(0.06)

    if not acquired:
        raise HTTPException(
            status_code=503,
            detail=(
                "O estoque está sendo atualizado neste momento. "
                "Aguarde alguns segundos e tente novamente."
            ),
        )

    try:
        yield
    finally:
        try:
            await collection.update_one(
                {"_id": _LOCK_ID, "owner": owner},
                {
                    "$unset": {"owner": "", "expiresAt": ""},
                    "$set": {"updatedAt": datetime.now(timezone.utc)},
                },
            )
        except Exception:
            # A operação protegida já terminou; não transforme uma falha de
            # liberação em erro para o cliente. O lease expira sozinho.
            logger.exception("Não foi possível liberar a trava de estoque.")
