import pytest
from fastapi import HTTPException

from order_status import ORDER_STATUS_TRANSITIONS, validar_transicao_status


@pytest.mark.parametrize(
    ("atual", "novo"),
    [
        ("pendente", "pagamento_confirmado"),
        ("pagamento_confirmado", "preparando"),
        ("preparando", "pronto"),
        ("pronto", "enviado"),
        ("pronto", "entregue"),
        ("enviado", "entregue"),
        ("pendente", "cancelado"),
        ("preparando", "cancelado"),
        ("entregue", "entregue"),
    ],
)
def test_transicoes_validas(atual, novo):
    validar_transicao_status(atual, novo)


@pytest.mark.parametrize(
    ("atual", "novo"),
    [
        ("pendente", "preparando"),
        ("pendente", "entregue"),
        ("preparando", "pagamento_confirmado"),
        ("enviado", "pronto"),
        ("entregue", "cancelado"),
        ("cancelado", "pendente"),
    ],
)
def test_saltos_e_regressoes_sao_bloqueados(atual, novo):
    with pytest.raises(HTTPException) as erro:
        validar_transicao_status(atual, novo)

    assert erro.value.status_code == 409
    assert erro.value.detail["code"] == "TRANSICAO_STATUS_INVALIDA"


def test_todos_os_status_possuem_regra_explicita():
    assert set(ORDER_STATUS_TRANSITIONS) == {
        "pendente",
        "pagamento_confirmado",
        "preparando",
        "pronto",
        "enviado",
        "entregue",
        "cancelado",
    }
