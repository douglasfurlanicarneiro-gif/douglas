import asyncio

import pytest
from bson import ObjectId
from fastapi import HTTPException

from payments import infinitepay
from routers import pagamentos


def test_valores_e_itens_sao_enviados_em_centavos():
    assert infinitepay.valor_em_centavos(25) == 2500
    assert infinitepay.valor_em_centavos(19.999) == 2000
    itens = infinitepay._itens_checkout(
        {
            "itens": [
                {
                    "perfumeNome": "Essencia Teste",
                    "ml": 30,
                    "quantidade": 2,
                    "precoUnitario": 10,
                }
            ],
            "frete": 5,
        },
        2500,
    )
    assert itens == [
        {"quantity": 2, "price": 1000, "description": "Essencia Teste - 30ml"},
        {"quantity": 1, "price": 500, "description": "Frete"},
    ]


def test_telefone_brasileiro_e_enviado_no_formato_internacional():
    assert infinitepay.normalizar_telefone("(11) 99999-8877") == "+5511999998877"
    assert infinitepay.normalizar_telefone("+55 11 99999-8877") == "+5511999998877"
    assert infinitepay.normalizar_telefone("123") == ""


def test_checkout_usa_host_seguro_e_remove_cifrao_da_tag(monkeypatch):
    recebido = {}
    monkeypatch.setattr(infinitepay, "INFINITEPAY_WEBHOOK_SECRET", "test-secret")

    async def fake_post(caminho, payload):
        recebido.update({"caminho": caminho, "payload": payload})
        return {"url": "https://checkout.infinitepay.com.br/abc"}

    monkeypatch.setattr(infinitepay, "_post_json", fake_post)
    resultado = asyncio.run(
        infinitepay.InfinitePayProvider().criar_cobranca(
            "64d000000000000000000001",
            25,
            {
                "infinitePayHandle": "$lessence",
                "itens": [
                    {
                        "perfumeNome": "Teste",
                        "ml": 30,
                        "quantidade": 1,
                        "precoUnitario": 20,
                    }
                ],
                "frete": 5,
                "cliente": {
                    "nome": "Cliente",
                    "email": "c@example.com",
                    "telefone": "11999999999",
                },
            },
        )
    )

    assert recebido["caminho"] == "links"
    assert recebido["payload"]["handle"] == "lessence"
    assert recebido["payload"]["order_nsu"] == "64d000000000000000000001"
    assert resultado["provedor"] == "infinitepay"
    assert resultado["status"] == "aguardando_pagamento"


class FakeCollection:
    def __init__(self, document):
        self.document = document
        self.updates = []

    async def find_one(self, query):
        if self.document is None:
            return None
        if "_id" in query and query["_id"] != self.document.get("_id"):
            return None
        return self.document

    async def update_one(self, query, update):
        if query.get("status") and query["status"] != self.document.get("status"):
            return
        self.updates.append((query, update))
        self.document.update(update.get("$set", {}))
        for key, value in update.get("$push", {}).items():
            self.document.setdefault(key, []).append(value)


class FakeDb:
    def __init__(self, pedido):
        self.pedidos = FakeCollection(pedido)
        self.configuracoes = FakeCollection(
            {"_id": "loja", "infinitePayHandle": "lessence"}
        )


class FakeEventCollection:
    def __init__(self):
        self.documents = {}

    async def update_one(self, query, update, upsert=False):
        event_id = query["_id"]
        document = self.documents.get(event_id)
        if document is None and upsert:
            document = {"_id": event_id, **update.get("$setOnInsert", {})}
            self.documents[event_id] = document
        if document is not None:
            document.update(update.get("$set", {}))


def test_webhook_e_persistido_de_forma_idempotente(monkeypatch):
    event_collection = FakeEventCollection()
    db = type("WebhookDb", (), {"eventos_pagamento": event_collection})()
    monkeypatch.setattr(pagamentos, "get_db", lambda: db)
    payload = pagamentos.InfinitePayWebhookIn(
        invoice_slug="invoice-1",
        amount=2500,
        paid_amount=2500,
        installments=1,
        capture_method="pix",
        transaction_nsu="transaction-1",
        order_nsu="64d000000000000000000001",
    )

    first_id = asyncio.run(pagamentos._registrar_webhook(payload))
    second_id = asyncio.run(pagamentos._registrar_webhook(payload))

    assert first_id == second_id
    assert len(event_collection.documents) == 1
    event = event_collection.documents[first_id]
    assert event["status"] == "pendente"
    assert event["payload"]["transaction_nsu"] == "transaction-1"


def test_backoff_de_reconciliacao_e_limitado():
    assert pagamentos._retry_delay(1) == 15
    assert pagamentos._retry_delay(2) == 30
    assert pagamentos._retry_delay(20) == 900


def test_confirmacao_valida_valor_e_e_idempotente(monkeypatch):
    oid = ObjectId()
    pedido = {
        "_id": oid,
        "status": "pendente",
        "total": 25.0,
        "historicoStatus": [{"status": "pendente", "data": "antes"}],
        "pagamento": {"provedor": "infinitepay", "status": "aguardando_pagamento"},
    }
    db = FakeDb(pedido)

    async def fake_verificar(**_kwargs):
        return {
            "success": True,
            "paid": True,
            "amount": 2500,
            "capture_method": "credit_card",
            "installments": 2,
        }

    monkeypatch.setattr(pagamentos, "get_db", lambda: db)
    monkeypatch.setattr(pagamentos, "verificar_pagamento", fake_verificar)
    argumentos = {
        "order_nsu": str(oid),
        "transaction_nsu": "transaction-1",
        "slug": "invoice-1",
    }
    asyncio.run(pagamentos._confirmar_pagamento(**argumentos))
    asyncio.run(pagamentos._confirmar_pagamento(**argumentos))

    assert pedido["status"] == "pagamento_confirmado"
    assert pedido["pagamento"]["status"] == "pago"
    assert pedido["pagamento"]["parcelas"] == 2
    assert (
        len(
            [
                h
                for h in pedido["historicoStatus"]
                if h["status"] == "pagamento_confirmado"
            ]
        )
        == 1
    )


def test_confirmacao_rejeita_valor_diferente(monkeypatch):
    oid = ObjectId()
    pedido = {
        "_id": oid,
        "status": "pendente",
        "total": 25.0,
        "pagamento": {"provedor": "infinitepay", "status": "aguardando_pagamento"},
    }
    db = FakeDb(pedido)

    async def fake_verificar(**_kwargs):
        return {"success": True, "paid": True, "amount": 1}

    monkeypatch.setattr(pagamentos, "get_db", lambda: db)
    monkeypatch.setattr(pagamentos, "verificar_pagamento", fake_verificar)
    with pytest.raises(HTTPException) as erro:
        asyncio.run(
            pagamentos._confirmar_pagamento(
                order_nsu=str(oid),
                transaction_nsu="transaction-2",
                slug="invoice-2",
            )
        )
    assert erro.value.status_code == 409
    assert not db.pedidos.updates


def test_confirmacao_publica_oculta_nsu_e_slug():
    resposta = pagamentos._pedido_publico({
        "_id": ObjectId(),
        "status": "pagamento_confirmado",
        "pagamento": {
            "provedor": "infinitepay",
            "status": "pago",
            "parcelas": 2,
            "transactionNsu": "interno",
            "invoiceSlug": "interno",
        },
    })

    assert resposta["pagamento"]["status"] == "pago"
    assert resposta["pagamento"]["parcelas"] == 2
    assert "transactionNsu" not in resposta["pagamento"]
    assert "invoiceSlug" not in resposta["pagamento"]
