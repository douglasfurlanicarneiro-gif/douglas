import asyncio

import pytest
from fastapi import HTTPException

from routers.compras import (
    CompraIn,
    _checkout_payload_hash,
    _validar_reuso_idempotente,
    criar_compra,
)
from routers import compras
from utils import serialize


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
