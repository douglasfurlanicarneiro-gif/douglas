import asyncio

from shipping import melhor_envio


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300

    def json(self):
        return self._payload


class IntegracoesFalsas:
    def __init__(self, documento=None):
        self.documento = documento
        self.atualizacao = None

    async def find_one(self, _filtro):
        return self.documento

    async def update_one(self, _filtro, atualizacao, upsert=False):
        self.atualizacao = atualizacao


class BancoIntegracaoFalso:
    def __init__(self, documento=None):
        self.integracoes = IntegracoesFalsas(documento)


def test_token_persistido_so_conecta_no_mesmo_ambiente(monkeypatch):
    monkeypatch.setattr(melhor_envio, "MELHOR_ENVIO_BASE_URL", "https://melhorenvio.com.br")
    monkeypatch.setattr(melhor_envio, "MELHOR_ENVIO_ACCESS_TOKEN", "")

    legado = asyncio.run(melhor_envio.status_integracao(
        BancoIntegracaoFalso({"accessToken": "token-antigo"})
    ))
    producao = asyncio.run(melhor_envio.status_integracao(
        BancoIntegracaoFalso({"accessToken": "token-novo", "ambiente": "producao"})
    ))

    assert legado["integrado"] is False
    assert producao["integrado"] is True
    assert producao["ambiente"] == "producao"


def test_salvar_token_registra_ambiente_atual(monkeypatch):
    monkeypatch.setattr(melhor_envio, "MELHOR_ENVIO_BASE_URL", "https://melhorenvio.com.br")
    monkeypatch.setattr(melhor_envio, "encrypt_secret", lambda value, **_kwargs: f"enc:{value}")
    banco = BancoIntegracaoFalso()

    asyncio.run(melhor_envio._salvar_tokens(banco, {
        "access_token": "access",
        "refresh_token": "refresh",
        "expires_in": 3600,
    }))

    assert banco.integracoes.atualizacao["$set"]["ambiente"] == "producao"


def test_cotacao_exibe_preco_final_prazo_e_filtra_transportadora(monkeypatch):
    async def fake_config(_db):
        return {"cepOrigem": "03069000", "taxaEmbalagem": 5.0}

    async def fake_token(_db):
        return "token-seguro"

    async def fake_request(*_args, **_kwargs):
        return FakeResponse(
            [
                {
                    "id": 3,
                    "name": ".Package",
                    "price": "19.90",
                    "custom_price": "18.50",
                    "delivery_time": 5,
                    "custom_delivery_time": 4,
                    "company": {"name": "Jadlog"},
                },
                {
                    "id": 1,
                    "name": "PAC",
                    "price": "12.00",
                    "delivery_time": 7,
                    "company": {"name": "Correios"},
                },
            ]
        )

    monkeypatch.setattr(melhor_envio, "configuracao_frete", fake_config)
    monkeypatch.setattr(melhor_envio, "obter_access_token", fake_token)
    monkeypatch.setattr(melhor_envio, "_run_request", fake_request)

    result = asyncio.run(
        melhor_envio.cotar_frete(
            object(),
            cep_destino="01310-100",
            itens=[
                {
                    "perfumeId": "produto-1",
                    "ml": 50,
                    "quantidade": 1,
                    "precoUnitario": 80,
                }
            ],
        )
    )

    assert len(result) == 2
    por_categoria = {item["categoriaFrete"]: item for item in result}
    assert set(por_categoria) == {"padrao", "prioritaria"}
    assert por_categoria["padrao"] == {
        "serviceId": 3,
        "transportadora": "Jadlog",
        "servico": ".Package",
        "precoTransportadora": 18.5,
        "prazoTransportadora": 4,
        "categoriaFrete": "padrao",
        "nomeExibicao": "Entrega Padrão",
        "taxaEmbalagem": 5.0,
        "tipoAjuste": "valor",
        "valorAjuste": 0.0,
        "preco": 23.5,
        "freteGratis": False,
        "prazoDias": 4,
    }
    assert por_categoria["prioritaria"]["serviceId"] == 3
    assert por_categoria["prioritaria"]["nomeExibicao"] == "Entrega Prioritária"
    assert por_categoria["prioritaria"]["preco"] == 26.5


