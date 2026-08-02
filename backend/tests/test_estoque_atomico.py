import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from locks import stock_lock
from routers.vitrine import _aplicar_disponibilidade
from stock import (item_reserva_estoque, mapa_reservado,
                   pedido_tem_reserva_ativa, quantidades_por_perfume,
                   tamanhos_disponiveis, validar_estoque)


class FakeLockCollection:
    def __init__(self):
        self.document = None
        self.guard = asyncio.Lock()

    async def find_one_and_update(self, _query, update, **_kwargs):
        async with self.guard:
            now = datetime.now(timezone.utc)
            busy = (
                self.document
                and self.document.get("owner")
                and self.document.get("expiresAt", now) > now
            )
            if busy:
                return None
            self.document = {"_id": "estoque-global", **update["$set"]}
            return dict(self.document)

    async def update_one(self, query, _update):
        async with self.guard:
            if self.document and self.document.get("owner") == query.get("owner"):
                self.document["owner"] = None
                self.document.pop("expiresAt", None)


class FakeLockDb:
    def __init__(self):
        self.system_locks = FakeLockCollection()


class FakeOrderCursor:
    def __init__(self, documents):
        self.documents = documents

    async def to_list(self, _length):
        return list(self.documents)


class FakeOrdersCollection:
    def __init__(self, documents):
        self.documents = documents

    def find(self, query, _projection):
        statuses = set(query["status"]["$in"])
        excluded = query.get("_id", {}).get("$ne")
        return FakeOrderCursor([
            document
            for document in self.documents
            if document.get("status") in statuses
            and document.get("_id") != excluded
        ])


class FakeReservationDb:
    def __init__(self, documents):
        self.pedidos = FakeOrdersCollection(documents)


def test_trava_distribuida_serializa_duas_compras():
    async def scenario():
        db = FakeLockDb()
        ativos = 0
        maximo_ativos = 0
        ordem = []

        async def worker(numero):
            nonlocal ativos, maximo_ativos
            async with stock_lock(db, wait_seconds=1, lease_seconds=2):
                ativos += 1
                maximo_ativos = max(maximo_ativos, ativos)
                ordem.append(f"inicio-{numero}")
                await asyncio.sleep(0.03)
                ordem.append(f"fim-{numero}")
                ativos -= 1

        await asyncio.gather(worker(1), worker(2))
        return maximo_ativos, ordem

    maximo_ativos, ordem = asyncio.run(scenario())

    assert maximo_ativos == 1
    assert ordem in (
        ["inicio-1", "fim-1", "inicio-2", "fim-2"],
        ["inicio-2", "fim-2", "inicio-1", "fim-1"],
    )


def test_apenas_uma_compra_reserva_o_ultimo_frasco():
    async def scenario():
        db = FakeLockDb()
        saldo_ml = 50
        reservado_ml = 0
        resultados = []

        async def comprar(cliente):
            nonlocal reservado_ml
            async with stock_lock(db, wait_seconds=1, lease_seconds=2):
                if saldo_ml - reservado_ml < 50:
                    resultados.append((cliente, "sem_estoque"))
                    return
                await asyncio.sleep(0.02)
                reservado_ml += 50
                resultados.append((cliente, "reservado"))

        await asyncio.gather(comprar("A"), comprar("B"))
        return reservado_ml, resultados

    reservado_ml, resultados = asyncio.run(scenario())

    assert reservado_ml == 50
    assert [status for _, status in resultados].count("reservado") == 1
    assert [status for _, status in resultados].count("sem_estoque") == 1


def test_trava_expirada_pode_ser_recuperada():
    async def scenario():
        db = FakeLockDb()
        db.system_locks.document = {
            "_id": "estoque-global",
            "owner": "instancia-interrompida",
            "expiresAt": datetime.now(timezone.utc) - timedelta(seconds=1),
        }
        async with stock_lock(db, wait_seconds=1):
            return db.system_locks.document.get("owner")

    owner = asyncio.run(scenario())
    assert owner not in (None, "instancia-interrompida")


def test_sob_encomenda_nao_reserva_estoque_fisico():
    item = {
        "perfumeId": "perfume-1",
        "ml": 100,
        "quantidade": 2,
        "prontaEntrega": False,
        "tipoAtendimento": "sob_encomenda",
    }

    assert item_reserva_estoque(item) is False
    assert quantidades_por_perfume([item], somente_reservaveis=True) == {}
    assert quantidades_por_perfume([item]) == {"perfume-1": 200}


