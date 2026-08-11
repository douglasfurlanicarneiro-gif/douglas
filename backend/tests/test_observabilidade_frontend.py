import asyncio

from starlette.requests import Request

from routers import observabilidade


class ColecaoFalsa:
    def __init__(self):
        self.chamadas = []

    async def update_one(self, filtro, atualizacao, upsert=False):
        self.chamadas.append((filtro, atualizacao, upsert))


class BancoFalso:
    def __init__(self):
        self.frontend_errors = ColecaoFalsa()


def _request(request_id="request-observabilidade-123"):
    request = Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": "https",
            "path": "/api/observabilidade/frontend",
            "raw_path": b"/api/observabilidade/frontend",
            "query_string": b"",
            "headers": [],
            "client": ("198.51.100.10", 12345),
            "server": ("api.example", 443),
        }
    )
    request.state.request_id = request_id
    return request


def test_erro_frontend_e_sanitizado_deduplicado_e_tem_retencao(monkeypatch):
    banco = BancoFalso()
    monkeypatch.setattr(observabilidade, "get_db", lambda: banco)
    payload = observabilidade.FrontendErrorIn(
        tipo="react_boundary",
        mensagem="Falha para cliente@example.com no telefone +55 11 99999-8877",
        componentStack="Componente Checkout cliente@example.com",
        plataforma="web",
        caminho="/checkout?token=segredo",
        versao="1.0.0",
    )

    primeira = asyncio.run(
        observabilidade.registrar_erro_frontend(payload, _request())
    )
    segunda = asyncio.run(
        observabilidade.registrar_erro_frontend(payload, _request())
    )

    assert primeira["requestId"] == "request-observabilidade-123"
    assert segunda["recebido"] is True
    assert len(banco.frontend_errors.chamadas) == 2
    primeiro_filtro, update, upsert = banco.frontend_errors.chamadas[0]
    segundo_filtro = banco.frontend_errors.chamadas[1][0]
    assert primeiro_filtro == segundo_filtro
    assert len(primeiro_filtro["_id"]) == 32
    assert upsert is True
    assert "cliente@example.com" not in update["$setOnInsert"]["mensagem"]
    assert "99999-8877" not in update["$setOnInsert"]["mensagem"]
    assert update["$set"]["caminho"] == "/checkout"
    assert update["$inc"]["ocorrencias"] == 1
    assert update["$setOnInsert"]["expireAt"] > update["$setOnInsert"]["primeiraOcorrenciaEm"]

