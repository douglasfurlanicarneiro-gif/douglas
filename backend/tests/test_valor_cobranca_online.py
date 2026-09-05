import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import pedidos


@pytest.mark.parametrize("status", ["aguardando_pagamento", "pago", "erro", "estornado"])
@pytest.mark.parametrize("total", [40, 60])
def test_rejeita_mudanca_sem_tocar_no_banco_ou_estoque(status, total):
    db = SimpleNamespace(pedidos=SimpleNamespace(update_one=AsyncMock()))
    with pytest.raises(HTTPException) as error:
        asyncio.run(pedidos._persistir_pedido_e_estoque(
            db, pedido_id="507f1f77bcf86cd799439011",
            existente={"status": "pendente", "total": 50, "pagamento": {"provedor": "infinitepay", "status": status}},
            atualizacao={"total": total}, itens=[], novo_status="pendente",
        ))
    assert error.value.status_code == 409
    assert error.value.detail["code"] == "VALOR_COBRANCA_ONLINE_BLOQUEADO"
    db.pedidos.update_one.assert_not_awaited()


@pytest.mark.parametrize("provider,total", [("infinitepay", 50), ("painel", 40)])
def test_preserva_edicao_nao_financeira_e_valor_manual(monkeypatch, provider, total):
    db = SimpleNamespace(pedidos=SimpleNamespace(update_one=AsyncMock(return_value=SimpleNamespace(matched_count=1))))
    monkeypatch.setattr(pedidos, "registrar_auditoria", AsyncMock())
    monkeypatch.setattr(pedidos, "_sincronizar_movimentos_do_pedido", AsyncMock())
    asyncio.run(pedidos._persistir_pedido_e_estoque(
        db, pedido_id="507f1f77bcf86cd799439011",
        existente={"status": "pendente", "total": 50, "pagamento": {"provedor": provider}},
        atualizacao={"total": total, "observacoes": "Conferir endereço"}, itens=[], novo_status="pendente",
    ))
    assert db.pedidos.update_one.await_args.args[1]["$set"]["observacoes"] == "Conferir endereço"
