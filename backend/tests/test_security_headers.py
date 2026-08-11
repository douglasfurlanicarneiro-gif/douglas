import asyncio

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from server import app, security_headers


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


def test_request_id_valido_do_cliente_e_preservado():
    request_id = "cliente-request-12345678"
    request = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "GET",
            "scheme": "https",
            "path": "/api/vitrine",
            "raw_path": b"/api/vitrine",
            "query_string": b"",
            "headers": [(b"x-request-id", request_id.encode())],
            "client": ("198.51.100.10", 12345),
            "server": ("api.example", 443),
        }
    )

    async def proxima(recebida):
        assert recebida.state.request_id == request_id
        return JSONResponse({"ok": True})

    resposta = asyncio.run(security_headers(request, proxima))
    assert resposta.headers["x-request-id"] == request_id


def test_cors_permite_headers_de_correlacao_e_reautenticacao():
    middleware = next(item for item in app.user_middleware if item.cls is CORSMiddleware)
    permitidos = {item.casefold() for item in middleware.kwargs["allow_headers"]}
    assert "x-request-id" in permitidos
    assert "x-atelie-step-up" in permitidos
