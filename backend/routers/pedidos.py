from datetime import datetime, timezone
from typing import Any, List, Literal, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_db
from locks import stock_lock
from security import require_atelie_auth
from stock import quantidades_por_perfume, validar_estoque
from utils import next_seq, serialize

router = APIRouter(prefix="/api/pedidos", tags=["pedidos"])


class ItemPedido(BaseModel):
    perfumeId: str
    ml: int = Field(gt=0, le=1000)
    quantidade: int = Field(gt=0, le=100)
    precoUnitario: Optional[float] = Field(default=None, ge=0)
    subtotal: Optional[float] = Field(default=None, ge=0)
    prontaEntrega: Optional[bool] = None
    tipoAtendimento: Optional[Literal["pronta_entrega", "sob_encomenda"]] = None


class PedidoIn(BaseModel):
    cliente: str = Field(min_length=2, max_length=120)
    contato: str = Field(default="", max_length=160)
    status: Literal[
        "pendente",
        "pagamento_confirmado",
        "preparando",
        "pronto",
        "enviado",
        "entregue",
        "cancelado",
    ] = "pendente"
    observacoes: str = Field(default="", max_length=1000)
    itens: List[ItemPedido] = Field(min_length=1, max_length=100)
    subtotalTabela: Optional[float] = Field(default=None, ge=0)
    ajusteManual: float = 0
    total: float = Field(default=0, ge=0)


def _oid(pedido_id: str) -> ObjectId:
    try:
        return ObjectId(pedido_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de pedido inválido.")


async def _reverter_movimentos_do_pedido(db, pedido_id: str):
    await db.movimentos.delete_many({"origem": f"pedido:{pedido_id}"})


def _status_consume_estoque(status: str) -> bool:
    return status in ("preparando", "pronto", "enviado", "entregue")


async def _itens_com_atendimento(db, itens: List[ItemPedido]) -> list[dict[str, Any]]:
    """Grava no pedido como cada item será atendido naquele momento."""
    object_ids = []
    for item in itens:
        try:
            object_ids.append(ObjectId(item.perfumeId))
        except InvalidId:
            continue
    perfumes = await db.perfumes.find(
        {"_id": {"$in": object_ids}},
        {"prontaEntrega": 1},
    ).to_list(len(object_ids))
    pronta_por_id = {
        str(perfume["_id"]): perfume.get("prontaEntrega") is True
        for perfume in perfumes
    }

    resultado = []
    for item in itens:
        data = item.model_dump()
        pronta = data.get("prontaEntrega")
        if pronta is None:
            # Item antigo ou produto removido: o padrão conservador evita
            # liberar uma reserva que já existia.
            pronta = pronta_por_id.get(item.perfumeId, True)
        data["prontaEntrega"] = bool(pronta)
        data["tipoAtendimento"] = (
            "pronta_entrega" if pronta else "sob_encomenda"
        )
        resultado.append(data)
    return resultado


async def _validar_status_estoque(
    db,
    *,
    itens: list[dict[str, Any]],
    status: str,
    pedido_id: str | None = None,
    pedido_anterior: dict | None = None,
) -> None:
    if status == "cancelado":
        return
    credito_itens = (
        pedido_anterior.get("itens", [])
        if pedido_anterior and _status_consume_estoque(pedido_anterior.get("status", ""))
        else []
    )
    await validar_estoque(
        db,
        itens,
        excluir_pedido_id=pedido_id,
        somente_reservaveis=not _status_consume_estoque(status),
        credito_itens=credito_itens,
    )


async def _aplicar_saida_estoque(db, pedido_id: str, itens: list[Any], status: str):
    # Enquanto o pedido está pendente, a quantidade aparece apenas como
    # reservada no resumo. A baixa física começa quando o preparo é iniciado.
    if not _status_consume_estoque(status):
        return
    agora = datetime.now(timezone.utc).isoformat()
    for perfume_id, quantidade_ml in quantidades_por_perfume(itens).items():
        await db.movimentos.insert_one({
            "perfumeId": perfume_id,
            "tipo": "saida",
            "quantidadeMl": quantidade_ml,
            "motivo": "Baixa automática ao iniciar preparação",
            "categoria": "pedido",
            "origem": f"pedido:{pedido_id}",
            "data": agora,
        })


@router.get("")
async def listar_pedidos(_: str = Depends(require_atelie_auth)):
    db = get_db()
    pedidos = await db.pedidos.find().sort("seq", -1).to_list(5000)
    return [serialize(p) for p in pedidos]


@router.post("")
async def criar_pedido(payload: PedidoIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    async with stock_lock(db):
        itens = await _itens_com_atendimento(db, payload.itens)
        await _validar_status_estoque(db, itens=itens, status=payload.status)
        doc = payload.model_dump()
        doc["itens"] = itens
        doc["seq"] = await next_seq(db, "pedidos")
        agora = datetime.now(timezone.utc).isoformat()
        doc["criadoEm"] = agora
        doc["historicoStatus"] = [{"status": payload.status, "data": agora}]
        resultado = await db.pedidos.insert_one(doc)
        pedido_id = str(resultado.inserted_id)
        await _aplicar_saida_estoque(db, pedido_id, itens, payload.status)
        novo = await db.pedidos.find_one({"_id": resultado.inserted_id})
        return serialize(novo)


@router.put("/{pedido_id}")
async def atualizar_pedido(pedido_id: str, payload: PedidoIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    async with stock_lock(db):
        existente = await db.pedidos.find_one({"_id": _oid(pedido_id)})
        if not existente:
            raise HTTPException(status_code=404, detail="Pedido não encontrado.")
        itens = await _itens_com_atendimento(db, payload.itens)
        await _validar_status_estoque(
            db,
            itens=itens,
            status=payload.status,
            pedido_id=pedido_id,
            pedido_anterior=existente,
        )
        await _reverter_movimentos_do_pedido(db, pedido_id)
        await _aplicar_saida_estoque(db, pedido_id, itens, payload.status)
        atualizacao = payload.model_dump()
        atualizacao["itens"] = itens
        if payload.status != existente.get("status"):
            historico = existente.get("historicoStatus", [])
            historico.append({
                "status": payload.status,
                "data": datetime.now(timezone.utc).isoformat(),
            })
            atualizacao["historicoStatus"] = historico
        await db.pedidos.update_one(
            {"_id": _oid(pedido_id)},
            {"$set": atualizacao},
        )
        atualizado = await db.pedidos.find_one({"_id": _oid(pedido_id)})
        return serialize(atualizado)


@router.delete("/{pedido_id}")
async def apagar_pedido(pedido_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    async with stock_lock(db):
        await _reverter_movimentos_do_pedido(db, pedido_id)
        resultado = await db.pedidos.delete_one({"_id": _oid(pedido_id)})
        if resultado.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Pedido não encontrado.")
        return {"status": "Pedido apagado."}
