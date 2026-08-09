import asyncio

import pytest
from fastapi import HTTPException

import rate_limit


class FakeRateLimitCollection:
    def __init__(self):
        self.documents = {}

    async def find_one_and_update(self, query, update, **_kwargs):
        document = self.documents.setdefault(query["_id"], {"_id": query["_id"]})
        for key, value in update.get("$setOnInsert", {}).items():
            document.setdefault(key, value)
        for key, value in update.get("$inc", {}).items():
            document[key] = document.get(key, 0) + value
        return dict(document)


class FakeDb:
    def __init__(self):
        self.api_rate_limits = FakeRateLimitCollection()


class FakeRequest:
    headers = {"x-forwarded-for": "203.0.113.8"}
    client = None


def test_rate_limit_bloqueia_somente_depois_do_limite(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(rate_limit, "get_db", lambda: db)
    dependency = rate_limit.rate_limit("teste", max_requests=2, window_seconds=3600)

    asyncio.run(dependency(FakeRequest()))
    asyncio.run(dependency(FakeRequest()))

    stored_key = next(iter(db.api_rate_limits.documents))
    assert "203.0.113.8" not in stored_key

    with pytest.raises(HTTPException) as error:
        asyncio.run(dependency(FakeRequest()))

    assert error.value.status_code == 429
    assert int(error.value.headers["Retry-After"]) > 0


def test_rate_limit_continua_protegendo_quando_banco_falha(monkeypatch):
    class BrokenCollection:
        async def find_one_and_update(self, *_args, **_kwargs):
            raise RuntimeError("banco temporariamente indisponível")

    class BrokenDb:
        api_rate_limits = BrokenCollection()

    rate_limit._fallback_counters.clear()
    monkeypatch.setattr(rate_limit, "get_db", lambda: BrokenDb())
    dependency = rate_limit.rate_limit("fallback-teste", max_requests=1, window_seconds=3600)

    asyncio.run(dependency(FakeRequest()))
    with pytest.raises(HTTPException) as error:
        asyncio.run(dependency(FakeRequest()))

    assert error.value.status_code == 429
