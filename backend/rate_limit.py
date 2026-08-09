"""Limites distribuídos para rotas públicas suscetíveis a abuso."""

from datetime import datetime, timedelta, timezone
import logging

from fastapi import HTTPException, Request
from pymongo import ReturnDocument

from client_identity import anonymous_client_key
from database import get_db

logger = logging.getLogger("atelie.rate-limit")


def rate_limit(scope: str, *, max_requests: int, window_seconds: int):
    """Cria uma dependência FastAPI com contador compartilhado pelo MongoDB."""
    safe_scope = "".join(char for char in scope if char.isalnum() or char in "-_")

    async def dependency(request: Request) -> None:
        now = datetime.now(timezone.utc)
        bucket = int(now.timestamp()) // window_seconds
        client_key = anonymous_client_key(request, safe_scope)
        key = f"{safe_scope}:{client_key}:{bucket}"
        try:
            result = await get_db().api_rate_limits.find_one_and_update(
                {"_id": key},
                {
                    "$inc": {"count": 1},
                    "$setOnInsert": {
                        "scope": safe_scope,
                        "expiresAt": now + timedelta(seconds=window_seconds * 2),
                    },
                },
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
        except Exception:
            logger.exception("Não foi possível aplicar o limite de %s.", safe_scope)
            return

        if int((result or {}).get("count", 0)) > max_requests:
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
