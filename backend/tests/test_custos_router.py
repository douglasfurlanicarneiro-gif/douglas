import asyncio

from routers import custos


class _Cursor:
    def __init__(self, items):
        self.items = items

    def sort(self, *_args):
        return self

    async def to_list(self, _limit):
        return self.items


class _PerfumesCollection:
    def __init__(self, items):
        self.items = items
        self.filter = None

    def find(self, query, _projection):
        self.filter = query
        return _Cursor(self.items)


class _Db:
    def __init__(self, items):
        self.perfumes = _PerfumesCollection(items)


def test_rentabilidade_ignora_perfumes_arquivados(monkeypatch):
    db = _Db([{
        "_id": "ativo-1",
        "nome": "Perfume ativo",
        "precos": [{"ml": 30, "preco": 50}],
        "custoEssenciaPorMl": 1,
        "publicavel": True,
    }])

    async def _config(_db):
        return {}

    monkeypatch.setattr(custos, "get_db", lambda: db)
    monkeypatch.setattr(custos, "obter_config_custos", _config)

    result = asyncio.run(custos.rentabilidade_catalogo("admin"))

    assert db.perfumes.filter == {"arquivadoEm": None}
    assert {item["perfumeId"] for item in result["itens"]} == {"ativo-1"}
