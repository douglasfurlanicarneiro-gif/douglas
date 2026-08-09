"""Limites distribuídos para rotas públicas suscetíveis a abuso."""

from datetime import datetime, timedelta, timezone
import asyncio
import logging

from fastapi import HTTPException, Request
from pymongo import ReturnDocument

from client_identity import anonymous_client_key
from database import get_db

logger = logging.getLogger("atelie.rate-limit")
_fallback_counters: dict[str, tuple[int, datetime]] = {}
_fallback_lock = asyncio.Lock()


async def _fallback_increment(key: str, expires_at: datetime) -> int:
    """Mantém a proteção ativa mesmo durante uma falha temporária do MongoDB."""
    async with _fallback_lock:
        now = datetime.now(timezone.utc)
        if len(_fallback_counters) >= 2_000:
            stale = [stored_key for stored_key, (_, expiry) in _fallback_counters.items() if expiry <= now]
            for stored_key in stale:
                _fallback_counters.pop(stored_key, None)
        count, _ = _fallback_counters.get(key, (0, expires_at))
        count += 1
        _fallback_counters[key] = (count, expires_at)
        return count


def rate_limit(scope: str, *, max_requests: int, window_seconds: int):
    """Cria uma dependência FastAPI com contador compartilhado pelo MongoDB."""
    safe_scope = "".join(char for char in scope if char.isalnum() or char in "-_")

    async def dependency(request: Request) -> None:
        now = datetime.now(timezone.utc)
        bucket = int(now.timestamp()) // window_seconds
        client_key = anonymous_client_key(request, safe_scope)
        key = f"{safe_scope}:{client_key}:{bucket}"
        expires_at = now + timedelta(seconds=window_seconds * 2)
        try:
            result = await get_db().api_rate_limits.find_one_and_update(
                {"_id": key},
                {
                    "$inc": {"count": 1},
                    "$setOnInsert": {
                        "scope": safe_scope,
                        "expiresAt": expires_at,
                    },
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            count = int((result or {}).get("count", 0))
        except Exception:
            logger.exception(
                "Rate limit distribuído indisponível em %s; usando proteção local.",
                safe_scope,
            )
            count = await _fallback_increment(key, expires_at)

        if count > max_requests:
            retry_after = window_seconds - (int(now.timestamp()) % window_seconds)
            raise HTTPException(
                status_code=429,
                detail="Muitas solicitações. Aguarde um pouco e tente novamente.",
                headers={"Retry-After": str(max(1, retry_after))},
            )

    return dependency


checkout_rate_limit = rate_limit("checkout", max_requests=12, window_seconds=3600)
shipping_rate_limit = rate_limit("shipping", max_requests=80, window_seconds=3600)
feedback_rate_limit = rate_limit("feedback", max_requests=12, window_seconds=3600)
payment_rate_limit = rate_limit("payment-confirm", max_requests=40, window_seconds=3600)
tracking_rate_limit = rate_limit("tracking", max_requests=180, window_seconds=3600)
cep_rate_limit = rate_limit("cep", max_requests=180, window_seconds=3600)
