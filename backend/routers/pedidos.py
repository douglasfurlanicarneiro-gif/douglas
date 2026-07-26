from datetime import datetime, timezone
from typing import List

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_db
from security import require_atelie_auth
from utils import next_seq, serialize

router = APIRouter(prefix="/api/pedidos", tags=["pedidos"])


class ItemPedido(BaseModel):
    perfumeId: str
    ml: int
    quantidade: int


class PedidoIn(BaseModel):
    cliente: str
    contato: str = ""
    status: str = "pendente"
    observacoes: str = ""
    itens: List[ItemPedido]
    total: float = 0


def _oid(pedido_id: str) -> ObjectId:
    try:
        return ObjectId(pedido_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de pedido inválido.")


async def _reverter_movimentos_do_pedido(db, pedido_id: str):
    await db.movimentos.delete_many({"origem": f"pedido:{pedido_id}"})


async def _aplicar_saida_estoque(db, pedido_id: str, itens: List[ItemPedido], status: str):
    # Regra de negócio (PRD): pedidos com status != cancelado geram saída de
    # estoque automática. Editar/excluir sempre estorna antes de reaplicar,
    # pra nunca deixar saldo de estoque "fantasma".
    if status == "cancelado":
        return
    agora = datetime.now(timezone.utc).isoformat()
    for item in itens:
        await db.movimentos.insert_one({
            "perfumeId": item.perfumeId,
            "tipo": "saida",
            "quantidadeMl": item.ml * item.quantidade,
            "motivo": "Saída automática por pedido",
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
    doc = payload.model_dump()
    doc["seq"] = await next_seq(db, "pedidos")
    doc["criadoEm"] = datetime.now(timezone.utc).isoformat()
    resultado = await db.pedidos.insert_one(doc)
    pedido_id = str(resultado.inserted_id)
    await _aplicar_saida_estoque(db, pedido_id, payload.itens, payload.status)
    novo = await db.pedidos.find_one({"_id": resultado.inserted_id})
    return serialize(novo)


@router.put("/{pedido_id}")
async def atualizar_pedido(pedido_id: str, payload: PedidoIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    existente = await db.pedidos.find_one({"_id": _oid(pedido_id)})
    if not existente:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")
    await _reverter_movimentos_do_pedido(db, pedido_id)
    await _aplicar_saida_estoque(db, pedido_id, payload.itens, payload.status)
    await db.pedidos.update_one({"_id": _oid(pedido_id)}, {"$set": payload.model_dump()})
    atualizado = await db.pedidos.find_one({"_id": _oid(pedido_id)})
    return serialize(atualizado)


@router.delete("/{pedido_id}")
async def apagar_pedido(pedido_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    await _reverter_movimentos_do_pedido(db, pedido_id)
    resultado = await db.pedidos.delete_one({"_id": _oid(pedido_id)})
    if resultado.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")
    return {"status": "Pedido apagado."}
