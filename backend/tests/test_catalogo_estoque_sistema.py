import asyncio

try:
    from availability import apply_ready_delivery_by_ids
    from routers.catalogo_estoque import (
        _movimentos_para_completar,
        _movimentos_para_zerar,
    )
except ModuleNotFoundError:
    from backend.availability import apply_ready_delivery_by_ids
    from backend.routers.catalogo_estoque import (
        _movimentos_para_completar,
        _movimentos_para_zerar,
    )


def test_zerar_sob_encomenda_so_retorna_saldos_positivos_selecionados():
    movimentos = _movimentos_para_zerar(
        {"sob-1", "sob-2", "sob-3"},
        {
            "sob-1": 750,
            "sob-2": 0,
            "sob-3": -30,
            "pronta-1": 1000,
        },
        "2026-07-29T12:00:00+00:00",
    )

    assert len(movimentos) == 1
    assert movimentos[0]["perfumeId"] == "sob-1"
    assert movimentos[0]["tipo"] == "saida"
    assert movimentos[0]["quantidadeMl"] == 750


def test_completar_pronta_entrega_nunca_reduz_estoque_acima_do_alvo():
    movimentos = _movimentos_para_completar(
        {"pronta-1", "pronta-2", "pronta-3"},
        {
            "pronta-1": 200,
            "pronta-2": 1000,
            "pronta-3": 1250,
            "sob-1": 0,
        },
        1000,
        "2026-07-29T12:00:00+00:00",
    )

    assert len(movimentos) == 1
    assert movimentos[0]["perfumeId"] == "pronta-1"
    assert movimentos[0]["tipo"] == "entrada"
    assert movimentos[0]["quantidadeMl"] == 800


class _ListCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _limit):
        return self.rows


class _PerfumesCollection:
    def __init__(self):
        self.rows = [{"_id": "id-a"}, {"_id": "id-b"}, {"_id": "id-c"}]
        self.updates = []

    def find(self, _query, _projection):
        return _ListCursor(self.rows)

    async def update_many(self, query, update):
        self.updates.append((query, update))


class _VitrineCollection:
    def __init__(self):
        self.updated_items = None

    async def find_one(self, _query):
        return {
            "_id": "snapshot",
            "itens": [
                {"id": "id-a", "prontaEntrega": False},
                {"id": "id-b", "prontaEntrega": True},
                {"id": "id-c", "prontaEntrega": False},
            ],
        }

    async def update_one(self, _query, update):
        self.updated_items = update["$set"]["itens"]


class _AvailabilityDatabase:
    def __init__(self):
        self.perfumes = _PerfumesCollection()
        self.vitrine = _VitrineCollection()


def test_disponibilidade_por_id_atualiza_catalogo_e_snapshot_sem_nomes():
    db = _AvailabilityDatabase()

    result = asyncio.run(apply_ready_delivery_by_ids(
        db,
        ["id-c", "id-a", "id-c", "id-inexistente"],
    ))

    assert result == {
        "prontaEntrega": 2,
        "sobEncomenda": 1,
        "encontrados": ["id-c", "id-a"],
        "naoEncontrados": ["id-inexistente"],
    }
    assert db.perfumes.updates[0] == ({}, {"$set": {"prontaEntrega": False}})
    assert db.perfumes.updates[1][0] == {"_id": {"$in": ["id-c", "id-a"]}}
    assert [item["prontaEntrega"] for item in db.vitrine.updated_items] == [
        True,
        False,
        True,
    ]
