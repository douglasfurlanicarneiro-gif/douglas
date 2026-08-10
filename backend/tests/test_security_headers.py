import asyncio

from starlette.requests import Request
from starlette.responses import JSONResponse

from server import security_headers


def _request(path: str) -> Request:
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": [],
            "client": ("198.51.100.10", 12345),
            "server": ("api.example", 443),
        }
    )


def test_resposta_administrativa_nao_pode_ser_cacheada_ou_incorporada():
    async def proxima(_request):
        return JSONResponse({"ok": True})

    resposta = asyncio.run(
        security_headers(_request("/api/admin/configuracoes"), proxima)
    )

    assert resposta.headers["cache-control"] == "no-store"
    assert resposta.headers["pragma"] == "no-cache"
    assert resposta.headers["x-frame-options"] == "DENY"
    assert "default-src 'none'" in resposta.headers["content-security-policy"]


def test_resposta_401_nunca_e_cacheada():
    async def proxima(_request):
        return JSONResponse({"detail": "nao autorizado"}, status_code=401)

    resposta = asyncio.run(security_headers(_request("/api/perfumes"), proxima))

    assert resposta.headers["cache-control"] == "no-store"
    assert resposta.headers["pragma"] == "no-cache"
