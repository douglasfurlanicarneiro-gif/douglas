from routers.admin import ConfiguracoesLojaPublica


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
