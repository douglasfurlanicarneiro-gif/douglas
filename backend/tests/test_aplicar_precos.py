import asyncio

try:
    import routers.perfumes as perfumes_router
    from routers.perfumes import AplicarPrecosPayload, Preco, _novos_precos
except ModuleNotFoundError:
    import backend.routers.perfumes as perfumes_router
    from backend.routers.perfumes import AplicarPrecosPayload, Preco, _novos_precos


def test_novos_precos_atualiza_tamanhos_escolhidos_e_preserva_personalizados():
    resultado = _novos_precos(
        [
            {"ml": 10, "preco": 25},
            {"ml": 30, "preco": 45},
            {"ml": 50, "preco": 75},
            {"ml": 100, "preco": 110},
        ],
        {30: 50, 50: 85, 100: 150},
        {30, 50},
    )

    assert resultado == [
        {"ml": 10, "preco": 25.0},
        {"ml": 30, "preco": 50.0},
        {"ml": 50, "preco": 85.0},
        {"ml": 100, "preco": 110.0},
    ]


def test_novos_precos_cria_tamanho_ausente():
    resultado = _novos_precos(
        [{"ml": 30, "preco": 50}],
        {30: 50, 50: 80, 100: 120},
        {100},
    )

    assert resultado == [
        {"ml": 30, "preco": 50.0},
        {"ml": 100, "preco": 120.0},
    ]


class _ListCursor:
    async def to_list(self, _limit):
        return [
            {"_id": "id-1", "precos": [{"ml": 30, "preco": 40}]},
            {"_id": "id-2", "precos": [{"ml": 50, "preco": 70}]},
        ]


class _PerfumesCollection:
    def __init__(self):
        self.bulk_calls = []

    def find(self, _query, _projection):
        return _ListCursor()

    async def bulk_write(self, operations, ordered):
        self.bulk_calls.append((operations, ordered))


class _OperationsCollection:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(row)


class _Database:
    def __init__(self):
        self.perfumes = _PerfumesCollection()
        self.operacoes_sistema = _OperationsCollection()


def test_aplicar_precos_usa_um_lote_e_publica_na_mesma_operacao(monkeypatch):
    db = _Database()
    publicacoes = []

    async def fake_publicar(database, *, registrar_operacao):
        publicacoes.append((database, registrar_operacao))
        return {
            "atualizadoEm": "2026-07-29T12:00:00+00:00",
            "itensPublicados": 2,
        }

    monkeypatch.setattr(perfumes_router, "get_db", lambda: db)
    monkeypatch.setattr(perfumes_router, "publicar_snapshot", fake_publicar)
    payload = AplicarPrecosPayload(
        precos=[
            Preco(ml=30, preco=50),
            Preco(ml=50, preco=80),
            Preco(ml=100, preco=120),
        ],
        tamanhos=[30, 50, 100],
    )

    result = asyncio.run(perfumes_router.aplicar_precos(payload))

    assert len(db.perfumes.bulk_calls) == 1
    assert len(db.perfumes.bulk_calls[0][0]) == 2
    assert db.perfumes.bulk_calls[0][1] is False
    assert publicacoes == [(db, False)]
    assert result["atualizados"] == 2
    assert result["itensPublicados"] == 2
    assert db.operacoes_sistema.rows[0]["tipo"] == "aplicar_precos"
