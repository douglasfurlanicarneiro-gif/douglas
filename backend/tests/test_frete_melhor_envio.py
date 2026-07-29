import asyncio

from shipping import melhor_envio


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code
        self.ok = 200 <= status_code < 300

    def json(self):
        return self._payload


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

    assert result == [
        {
            "serviceId": 3,
            "transportadora": "Jadlog",
            "servico": ".Package",
            "precoTransportadora": 18.5,
            "taxaEmbalagem": 5.0,
            "preco": 23.5,
            "prazoDias": 4,
        }
    ]


def test_dimensoes_aumentam_conforme_tamanho():
    pequena = melhor_envio._dimensoes_produto(30)
    media = melhor_envio._dimensoes_produto(50)
    grande = melhor_envio._dimensoes_produto(100)

    assert pequena[3] < media[3] < grande[3]
    assert pequena[1] < media[1] < grande[1]
