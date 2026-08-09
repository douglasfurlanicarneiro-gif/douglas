import pytest
from pydantic import ValidationError

from routers.privacidade import SolicitacaoPrivacidadeIn, _protocolo


def test_protocolo_de_privacidade_nao_expoe_identidade():
    protocolo = _protocolo()

    assert protocolo.startswith("LFE-")
    assert len(protocolo) == 16
    assert protocolo[4:].isalnum()


def test_solicitacao_exige_confirmacao_de_titularidade():
    with pytest.raises(ValidationError, match="solicitação"):
        SolicitacaoPrivacidadeIn(
            tipo="acesso",
            nome="Cliente Teste",
            contato="11999999999",
            confirmacaoTitularidade=False,
        )


def test_solicitacao_valida_limites_e_email():
    solicitacao = SolicitacaoPrivacidadeIn(
        tipo="exclusao",
        nome="Cliente Teste",
        contato="11999999999",
        email="cliente@example.com",
        confirmacaoTitularidade=True,
    )

    assert solicitacao.tipo == "exclusao"
    assert solicitacao.email == "cliente@example.com"
