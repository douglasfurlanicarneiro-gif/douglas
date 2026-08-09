"""Regras centrais de saldo, reserva e disponibilidade de estoque."""

from collections.abc import Iterable, Mapping
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException


ACTIVE_RESERVATION_STATUSES = ("pendente", "pagamento_confirmado")
RESERVATION_TTL_MINUTES = 60

STOCK_PIPELINE = [
    {
        "$group": {
            "_id": "$perfumeId",
            "total": {
                "$sum": {
                    "$cond": [
                        {"$eq": ["$tipo", "entrada"]},
                        "$quantidadeMl",
                        {"$multiply": ["$quantidadeMl", -1]},
                    ]
                }
            },
        }
    },
]


def _item_dict(item: Any) -> dict:
    if isinstance(item, Mapping):
        return dict(item)
    if hasattr(item, "model_dump"):
        return item.model_dump()
    return {
        "perfumeId": getattr(item, "perfumeId", ""),
        "ml": getattr(item, "ml", 0),
        "quantidade": getattr(item, "quantidade", 1),
        "prontaEntrega": getattr(item, "prontaEntrega", None),
        "tipoAtendimento": getattr(item, "tipoAtendimento", None),
    }


def item_reserva_estoque(item: Any) -> bool:
    """Pedidos antigos são tratados conservadoramente como pronta entrega."""
    data = _item_dict(item)
    if data.get("tipoAtendimento") == "sob_encomenda":
        return False
    if data.get("prontaEntrega") is False:
        return False
    return True


def pedido_tem_reserva_ativa(pedido: Mapping[str, Any], *, agora: datetime | None = None) -> bool:
    status = pedido.get("status")
    if status == "pagamento_confirmado":
        return True
    if status != "pendente":
        return False

    expira_em = pedido.get("reservaExpiraEm")
    if not expira_em:
        # Pedidos administrativos e registros antigos não expiram sem uma
        # indicação explícita, preservando o comportamento anterior.
        return True
    try:
        if isinstance(expira_em, datetime):
            expiration = expira_em
        else:
            expiration = datetime.fromisoformat(str(expira_em).replace("Z", "+00:00"))
        if expiration.tzinfo is None:
            expiration = expiration.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return True
    return expiration > (agora or datetime.now(timezone.utc))


def quantidades_por_perfume(
    itens: Iterable[Any],
    *,
    somente_reservaveis: bool = False,
) -> dict[str, int]:
    quantidades: dict[str, int] = {}
    for raw_item in itens:
        item = _item_dict(raw_item)
        if somente_reservaveis and not item_reserva_estoque(item):
            continue
        perfume_id = str(item.get("perfumeId") or "")
        if not perfume_id:
            continue
        try:
            quantidade_ml = int(item.get("ml", 0)) * int(item.get("quantidade", 1))
        except (TypeError, ValueError):
            continue
        if quantidade_ml <= 0:
            continue
        quantidades[perfume_id] = quantidades.get(perfume_id, 0) + quantidade_ml
    return quantidades


async def mapa_saldo_fisico(db) -> dict[str, int]:
    saldo: dict[str, int] = {}
    async for linha in db.movimentos.aggregate(STOCK_PIPELINE):
        saldo[str(linha["_id"])] = int(linha.get("total", 0))
    return saldo


def _object_id_or_original(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except (InvalidId, TypeError):
        return value


async def mapa_reservado(db, *, excluir_pedido_id: Any | None = None) -> dict[str, int]:
    filtro: dict[str, Any] = {
        "status": {"$in": list(ACTIVE_RESERVATION_STATUSES)},
        "arquivadoEm": None,
    }
    if excluir_pedido_id is not None:
        filtro["_id"] = {"$ne": _object_id_or_original(excluir_pedido_id)}

    reservado: dict[str, int] = {}
    pedidos = await db.pedidos.find(
        filtro,
        {"itens": 1, "status": 1, "reservaExpiraEm": 1},
    ).to_list(5000)
    for pedido in pedidos:
        if not pedido_tem_reserva_ativa(pedido):
            continue
        for perfume_id, quantidade_ml in quantidades_por_perfume(
            pedido.get("itens", []),
            somente_reservaveis=True,
        ).items():
            reservado[perfume_id] = reservado.get(perfume_id, 0) + quantidade_ml
    return reservado


async def mapa_disponivel(db, *, excluir_pedido_id: Any | None = None) -> dict[str, int]:
    saldo = await mapa_saldo_fisico(db)
    reservado = await mapa_reservado(db, excluir_pedido_id=excluir_pedido_id)
    return {
        perfume_id: saldo.get(perfume_id, 0) - reservado.get(perfume_id, 0)
        for perfume_id in set(saldo) | set(reservado)
    }


async def validar_estoque(
    db,
    itens: Iterable[Any],
    *,
    excluir_pedido_id: Any | None = None,
    somente_reservaveis: bool,
    credito_itens: Iterable[Any] | None = None,
) -> None:
    """Valida saldo livre enquanto a trava distribuída estiver adquirida."""
    solicitadas = quantidades_por_perfume(
        itens,
        somente_reservaveis=somente_reservaveis,
    )
    if not solicitadas:
        return

    disponivel = await mapa_disponivel(db, excluir_pedido_id=excluir_pedido_id)
    # Ao editar um pedido que já consumiu o estoque, devolvemos virtualmente a
    # baixa antiga antes de validar a nova composição. A movimentação real só
    # é substituída depois que a validação passa.
    for perfume_id, quantidade_ml in quantidades_por_perfume(
        credito_itens or [],
    ).items():
        disponivel[perfume_id] = disponivel.get(perfume_id, 0) + quantidade_ml
    faltantes = []
    for perfume_id, quantidade_ml in solicitadas.items():
        saldo_livre = max(0, disponivel.get(perfume_id, 0))
        if saldo_livre < quantidade_ml:
            faltantes.append({
                "perfumeId": perfume_id,
                "solicitadoMl": quantidade_ml,
                "disponivelMl": saldo_livre,
            })

    if faltantes:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "ESTOQUE_INSUFICIENTE",
                "message": (
                    "Um item de pronta entrega acabou de ficar sem saldo suficiente. "
                    "Atualize a vitrine e escolha outro tamanho."
                    if somente_reservaveis
                    else (
                        "Ainda não há estoque suficiente para iniciar a preparação. "
                        "Registre uma entrada de essência e tente novamente."
                    )
                ),
                "items": faltantes,
            },
        )


def tamanhos_disponiveis(perfume: Mapping[str, Any], saldo_livre_ml: int) -> list[int]:
    opcoes = [
        int(opcao.get("ml", 0))
        for opcao in perfume.get("precos", [])
        if int(opcao.get("ml", 0) or 0) > 0 and float(opcao.get("preco", 0) or 0) > 0
    ]
    if perfume.get("prontaEntrega") is not True:
        return opcoes
    return [ml for ml in opcoes if ml <= max(0, saldo_livre_ml)]
