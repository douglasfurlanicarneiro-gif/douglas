import asyncio

try:
    from availability import (
        INITIAL_READY_DELIVERY_NAMES,
        name_signature,
        zero_made_to_order_stock,
    )
    from routers.vitrine import _alphabetical_name
except ModuleNotFoundError:
    from backend.availability import (
        INITIAL_READY_DELIVERY_NAMES,
        name_signature,
        zero_made_to_order_stock,
    )
    from backend.routers.vitrine import _alphabetical_name


def test_initial_ready_delivery_list_has_22_unique_items():
    signatures = [name_signature(name) for name in INITIAL_READY_DELIVERY_NAMES]
    assert len(signatures) == 22
    assert len(set(signatures)) == 22


def test_name_signature_ignores_order_accents_and_audience_qualifiers():
    assert name_signature("Azzaro The Most Wanted") == name_signature(
        "The Most Wanted Azzaro Masculino"
    )
    assert name_signature("Althair Parfums de Marly") == name_signature(
        "Althaïr Parfums de Marly Masculino"
    )
    assert name_signature("Vanilla | 28 Kayali Fragrances") == name_signature(
        "Vanilla 28 Kayali Fragrances Compartilhável"
    )


def test_alphabetical_name_tolerates_legacy_mojibake():
    items = [
        {"nome": "Pr 1 MilhÃ£o Elixir"},
        {"nome": "Pr 1 Milhao Prive"},
    ]

    assert [item["nome"] for item in sorted(items, key=_alphabetical_name)] == [
        "Pr 1 MilhÃ£o Elixir",
        "Pr 1 Milhao Prive",
    ]


class _ListCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, _limit):
        return self.rows


class _AsyncRows:
    def __init__(self, rows):
        self.rows = rows

    def __aiter__(self):
        async def iterator():
            for row in self.rows:
                yield row

        return iterator()


class _PerfumesCollection:
    def find(self, _query, _projection):
        return _ListCursor([{"_id": "sob-1"}, {"_id": "sob-2"}])


class _MovimentosCollection:
    def __init__(self):
        self.inserted = []

    async def aggregate(self, _pipeline):
        return _AsyncRows([
            {"_id": "sob-1", "total": 1000},
            {"_id": "sob-2", "total": 0},
            {"_id": "pronta-1", "total": 1000},
        ])

    async def insert_many(self, rows):
        self.inserted.extend(rows)


class _StockDatabase:
    def __init__(self):
        self.perfumes = _PerfumesCollection()
        self.movimentos = _MovimentosCollection()


def test_zero_made_to_order_stock_preserves_ready_delivery():
    db = _StockDatabase()

    result = asyncio.run(zero_made_to_order_stock(db))

    assert result == {"estoquesZerados": 1, "quantidadeZeradaMl": 1000}
    assert len(db.movimentos.inserted) == 1
    assert db.movimentos.inserted[0]["perfumeId"] == "sob-1"
    assert db.movimentos.inserted[0]["tipo"] == "saida"
    assert db.movimentos.inserted[0]["quantidadeMl"] == 1000
