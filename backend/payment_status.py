"""Regras do ciclo financeiro, independentes do status operacional do pedido."""

from collections.abc import Mapping

from fastapi import HTTPException


PAYMENT_OPERATION_TARGET: Mapping[str, str] = {
    "solicitar_estorno": "estorno_solicitado",
    "confirmar_estorno": "estornado",
    "registrar_contestacao": "contestado",
    "resolver_contestacao_favoravel": "pago",
    "resolver_chargeback": "chargeback_confirmado",
}

PAYMENT_OPERATION_SOURCE: Mapping[str, frozenset[str]] = {
    "solicitar_estorno": frozenset({"pago"}),
    "confirmar_estorno": frozenset({"estorno_solicitado"}),
    "registrar_contestacao": frozenset({"pago", "estorno_solicitado"}),
    "resolver_contestacao_favoravel": frozenset({"contestado"}),
    "resolver_chargeback": frozenset({"contestado"}),
}

PAYMENT_STATUSES_THAT_BLOCK_CANCELLATION = frozenset(
    {"pago", "estorno_solicitado", "contestado"}
)


def validar_operacao_pagamento(status_atual: str, operacao: str) -> str:
    destino = PAYMENT_OPERATION_TARGET.get(operacao)
    permitidos = PAYMENT_OPERATION_SOURCE.get(operacao, frozenset())
    if not destino or status_atual not in permitidos:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "OPERACAO_FINANCEIRA_INVALIDA",
                "message": (
                    f"A operação '{operacao}' não pode ser aplicada a um "
                    f"pagamento com status '{status_atual or 'não informado'}'."
                ),
                "statusPagamento": status_atual,
                "operacao": operacao,
            },
        )
    return destino

