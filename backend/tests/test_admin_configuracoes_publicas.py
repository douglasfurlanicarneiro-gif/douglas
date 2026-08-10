import asyncio

from routers import admin
from routers.admin import ConfiguracoesLojaIn, ConfiguracoesLojaPublica


def test_configuracao_publica_nao_expoe_chave_pix():
    configuracao = ConfiguracoesLojaPublica(
        nomeLoja="Loja de teste",
        logoUrl="",
        whatsapp="",
        instagram="",
        email="",
        cartaoOnlineAtivo=True,
        pixManualAtivo=True,
    ).model_dump()

    assert "pix" not in configuracao
    assert configuracao["pixManualAtivo"] is True


def test_canais_podem_ser_limpos_intencionalmente(monkeypatch):
    class Collection:
        saved = None

        async def update_one(self, _query, update, **_kwargs):
            self.saved = update["$set"]

    class Db:
        configuracoes = Collection()

    db = Db()
    monkeypatch.setattr(admin, "get_db", lambda: db)
    payload = ConfiguracoesLojaIn(
        nomeLoja="Loja",
        whatsapp="",
        instagram="",
        email="",
        logoUrl="",
        pix="",
        infinitePayHandle="",
        cnpj="",
    )

    resultado = asyncio.run(admin.salvar_configuracoes(payload, "admin"))

    assert resultado["whatsapp"] == ""
    assert resultado["instagram"] == ""
    assert resultado["email"] == ""
    assert db.configuracoes.saved["logoUrl"] == ""


def test_configuracao_publica_usa_whatsapp_do_ambiente(monkeypatch):
    class Collection:
        async def find_one(self, _query):
            return {"_id": "loja", "nomeLoja": "Loja de teste", "whatsapp": ""}

    class Db:
        configuracoes = Collection()

    monkeypatch.setattr(admin, "get_db", lambda: Db())
    monkeypatch.setenv("WHATSAPP_NUMBER", "5511999999999")

    resultado = asyncio.run(admin.obter_configuracoes_publicas())

    assert resultado["whatsapp"] == "5511999999999"
