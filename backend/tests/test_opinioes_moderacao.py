import asyncio

from bson import ObjectId

from routers import opinioes


class Result:
    def __init__(self, *, inserted_id=None, matched_count=1):
        self.inserted_id = inserted_id
        self.matched_count = matched_count


class FakeCollection:
    def __init__(self):
        self.documents = []

    async def insert_one(self, document):
        saved = {"_id": ObjectId(), **document}
        self.documents.append(saved)
        return Result(inserted_id=saved["_id"])

    async def find_one(self, query):
        return next(
            (dict(item) for item in self.documents if item["_id"] == query.get("_id")),
            None,
        )

    async def update_one(self, query, update):
        document = next(
            (item for item in self.documents if item["_id"] == query.get("_id")),
            None,
        )
        if not document:
            return Result(matched_count=0)
        document.update(update.get("$set", {}))
        return Result()


class FakeDb:
    def __init__(self):
        self.opinioes = FakeCollection()


async def _ignore_audit(*_args, **_kwargs):
    return None


def test_avaliacao_nova_aguarda_moderacao(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(opinioes, "get_db", lambda: db)

    criada = asyncio.run(
        opinioes.criar_opiniao(
            opinioes.OpiniaoIn(
                perfumeId="perfume-1",
                cliente=" Cliente ",
                nota=5,
                comentario=" Excelente ",
            )
        )
    )

    assert criada["aprovada"] is False
    assert criada["cliente"] == "Cliente"
    assert criada["comentario"] == "Excelente"


def test_administrador_aprova_avaliacao_sem_apagar_registro(monkeypatch):
    db = FakeDb()
    review_id = ObjectId()
    db.opinioes.documents.append({
        "_id": review_id,
        "perfumeId": "perfume-1",
        "nota": 5,
        "comentario": "Excelente",
        "aprovada": False,
    })
    monkeypatch.setattr(opinioes, "get_db", lambda: db)
    monkeypatch.setattr(opinioes, "registrar_auditoria", _ignore_audit)

    atualizada = asyncio.run(
        opinioes.moderar_opiniao(
            str(review_id),
            opinioes.ModeracaoOpiniaoIn(aprovada=True),
            "admin",
        )
    )

    assert atualizada["aprovada"] is True
    assert atualizada["moderadaEm"]
    assert len(db.opinioes.documents) == 1
