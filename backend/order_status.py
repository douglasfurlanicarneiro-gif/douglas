"""Regras centrais do ciclo de vida dos pedidos."""

from collections.abc import Mapping

from fastapi import HTTPException


ORDER_STATUS_TRANSITIONS: Mapping[str, frozenset[str]] = {
    "pendente": frozenset({"pagamento_confirmado", "cancelado"}),
    "pagamento_confirmado": frozenset({"preparando", "cancelado"}),
    "preparando": frozenset({"pronto", "cancelado"}),
    "pronto": frozenset({"enviado", "entregue", "cancelado"}),
    "enviado": frozenset({"entregue"}),
    "entregue": frozenset(),
    "cancelado": frozenset(),
}


def validar_transicao_status(atual: str, novo: str) -> None:
    """Rejeita saltos e regressões que corromperiam o fluxo operacional."""
    if atual == novo:
        return
    permitidos = ORDER_STATUS_TRANSITIONS.get(atual, frozenset())
    if novo not in permitidos:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "TRANSICAO_STATUS_INVALIDA",
                "message": (
                    f"Não é possível alterar o pedido de '{atual}' para '{novo}'. "
                    "Avance o pedido pela próxima etapa do atendimento."
                ),
                "statusAtual": atual,
                "statusSolicitado": novo,
                "statusPermitidos": sorted(permitidos),
            },
        )
