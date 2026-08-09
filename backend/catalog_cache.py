"""Cache local e invalidável do catálogo público.

O checkout continua validando o estoque no MongoDB sob trava distribuída. Este
cache serve apenas a leitura da vitrine e é descartado sempre que catálogo,
estoque ou reservas mudam.
"""

import asyncio
import time
from typing import Any


CATALOG_CACHE_TTL_SECONDS = 60
build_lock = asyncio.Lock()

_payload: dict[str, Any] | None = None
_expires_at = 0.0
_generation = 0


def generation() -> int:
    return _generation


def get_cached_catalog() -> dict[str, Any] | None:
    if _payload is None or time.monotonic() >= _expires_at:
        return None
    return _payload


def set_cached_catalog(payload: dict[str, Any], expected_generation: int) -> bool:
    global _payload, _expires_at
    if expected_generation != _generation:
        return False
    _payload = payload
    _expires_at = time.monotonic() + CATALOG_CACHE_TTL_SECONDS
    return True


def invalidate_catalog_cache() -> None:
    global _payload, _expires_at, _generation
    _payload = None
    _expires_at = 0.0
    _generation += 1
