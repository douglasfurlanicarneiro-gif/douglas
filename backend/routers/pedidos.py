from datetime import datetime, timezone
from typing import List, Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from database import get_db
from security import require_atelie_auth
from utils import next_seq, serialize

router = APIRouter(prefix="/api/pedidos", tags=["pedidos"])


class ItemPedido(BaseModel):
    perfumeId: str
    ml: int = Field(gt=0, le=1000)
    quantidade: int = Field(gt=0, le=100)


class PedidoIn(BaseModel):
    cliente: str = Field(min_length=2, max_length=120)
    contato: str = Field(default="", max_length=160)
    status: Literal["pendente", "preparando", "enviado", "entregue", "cancelado"] = "pendente"
    observacoes: str = Field(default="", max_length=1000)
    itens: List[ItemPedido] = Field(min_length=1, max_length=100)
    total: float = Field(default=0, ge=0)


def _oid(pedido_id: str) -> ObjectId:
    try:
        return ObjectId(pedido_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de pedido inválido.")


async def _reverter_movimentos_do_pedido(db, pedido_id: str):
    await db.movimentos.delete_many({"origem": f"pedido:{pedido_id}"})


async def _validar_estoque(db, itens: List[ItemPedido], ignorar_pedido_id: str | None = None):
    filtro = {}
    if ignorar_pedido_id:
        filtro["origem"] = {"$ne": f"pedido:{ignorar_pedido_id}"}
    pipeline = []
    if filtro:
        pipeline.append({"$match": filtro})
    pipeline.append({
        "$group": {
            "_id": "$perfumeId",
            "total": {"$sum": {"$cond": [
                {"$eq": ["$tipo", "entrada"]},
                "$quantidadeMl",
                {"$multiply": ["$quantidadeMl", -1]},
            ]}},
        },
    })
    estoque = {}
    async for linha in db.movimentos.aggregate(pipeline):
        estoque[linha["_id"]] = linha["total"]
    consumo = {}
    for item in itens:
        consumo[item.perfumeId] = consumo.get(item.perfumeId, 0) + item.ml * item.quantidade
    insuficientes = [perfume_id for perfume_id, ml in consumo.items() if estoque.get(perfume_id, 0) < ml]
    if insuficientes:
        raise HTTPException(status_code=409, detail="Estoque insuficiente para concluir o pedido.")


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
    if payload.status != "cancelado":
        await _validar_estoque(db, payload.itens)
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
    if payload.status != "cancelado":
        await _validar_estoque(db, payload.itens, ignorar_pedido_id=pedido_id)
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
