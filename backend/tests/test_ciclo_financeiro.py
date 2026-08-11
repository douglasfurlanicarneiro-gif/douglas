import asyncio
from contextlib import asynccontextmanager

import pytest
from bson import ObjectId
from fastapi import HTTPException

from payment_status import validar_operacao_pagamento
from routers import pagamentos, pedidos


class Resultado:
    matched_count = 1


class PedidosFalsos:
    def __init__(self, pedido):
        self.pedido = pedido

    async def find_one(self, query):
        return self.pedido if query.get("_id") == self.pedido["_id"] else None

    async def update_one(self, query, update):
        if query.get("pagamento.status") != self.pedido["pagamento"]["status"]:
            resultado = Resultado()
            resultado.matched_count = 0
            return resultado
        self.pedido.update(update.get("$set", {}))
        for campo in update.get("$unset", {}):
            self.pedido.pop(campo, None)
        return Resultado()


class AuditoriaFalsa:
    def __init__(self):
        self.documentos = []

    async def insert_one(self, documento):
        self.documentos.append(documento)


class BancoFalso:
    def __init__(self, pedido):
        self.pedidos = PedidosFalsos(pedido)
        self.operacoes_sistema = AuditoriaFalsa()


@asynccontextmanager
async def trava_falsa(_db):
    yield


def test_transicoes_financeiras_exigem_ordem_correta():
    assert validar_operacao_pagamento("pago", "solicitar_estorno") == "estorno_solicitado"
    assert validar_operacao_pagamento("estorno_solicitado", "confirmar_estorno") == "estornado"
    assert validar_operacao_pagamento("pago", "registrar_contestacao") == "contestado"
    assert validar_operacao_pagamento("contestado", "resolver_chargeback") == "chargeback_confirmado"

    with pytest.raises(HTTPException) as erro:
        validar_operacao_pagamento("pago", "confirmar_estorno")
    assert erro.value.detail["code"] == "OPERACAO_FINANCEIRA_INVALIDA"


def test_estorno_fica_auditavel_e_idempotente(monkeypatch):
    pedido = {
        "_id": ObjectId(),
        "seq": 18,
        "status": "pagamento_confirmado",
        "pagamento": {"provedor": "infinitepay", "status": "pago", "historico": []},
    }
    db = BancoFalso(pedido)
    monkeypatch.setattr(pagamentos, "get_db", lambda: db)
    monkeypatch.setattr(pagamentos, "stock_lock", trava_falsa)

    solicitar = pagamentos.OperacaoFinanceiraIn(
        operacao="solicitar_estorno",
        motivo="Cliente solicitou cancelamento",
    )
    asyncio.run(
        pagamentos.registrar_operacao_financeira(str(pedido["_id"]), solicitar, "douglas")
    )
    assert pedido["pagamento"]["status"] == "estorno_solicitado"
    assert pedido["pagamentoRequerRevisao"] is True
    assert len(pedido["pagamento"]["historico"]) == 1

    confirmar = pagamentos.OperacaoFinanceiraIn(
        operacao="confirmar_estorno",
        motivo="Cancelamento concluído no provedor",
        referencia="PROTOCOLO-123",
    )
    asyncio.run(
        pagamentos.registrar_operacao_financeira(str(pedido["_id"]), confirmar, "douglas")
    )
    assert pedido["pagamento"]["status"] == "estornado"
    assert pedido["pagamentoRequerRevisao"] is False
    assert len(pedido["pagamento"]["historico"]) == 2
    assert len(db.operacoes_sistema.documentos) == 2

    # Repetir a mesma confirmação não cria outro evento.
    asyncio.run(
        pagamentos.registrar_operacao_financeira(str(pedido["_id"]), confirmar, "douglas")
    )
    assert len(pedido["pagamento"]["historico"]) == 2
    assert len(db.operacoes_sistema.documentos) == 2


def test_confirmacao_final_exige_referencia(monkeypatch):
    pedido = {
        "_id": ObjectId(),
        "seq": 19,
        "pagamento": {"status": "estorno_solicitado"},
    }
    monkeypatch.setattr(pagamentos, "get_db", lambda: BancoFalso(pedido))
    payload = pagamentos.OperacaoFinanceiraIn(
        operacao="confirmar_estorno",
        motivo="Estorno concluído no provedor",
    )
    with pytest.raises(HTTPException) as erro:
        asyncio.run(
            pagamentos.registrar_operacao_financeira(str(pedido["_id"]), payload, "admin")
        )
    assert erro.value.status_code == 422
    assert erro.value.detail["code"] == "REFERENCIA_FINANCEIRA_OBRIGATORIA"


def test_pedido_pago_nao_pode_ser_cancelado_antes_do_estorno():
    pedido = {
        "_id": ObjectId(),
        "status": "pagamento_confirmado",
        "pagamento": {"status": "pago", "provedor": "infinitepay"},
        "itens": [],
    }
    with pytest.raises(HTTPException) as erro:
        asyncio.run(
            pedidos._persistir_pedido_e_estoque(
                object(),
                pedido_id=str(pedido["_id"]),
                existente=pedido,
                atualizacao={"status": "cancelado"},
                itens=[],
                novo_status="cancelado",
            )
        )
    assert erro.value.detail["code"] == "PAGAMENTO_EXIGE_ESTORNO"


def test_infinitepay_nao_pode_ser_confirmada_manualmente():
    pedido = {
        "_id": ObjectId(),
        "status": "pendente",
        "pagamento": {"status": "aguardando_pagamento", "provedor": "infinitepay"},
        "itens": [],
        "total": 50,
    }
    with pytest.raises(HTTPException) as erro:
        asyncio.run(
            pedidos._persistir_pedido_e_estoque(
                object(),
                pedido_id=str(pedido["_id"]),
                existente=pedido,
                atualizacao={"status": "pagamento_confirmado", "total": 50},
                itens=[],
                novo_status="pagamento_confirmado",
            )
        )
    assert erro.value.detail["code"] == "CONFIRMACAO_GATEWAY_NECESSARIA"