def test_pedido_antigo_permanece_reservado_por_seguranca():
    item_legado = {"perfumeId": "perfume-1", "ml": 50, "quantidade": 2}

    assert item_reserva_estoque(item_legado) is True
    assert quantidades_por_perfume(
        [item_legado],
        somente_reservaveis=True,
    ) == {"perfume-1": 100}


def test_cancelamento_libera_reserva_e_sob_encomenda_nao_prende_saldo():
    pedido_pronta = {
        "_id": "pedido-1",
        "status": "pendente",
        "itens": [{
            "perfumeId": "perfume-1",
            "ml": 50,
            "quantidade": 1,
            "tipoAtendimento": "pronta_entrega",
        }],
    }
    pedido_encomenda = {
        "_id": "pedido-2",
        "status": "pagamento_confirmado",
        "itens": [{
            "perfumeId": "perfume-1",
            "ml": 100,
            "quantidade": 1,
            "tipoAtendimento": "sob_encomenda",
            "prontaEntrega": False,
        }],
    }
    db = FakeReservationDb([pedido_pronta, pedido_encomenda])

    assert asyncio.run(mapa_reservado(db)) == {"perfume-1": 50}

    pedido_pronta["status"] = "cancelado"
    assert asyncio.run(mapa_reservado(db)) == {}


def test_checkout_abandonado_libera_reserva_apos_sessenta_minutos():
    agora = datetime.now(timezone.utc)
    pedido = {
        "status": "pendente",
        "reservaExpiraEm": (agora - timedelta(seconds=1)).isoformat(),
    }
    assert pedido_tem_reserva_ativa(pedido, agora=agora) is False

    pedido["status"] = "pagamento_confirmado"
    assert pedido_tem_reserva_ativa(pedido, agora=agora) is True


def test_checkout_rejeita_pronta_entrega_sem_saldo(monkeypatch):
    async def fake_mapa(_db, **_kwargs):
        return {"perfume-1": 30}

    monkeypatch.setattr("stock.mapa_disponivel", fake_mapa)
    item = {
        "perfumeId": "perfume-1",
        "ml": 50,
        "quantidade": 1,
        "prontaEntrega": True,
        "tipoAtendimento": "pronta_entrega",
    }

    with pytest.raises(HTTPException) as error:
        asyncio.run(
            validar_estoque(
                object(),
                [item],
                somente_reservaveis=True,
            )
        )

    assert error.value.status_code == 409
    assert error.value.detail["code"] == "ESTOQUE_INSUFICIENTE"
    assert error.value.detail["items"][0]["disponivelMl"] == 30


def test_preparacao_exige_estoque_tambem_para_sob_encomenda(monkeypatch):
    async def fake_mapa(_db, **_kwargs):
        return {"perfume-1": 0}

    monkeypatch.setattr("stock.mapa_disponivel", fake_mapa)
    item = {
        "perfumeId": "perfume-1",
        "ml": 50,
        "quantidade": 1,
        "prontaEntrega": False,
        "tipoAtendimento": "sob_encomenda",
    }

    with pytest.raises(HTTPException, match="estoque suficiente"):
        asyncio.run(
            validar_estoque(
                object(),
                [item],
                somente_reservaveis=False,
            )
        )


def test_vitrine_libera_somente_tamanhos_que_cabem_no_saldo():
    perfume = {
        "prontaEntrega": True,
        "precos": [
            {"ml": 30, "preco": 50},
            {"ml": 50, "preco": 80},
            {"ml": 100, "preco": 150},
        ],
    }

    assert tamanhos_disponiveis(perfume, 50) == [30, 50]
    _aplicar_disponibilidade(
        perfume,
        saldo_fisico_ml=100,
        saldo_reservado_ml=50,
    )
    assert perfume["disponivel"] is True
    assert perfume["tamanhosDisponiveisMl"] == [30, 50]


def test_sob_encomenda_continua_disponivel_sem_saldo():
    perfume = {
        "prontaEntrega": False,
        "precos": [{"ml": 30, "preco": 50}, {"ml": 100, "preco": 150}],
    }

    _aplicar_disponibilidade(
        perfume,
        saldo_fisico_ml=0,
        saldo_reservado_ml=0,
    )
    assert perfume["disponivel"] is True
    assert perfume["statusEstoque"] == "sob_encomenda"
    assert perfume["tamanhosDisponiveisMl"] == [30, 100]
