"""Acompanhamento público e seguro de pedidos."""
from fastapi import APIRouter, HTTPException

from database import get_db

router = APIRouter(prefix="/api/acompanhamento", tags=["acompanhamento"])


@router.get("/{codigo}")
async def acompanhar_pedido(codigo: str):
    if len(codigo) < 8 or len(codigo) > 64:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")

    pedido = await get_db().pedidos.find_one({"codigoAcompanhamento": codigo})
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")

    # Não expõe nome, contato, e-mail ou endereço. O código longo e aleatório
    # funciona como a credencial de consulta do cliente.
    return {
        "id": str(pedido["_id"]),
        "seq": pedido.get("seq"),
        "codigoAcompanhamento": pedido.get("codigoAcompanhamento"),
        "status": pedido.get("status", "pendente"),
        "itens": pedido.get("itens", []),
        "subtotal": pedido.get("subtotal", pedido.get("total", 0)),
        "frete": pedido.get("frete", 0),
        "entrega": pedido.get("entrega"),
        "total": pedido.get("total", 0),
        "formaPagamento": pedido.get("formaPagamento"),
        "pagamento": pedido.get("pagamento"),
        "criadoEm": pedido.get("criadoEm", pedido.get("data")),
        "historicoStatus": pedido.get("historicoStatus", []),
    }
