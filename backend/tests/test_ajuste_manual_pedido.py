import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from routers import pedidos


STATUSES = ['pendente', 'pagamento_confirmado', 'preparando', 'pronto', 'enviado', 'entregue', 'cancelado']


@asynccontextmanager
async def lock(_):
    yield


def setup(monkeypatch, status):
    document = {'status': status, 'itens': [], 'pagamento': {'provedor': 'infinitepay', 'status': 'aguardando_pagamento', 'checkoutUrl': 'https://example.test/pay'}}
    transaction = MagicMock()
    transaction.__aenter__ = AsyncMock()
    transaction.__aexit__ = AsyncMock(return_value=False)
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=session)
    session.__aexit__ = AsyncMock(return_value=False)
    session.start_transaction = AsyncMock(return_value=transaction)
    db = SimpleNamespace(client=SimpleNamespace(start_session=lambda: session), pedidos=SimpleNamespace(find_one=AsyncMock(return_value=document), update_one=AsyncMock()))
    monkeypatch.setattr(pedidos, 'get_db', lambda: db)
    monkeypatch.setattr(pedidos, 'stock_lock', lock)
    sync = AsyncMock()
    monkeypatch.setattr(pedidos, '_sincronizar_movimentos_do_pedido', sync)
    return db, session, transaction, sync


@pytest.mark.parametrize('previous', STATUSES)
@pytest.mark.parametrize('new', STATUSES)
def test_todas_etapas_com_historico_transacional(monkeypatch, previous, new):
    db, session, _, sync = setup(monkeypatch, previous)
    asyncio.run(pedidos.ajustar_status_manual('507f1f77bcf86cd799439011', pedidos.AjusteStatusIn(status=new, statusAnterior=previous, motivo='Conferido pelo administrador'), 'admin'))
    change = db.pedidos.update_one.await_args.args[1]
    assert change['$set']['status'] == new
    assert 'pagamento' not in change['$set']
    assert change['$push']['historicoAjustesManuais']['ator'] == 'admin'
    assert set(change['$push']['historicoStatus']) == {'status', 'data'}
    assert sync.await_args.kwargs['session'] is session
    assert db.pedidos.update_one.await_args.kwargs['session'] is session


@pytest.mark.parametrize('payment', ['pago', 'aguardando_pagamento'])
def test_pagamento_manual_preserva_checkout(monkeypatch, payment):
    db, _, _, _ = setup(monkeypatch, 'pendente')
    asyncio.run(pedidos.ajustar_status_manual('507f1f77bcf86cd799439011', pedidos.AjusteStatusIn(status='entregue', statusAnterior='pendente', motivo='Conferência do recibo', pagamento=payment), 'admin'))
    result = db.pedidos.update_one.await_args.args[1]['$set']['pagamento']
    assert result['status'] == payment
    assert result['provedor'] == 'infinitepay'
    assert result['checkoutUrl'] == 'https://example.test/pay'
    assert result['historico'][-1]['status'] == payment


def test_conflito_nao_movimenta(monkeypatch):
    db, _, _, sync = setup(monkeypatch, 'entregue')
    with pytest.raises(HTTPException):
        asyncio.run(pedidos.ajustar_status_manual('507f1f77bcf86cd799439011', pedidos.AjusteStatusIn(status='pronto', statusAnterior='pendente', motivo='Conferência'), 'admin'))
    sync.assert_not_awaited()
    db.pedidos.update_one.assert_not_awaited()


def test_falha_estoque_aborta_transacao(monkeypatch):
    db, _, transaction, sync = setup(monkeypatch, 'pendente')
    sync.side_effect = RuntimeError('database unavailable')
    with pytest.raises(RuntimeError):
        asyncio.run(pedidos.ajustar_status_manual('507f1f77bcf86cd799439011', pedidos.AjusteStatusIn(status='entregue', statusAnterior='pendente', motivo='Conferência'), 'admin'))
    db.pedidos.update_one.assert_not_awaited()
    assert transaction.__aexit__.await_args.args[0] is RuntimeError


def test_motivo_em_branco_rejeitado(monkeypatch):
    db, _, _, _ = setup(monkeypatch, 'pendente')
    with pytest.raises(HTTPException):
        asyncio.run(pedidos.ajustar_status_manual('507f1f77bcf86cd799439011', pedidos.AjusteStatusIn(status='entregue', statusAnterior='pendente', motivo='     '), 'admin'))
    db.pedidos.find_one.assert_not_awaited()


def test_endpoint_exige_reautenticacao():
    route = next(r for r in pedidos.router.routes if r.path.endswith('/ajuste-manual'))
    assert any(d.call is pedidos.require_step_up_auth for d in route.dependant.dependencies)


def test_edicao_de_dados_sem_mudar_itens_nao_exige_saldo(monkeypatch):
    db, _, _, _ = setup(monkeypatch, 'preparando')
    itens = [{'perfumeId': 'perfume-a', 'ml': 30, 'quantidade': 1}]
    db.pedidos.find_one.return_value['itens'] = itens
    monkeypatch.setattr(pedidos, '_itens_com_atendimento', AsyncMock(return_value=itens))
    validar = AsyncMock(side_effect=AssertionError('não deve validar saldo'))
    monkeypatch.setattr(pedidos, '_validar_status_estoque', validar)
    monkeypatch.setattr(pedidos, '_persistir_pedido_e_estoque', AsyncMock())
    asyncio.run(pedidos.atualizar_pedido('507f1f77bcf86cd799439011', pedidos.PedidoIn(cliente='Cliente corrigido', status='preparando', itens=itens), 'admin'))
    validar.assert_not_awaited()
