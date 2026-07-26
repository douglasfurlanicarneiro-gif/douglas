"""Consulta administrativa de cadastros de clientes.

Dados pessoais nunca devem ser retornados apenas com o conhecimento de um
número de telefone. O cliente final recupera pedidos pelo código aleatório de
acompanhamento, que não expõe nome, contato, e-mail ou endereço.
"""
from fastapi import APIRouter, Depends, HTTPException

from database import get_db
from security import require_atelie_auth

router = APIRouter(prefix="/api/clientes", tags=["clientes"])


@router.get("/por-contato/{contato}")
async def buscar_cliente_por_contato(
    contato: str,
    _: str = Depends(require_atelie_auth),
):
    db = get_db()
    cliente = await db.clientes.find_one({"contato": contato})
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    doc = dict(cliente)
    doc.pop("_id", None)
    return doc
