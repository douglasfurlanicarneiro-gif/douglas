import asyncio

import catalog_seed


class _Collection:
    def __init__(self, documents=None):
        self.documents = list(documents or [])

    async def find_one(self, query):
        if "nome" in query and isinstance(query["nome"], dict):
            return self.documents[0] if self.documents else None
        for document in self.documents:
            for condition in query.get("$or", []):
                if all(document.get(key) == value for key, value in condition.items()):
                    return document
        return None

    async def insert_one(self, document):
        self.documents.append(dict(document))


class _Database:
    def __init__(self):
        self.fornecedores = _Collection([{"_id": "nova-id", "nome": "Nova Essência"}])
        self.perfumes = _Collection()


def test_seed_dos_lancamentos_e_completo_e_idempotente(monkeypatch):
    db = _Database()
    sequence = 421

    async def next_sequence(_db, _collection):
        nonlocal sequence
        sequence += 1
        return sequence

    monkeypatch.setattr(catalog_seed, "next_seq", next_sequence)
    first = asyncio.run(catalog_seed.ensure_current_nova_essencia_launches(db))
    second = asyncio.run(catalog_seed.ensure_current_nova_essencia_launches(db))

    assert first == {"adicionados": 12, "jaExistentes": 0}
    assert second == {"adicionados": 0, "jaExistentes": 12}
    assert len(db.perfumes.documents) == 12
    assert len({item["fornecedorCodigo"] for item in db.perfumes.documents}) == 12
    assert [item["seq"] for item in db.perfumes.documents] == list(range(422, 434))
    assert all(item["publicavel"] is True for item in db.perfumes.documents)
    assert all(item["prontaEntrega"] is False for item in db.perfumes.documents)
    assert all(item["custoEssenciaPorMl"] > 0 for item in db.perfumes.documents)
    assert all(item["fornecedorId"] == "nova-id" for item in db.perfumes.documents)
    assert all(item["imagemUrl"].endswith(".avif") for item in db.perfumes.documents)
    assert all(item["precos"] == catalog_seed.STANDARD_PRICES for item in db.perfumes.documents)
