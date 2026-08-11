import asyncio

import pytest
from fastapi import HTTPException

from routers.compras import (
    CompraIn,
    _assegurar_pagamento_checkout,
    _checkout_payload_hash,
    _validar_reuso_idempotente,
    criar_compra,
)
from routers import compras
from utils import serialize
from payments.base import PaymentProviderError


def _payload(*, quantidade: int = 1) -> CompraIn:
    return CompraIn(
        itens=[{
            "perfumeId": "64d000000000000000000001",
            "ml": 50,
            "quantidade": quantidade,
        }],
        cliente="Cliente Teste",
        contato="11999999999",
        nomeCompleto="Cliente Teste",
        whatsapp="11999999999",
        email="cliente@example.com",
        formaPagamento="cartao",
        tipoEntrega="retirada",
        aceitePoliticaPrivacidade=True,
    )


def test_hash_e_estavel_para_o_mesmo_checkout():
    primeiro = _checkout_payload_hash(_payload())
    segundo = _checkout_payload_hash(_payload())

    assert primeiro == segundo
    assert len(primeiro) == 64


def test_hash_muda_quando_o_carrinho_muda():
    assert _checkout_payload_hash(_payload(quantidade=1)) != _checkout_payload_hash(
        _payload(quantidade=2)
    )


def test_reuso_da_chave_rejeita_payload_diferente():
    pedido = {"checkoutPayloadHash": _checkout_payload_hash(_payload())}

    with pytest.raises(HTTPException) as erro:
        _validar_reuso_idempotente(
            pedido,
            _checkout_payload_hash(_payload(quantidade=2)),
        )

    assert erro.value.status_code == 409


def test_metadados_de_idempotencia_nao_sao_expostos():
    resposta = serialize({
        "_id": "pedido-1",
        "status": "pendente",
        "checkoutIdempotencyKey": "checkout-segredo-interno",
        "checkoutPayloadHash": "hash-interno",
        "checkoutEstado": "concluido",
    })

    assert resposta == {"id": "pedido-1", "status": "pendente"}


def test_duas_requisicoes_concorrentes_criam_um_unico_pedido(monkeypatch):
    class FakePedidos:
        def __init__(self):
            self.document = None

        async def find_one(self, query):
            if not self.document:
                return None
            if self.document.get("checkoutIdempotencyKey") != query.get(
                "checkoutIdempotencyKey"
            ):
                return None
            return dict(self.document)

    class FakeDb:
        def __init__(self):
            self.pedidos = FakePedidos()

    db = FakeDb()
    criados = 0

    async def fake_criar(payload, *, idempotency_key=None, payload_hash=None):
        nonlocal criados
        criados += 1
        await asyncio.sleep(0.02)
        db.pedidos.document = {
            "_id": "pedido-unico",
            "status": "pendente",
            "checkoutIdempotencyKey": idempotency_key,
            "checkoutPayloadHash": payload_hash,
            "checkoutEstado": "concluido",
        }
        return serialize(db.pedidos.document)

    monkeypatch.setattr(compras, "get_db", lambda: db)
    monkeypatch.setattr(compras, "_criar_compra", fake_criar)

    async def scenario():
        return await asyncio.gather(
            criar_compra(_payload(), "checkout-teste-concorrente-001"),
            criar_compra(_payload(), "checkout-teste-concorrente-001"),
        )

    respostas = asyncio.run(scenario())

    assert criados == 1
    assert respostas == [
        {"id": "pedido-unico", "status": "pendente"},
        {"id": "pedido-unico", "status": "pendente"},
    ]


class _CheckoutCollection:
    def __init__(self, document):
        self.document = document

    async def find_one(self, _query):
        return dict(self.document) if self.document else None

    async def update_one(self, _query, update):
        self.document.update(update.get("$set", {}))
        for key, value in update.get("$inc", {}).items():
            self.document[key] = int(self.document.get(key, 0)) + int(value)
        for key in update.get("$unset", {}):
            self.document.pop(key, None)


class _CheckoutDb:
    def __init__(self, pedido):
        self.pedidos = _CheckoutCollection(pedido)
        self.configuracoes = _CheckoutCollection(
            {"_id": "loja", "infinitePayHandle": "lessence"}
        )


def _pedido_checkout_incompleto():
    return {
        "_id": "pedido-1",
        "status": "pendente",
        "formaPagamento": "cartao",
        "total": 25.0,
        "totalCentavos": 2500,
        "frete": 5.0,
        "itens": [
            {
                "perfumeNome": "Perfume Teste",
                "ml": 30,
                "quantidade": 1,
                "precoUnitario": 20.0,
            }
        ],
        "cliente": "Cliente Teste",
        "contato": "11999999999",
    }


def test_checkout_interrompido_pode_retomar_sem_recriar_pedido(monkeypatch):
    pedido = _pedido_checkout_incompleto()
    db = _CheckoutDb(pedido)
    chamadas = []

    async def fake_iniciar(metodo, referencia, valor, configuracao):
        chamadas.append((metodo, referencia, valor, configuracao))
        return {
            "metodo": metodo,
            "provedor": "infinitepay",
            "status": "aguardando_pagamento",
            "checkoutUrl": "https://checkout.infinitepay.com.br/teste",
        }

    monkeypatch.setattr(compras, "iniciar_pagamento", fake_iniciar)
    resultado = asyncio.run(_assegurar_pagamento_checkout(db, pedido))

    assert len(chamadas) == 1
    assert chamadas[0][2] == 25.0
    assert resultado["checkoutEstado"] == "concluido"
    assert resultado["checkoutTentativas"] == 1
    assert resultado["pagamento"]["valorCentavos"] == 2500


def test_falha_do_gateway_preserva_pedido_para_nova_tentativa(monkeypatch):
    pedido = _pedido_checkout_incompleto()
    db = _CheckoutDb(pedido)

    async def fake_iniciar(*_args, **_kwargs):
        raise PaymentProviderError("Gateway indisponível")

    monkeypatch.setattr(compras, "iniciar_pagamento", fake_iniciar)
    with pytest.raises(HTTPException) as erro:
        asyncio.run(_assegurar_pagamento_checkout(db, pedido))

    assert erro.value.status_code == 502
    assert db.pedidos.document["_id"] == "pedido-1"
    assert db.pedidos.document["checkoutEstado"] == "pagamento_falhou"
    assert db.pedidos.document["checkoutTentativas"] == 1


def test_pedido_cancelado_nao_pode_reabrir_checkout():
    pedido = {**_pedido_checkout_incompleto(), "status": "cancelado"}
    db = _CheckoutDb(pedido)

    with pytest.raises(HTTPException) as erro:
        asyncio.run(_assegurar_pagamento_checkout(db, pedido))

    assert erro.value.status_code == 409
    assert "aguardando pagamento" in str(erro.value.detail)
