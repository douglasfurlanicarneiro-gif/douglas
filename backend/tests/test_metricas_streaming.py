import asyncio
from datetime import datetime

from bson import ObjectId

from routers import admin


class CursorStreaming:
    def __init__(self, documentos):
        self.documentos = list(documentos)

    def __aiter__(self):
        self._indice = 0
        return self

    async def __anext__(self):
        if self._indice >= len(self.documentos):
            raise StopAsyncIteration
        documento = self.documentos[self._indice]
        self._indice += 1
        return documento

    async def to_list(self, *_args, **_kwargs):
        raise AssertionError("A rota de métricas não deve materializar o cursor.")


class ColecaoFalsa:
    def __init__(self, documentos):
        self.documentos = documentos
        self.ultimo_filtro = None

    def find(self, filtro, _projecao=None):
        self.ultimo_filtro = filtro
        return CursorStreaming(self.documentos)


class BancoFalso:
    def __init__(self):
        perfume_id = ObjectId()
        self.perfumes = ColecaoFalsa(
            [
                {
                    "_id": perfume_id,
                    "nome": "Perfume teste",
                    "custoEssenciaPorMl": 1,
                    "concentracaoPercentual": 20,
                }
            ]
        )
        self.pedidos = ColecaoFalsa(
            [
                {
                    "status": "pagamento_confirmado",
                    "criadoEm": "2026-08-09T12:00:00+00:00",
                    "total": 120,
                    "itens": [
                        {
                            "perfumeId": str(perfume_id),
                            "perfumeNome": "Perfume teste",
                            "ml": 50,
                            "quantidade": 1,
                            "precoUnitario": 100,
                            "subtotal": 100,
                            "custoUnitarioEstimado": 35,
                        }
                    ],
                },
                {
                    "status": "pendente",
                    "criadoEm": "2026-08-09T12:05:00+00:00",
                    "total": 80,
                    "itens": [],
                },
                {
                    "status": "cancelado",
                    "criadoEm": "2026-08-09T12:10:00+00:00",
                    "total": 70,
                    "itens": [],
                },
            ]
        )


def test_metricas_processam_cursores_sem_limite_em_memoria(monkeypatch):
    banco = BancoFalso()
    monkeypatch.setattr(admin, "get_db", lambda: banco)

    async def config_custos(_db):
        return {}

    monkeypatch.setattr(admin, "obter_config_custos", config_custos)

    resultado = asyncio.run(admin.obter_metricas(periodo="todos", _="admin"))

    assert resultado["pedidosTotal"] == 3
    assert resultado["pedidosValidos"] == 2
    assert resultado["pedidosPagos"] == 1
    assert resultado["pedidosPendentes"] == 1
    assert resultado["pedidosCancelados"] == 1
    assert resultado["pedidosPorStatus"] == {
        "pagamento_confirmado": 1,
        "pendente": 1,
        "cancelado": 1,
    }
    assert resultado["receitaConfirmada"] == 120
    assert resultado["aReceber"] == 80
    assert resultado["ticketMedio"] == 120
    assert resultado["lucroEstimado"] == 65
    assert resultado["mlVendidos"] == 50
    assert banco.pedidos.ultimo_filtro == {"excluirMetricas": {"$ne": True}}


def test_metricas_filtram_periodo_com_data_bson(monkeypatch):
    banco = BancoFalso()
    monkeypatch.setattr(admin, "get_db", lambda: banco)

    async def config_custos(_db):
        return {}

    monkeypatch.setattr(admin, "obter_config_custos", config_custos)
    asyncio.run(admin.obter_metricas(periodo="7d", _="admin"))

    limite = banco.pedidos.ultimo_filtro["criadoEm"]["$gte"]
    assert isinstance(limite, datetime)
    assert limite.tzinfo is not None


def test_metricas_separam_estorno_chargeback_e_receita_em_risco(monkeypatch):
    banco = BancoFalso()
    base = {
        "status": "pagamento_confirmado",
        "criadoEm": "2026-08-09T12:00:00+00:00",
        "itens": [],
    }
    banco.pedidos.documentos = [
        {**base, "total": 100, "pagamento": {"status": "estornado"}},
        {**base, "total": 80, "pagamento": {"status": "chargeback_confirmado"}},
        {**base, "total": 60, "pagamento": {"status": "contestado"}},
        {**base, "total": 40, "pagamento": {"status": "estorno_solicitado"}},
    ]
    monkeypatch.setattr(admin, "get_db", lambda: banco)

    async def config_custos(_db):
        return {}

    monkeypatch.setattr(admin, "obter_config_custos", config_custos)
    resultado = asyncio.run(admin.obter_metricas(periodo="todos", _="admin"))

    assert resultado["receitaConfirmada"] == 100
    assert resultado["receitaEmRisco"] == 100
    assert resultado["valorEstornado"] == 100
    assert resultado["valorChargeback"] == 80
    assert resultado["pedidosEstornados"] == 1
    assert resultado["chargebacks"] == 1
