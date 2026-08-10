import asyncio

from bson import ObjectId

from routers import opinioes


class Result:
    def __init__(self, *, inserted_id=None, matched_count=1):
        self.inserted_id = inserted_id
        self.matched_count = matched_count


class FakeCollection:
    def __init__(self, documents=None):
        self.documents = documents or []

    async def insert_one(self, document):
        saved = {"_id": ObjectId(), **document}
        self.documents.append(saved)
        return Result(inserted_id=saved["_id"])

    async def find_one(self, query, _projection=None):
        return next(
            (dict(item) for item in self.documents
             if item["_id"] == query.get("_id")
             and ("publicavel" not in query or item.get("publicavel") == query["publicavel"])
             and ("arquivadoEm" not in query or item.get("arquivadoEm") == query["arquivadoEm"])),
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
        self.perfume_id = ObjectId()
        self.perfumes = FakeCollection([{
            "_id": self.perfume_id, "publicavel": True, "arquivadoEm": None,
        }])


async def _ignore_audit(*_args, **_kwargs):
    return None


def test_avaliacao_nova_aguarda_moderacao(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(opinioes, "get_db", lambda: db)

    criada = asyncio.run(
        opinioes.criar_opiniao(
            opinioes.OpiniaoIn(
                perfumeId=str(db.perfume_id),
                cliente=" Cliente ",
                nota=5,
                comentario=" Excelente ",
            )
        )
    )

    assert criada["aprovada"] is False
    assert criada["cliente"] == "Cliente"
    assert criada["comentario"] == "Excelente"


def test_avaliacao_rejeita_perfume_que_nao_esta_na_vitrine(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(opinioes, "get_db", lambda: db)

    try:
        asyncio.run(opinioes.criar_opiniao(opinioes.OpiniaoIn(
            perfumeId=str(ObjectId()), cliente="Cliente", nota=5, comentario="Ótimo",
        )))
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 404
    else:
        raise AssertionError("Avaliação de perfume inexistente deveria ser recusada.")


def test_nome_publico_nao_expoe_nome_completo():
    documento = {
        "_id": ObjectId(), "perfumeId": str(ObjectId()), "cliente": "Douglas Furlani",
        "nota": 5, "comentario": "Excelente", "data": "2026-08-10T12:00:00+00:00",
    }
    assert opinioes._opiniao_publica(documento)["cliente"] == "Douglas F."


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