def test_cotacao_aplica_regras_independentes_por_modelo(monkeypatch):
    async def fake_config(_db):
        return {
            "cepOrigem": "03069000",
            "taxaEmbalagem": 5.0,
            "freteGratisAcima": 0,
            "ajustePadraoTipo": "valor",
            "ajustePadraoValor": 4.0,
            "prazoPadraoDias": 8,
            "ajustePrioritarioTipo": "percentual",
            "ajustePrioritarioValor": 10.0,
            "prazoPrioritarioDias": 3,
        }

    async def fake_token(_db):
        return "token-seguro"

    async def fake_request(*_args, **_kwargs):
        return FakeResponse([
            {"id": 1, "name": "Econômico", "price": "20.00", "delivery_time": 7, "company": {"name": "Jadlog"}},
            {"id": 2, "name": "Expresso", "price": "30.00", "delivery_time": 2, "company": {"name": "Jadlog"}},
        ])

    monkeypatch.setattr(melhor_envio, "configuracao_frete", fake_config)
    monkeypatch.setattr(melhor_envio, "obter_access_token", fake_token)
    monkeypatch.setattr(melhor_envio, "_run_request", fake_request)

    result = asyncio.run(melhor_envio.cotar_frete(
        object(),
        cep_destino="01310-100",
        itens=[{"perfumeId": "produto-1", "ml": 50, "quantidade": 1, "precoUnitario": 80}],
    ))
    por_categoria = {item["categoriaFrete"]: item for item in result}
    assert por_categoria["padrao"]["preco"] == 29.0
    assert por_categoria["padrao"]["prazoDias"] == 8
    assert por_categoria["prioritaria"]["preco"] == 38.0
    assert por_categoria["prioritaria"]["prazoDias"] == 3


def test_dimensoes_aumentam_conforme_tamanho():
    pequena = melhor_envio._dimensoes_produto(30)
    media = melhor_envio._dimensoes_produto(50)
    grande = melhor_envio._dimensoes_produto(100)

    assert pequena[3] < media[3] < grande[3]
    assert pequena[1] < media[1] < grande[1]


def test_cotacao_exibe_no_maximo_prioritaria_e_padrao(monkeypatch):
    async def fake_config(_db):
        return {
            "cepOrigem": "03069000",
            "taxaEmbalagem": 0,
            "freteGratisAcima": 0,
            "ajustePadraoTipo": "valor",
            "ajustePadraoValor": 0,
            "prazoPadraoDias": 0,
            "ajustePrioritarioTipo": "valor",
            "ajustePrioritarioValor": 0,
            "prazoPrioritarioDias": 0,
            "diferencaMinimaPrioritario": 0,
        }

    async def fake_token(_db):
        return "token-seguro"

    async def fake_request(*_args, **_kwargs):
        return FakeResponse([
            {"id": 1, "name": "Lento", "price": "19.00", "delivery_time": 8, "company": {"name": "Jadlog"}},
            {"id": 2, "name": "Rápido", "price": "30.00", "delivery_time": 2, "company": {"name": "Jadlog"}},
            {"id": 3, "name": "Intermediário", "price": "24.00", "delivery_time": 5, "company": {"name": "Jadlog"}},
        ])

    monkeypatch.setattr(melhor_envio, "configuracao_frete", fake_config)
    monkeypatch.setattr(melhor_envio, "obter_access_token", fake_token)
    monkeypatch.setattr(melhor_envio, "_run_request", fake_request)

    result = asyncio.run(melhor_envio.cotar_frete(
        object(),
        cep_destino="01310-100",
        itens=[{"perfumeId": "produto-1", "ml": 50, "quantidade": 1, "precoUnitario": 80}],
    ))

    assert len(result) == 2
    assert {item["categoriaFrete"] for item in result} == {"padrao", "prioritaria"}
    assert {item["serviceId"] for item in result} == {1, 2}


def test_prioritaria_mantem_diferenca_minima_sobre_padrao(monkeypatch):
    async def fake_config(_db):
        return {
            "cepOrigem": "03069000",
            "taxaEmbalagem": 6.0,
            "ajustePadraoTipo": "valor",
            "ajustePadraoValor": 2.5,
            "ajustePrioritarioTipo": "percentual",
            "ajustePrioritarioValor": 6.55,
            "diferencaMinimaPrioritario": 3.0,
        }

    async def fake_token(_db):
        return "token-seguro"

    async def fake_request(*_args, **_kwargs):
        return FakeResponse([
            {"id": 1, "name": ".Package", "price": "18.07", "delivery_time": 6, "company": {"name": "Jadlog"}},
            {"id": 2, "name": ".Com", "price": "16.48", "delivery_time": 5, "company": {"name": "Jadlog"}},
        ])

    monkeypatch.setattr(melhor_envio, "configuracao_frete", fake_config)
    monkeypatch.setattr(melhor_envio, "obter_access_token", fake_token)
    monkeypatch.setattr(melhor_envio, "_run_request", fake_request)

    result = asyncio.run(melhor_envio.cotar_frete(
        object(),
        cep_destino="08070-320",
        itens=[{"perfumeId": "produto-1", "ml": 50, "quantidade": 1, "precoUnitario": 80}],
    ))
    por_categoria = {item["categoriaFrete"]: item for item in result}
    assert por_categoria["padrao"]["preco"] == 26.57
    assert por_categoria["prioritaria"]["preco"] == 29.57
