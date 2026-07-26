from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from database import get_db
from payments.service import iniciar_pagamento
from security import require_atelie_auth
from utils import serialize

router = APIRouter(prefix="/api/compras", tags=["compras"])


class EnderecoIn(BaseModel):
    cep: str = ""
    endereco: str = ""
    numero: str = ""
    complemento: str = ""
    bairro: str = ""
    cidade: str = ""
    estado: str = ""


class CompraIn(BaseModel):
    perfumeId: str
    perfumeNome: str
    ml: int
    preco: float
    cliente: str
    contato: str
    observacoes: str = ""
    # Cadastro completo (auditoria A5) — opcional na primeira compra pra não
    # travar quem só quer mandar uma mensagem rápida, mas é o que permite
    # NÃO pedir os dados de novo na próxima compra (ver /api/clientes).
    nomeCompleto: Optional[str] = None
    telefone: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[str] = None
    endereco: Optional[EnderecoIn] = None
    formaPagamento: Optional[str] = None  # 'pix' | 'cartao'


@router.get("")
async def listar_compras(_: str = Depends(require_atelie_auth)):
    db = get_db()
    compras = await db.compras.find().sort("data", -1).to_list(2000)
    return [serialize(c) for c in compras]


@router.post("")
async def criar_compra(payload: CompraIn):
    db = get_db()
    doc = payload.model_dump()
    doc["data"] = datetime.now(timezone.utc).isoformat()
    doc["status"] = "pendente"  # pipeline simples de atendimento no painel Mensagens

    # Salva/atualiza o cadastro do cliente por telefone/whatsapp, pra próxima
    # compra vir com os campos pré-preenchidos (o app consulta isso por
    # GET /api/clientes/por-contato/{contato} antes de abrir o formulário).
    identificador = payload.whatsapp or payload.telefone or payload.contato
    if payload.nomeCompleto and identificador:
        await db.clientes.update_one(
            {"contato": identificador},
            {"$set": {
                "contato": identificador,
                "nomeCompleto": payload.nomeCompleto,
                "telefone": payload.telefone,
                "whatsapp": payload.whatsapp,
                "email": payload.email,
                "endereco": payload.endereco.model_dump() if payload.endereco else None,
                "atualizadoEm": doc["data"],
            }},
            upsert=True,
        )

    resultado = await db.compras.insert_one(doc)

    if payload.formaPagamento:
        pagamento = await iniciar_pagamento(payload.formaPagamento, str(resultado.inserted_id), payload.preco)
        await db.compras.update_one({"_id": resultado.inserted_id}, {"$set": {"pagamento": pagamento}})

    nova = await db.compras.find_one({"_id": resultado.inserted_id})
    return serialize(nova)


class CompraStatusIn(BaseModel):
    status: str


@router.patch("/{compra_id}")
async def atualizar_status_compra(compra_id: str, payload: CompraStatusIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    try:
        oid = ObjectId(compra_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de compra inválido.")
    resultado = await db.compras.update_one({"_id": oid}, {"$set": {"status": payload.status}})
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pedido de compra não encontrado.")
    atualizada = await db.compras.find_one({"_id": oid})
    return serialize(atualizada)


@router.delete("/{compra_id}")
async def apagar_compra(compra_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    try:
        oid = ObjectId(compra_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de compra inválido.")
    resultado = await db.compras.delete_one({"_id": oid})
    if resultado.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Pedido de compra não encontrado.")
    return {"status": "Pedido de compra apagado."}
