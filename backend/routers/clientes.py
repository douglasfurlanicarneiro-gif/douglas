"""Cadastro do cliente (auditoria A5): sem login/senha para o cliente final —
é uma busca simples por telefone/whatsapp pra pré-preencher o formulário de
compra na próxima visita, exatamente como pedido no briefing.
"""
from fastapi import APIRouter, HTTPException

from database import get_db

router = APIRouter(prefix="/api/clientes", tags=["clientes"])


@router.get("/por-contato/{contato}")
async def buscar_cliente_por_contato(contato: str):
    db = get_db()
    cliente = await db.clientes.find_one({"contato": contato})
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    doc = dict(cliente)
    doc.pop("_id", None)
    return doc
