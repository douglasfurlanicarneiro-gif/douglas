"""Acompanhamento público e seguro de pedidos."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from catalog_cache import invalidate_catalog_cache
from database import get_db
from locks import stock_lock
from rate_limit import tracking_rate_limit
from routers.pedidos import _reverter_movimentos_do_pedido
from utils import pagamento_publico

router = APIRouter(prefix="/api/acompanhamento", tags=["acompanhamento"])


def _validar_codigo(codigo: str):
    if len(codigo) < 8 or len(codigo) > 64:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")


def _resposta_publica(pedido: dict):
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
        "pagamento": pagamento_publico(pedido.get("pagamento")),
        "criadoEm": pedido.get("criadoEm", pedido.get("data")),
        "historicoStatus": pedido.get("historicoStatus", []),
    }


def pode_cancelar_pedido(pedido: dict) -> bool:
    """O cliente só pode cancelar antes da confirmação do pagamento."""
    return pedido.get("status", "pendente") == "pendente"


@router.get("/{codigo}", dependencies=[Depends(tracking_rate_limit)])
async def acompanhar_pedido(codigo: str):
    _validar_codigo(codigo)

    pedido = await get_db().pedidos.find_one({
        "codigoAcompanhamento": codigo,
        "acompanhamentoAtivo": {"$ne": False},
    })
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido não encontrado.")

    # Não expõe nome, contato, e-mail ou endereço. O código longo e aleatório
    # funciona como a credencial de consulta do cliente.
    return _resposta_publica(pedido)


@router.post("/{codigo}/cancelar", dependencies=[Depends(tracking_rate_limit)])
async def cancelar_pedido_cliente(codigo: str):
    _validar_codigo(codigo)

    db = get_db()
    async with stock_lock(db):
        pedido = await db.pedidos.find_one({
            "codigoAcompanhamento": codigo,
            "acompanhamentoAtivo": {"$ne": False},
        })
        if not pedido:
            raise HTTPException(status_code=404, detail="Pedido não encontrado.")

        if pedido.get("status") == "cancelado":
            return _resposta_publica(pedido)
        if not pode_cancelar_pedido(pedido):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Este pedido já está em atendimento e não pode mais ser cancelado "
                    "por aqui. Fale conosco pelo WhatsApp."
                ),
            )

        agora = datetime.now(timezone.utc)
        historico = list(pedido.get("historicoStatus", []))
        historico.append({"status": "cancelado", "data": agora})

        # Hoje pedidos pendentes apenas reservam estoque. A reversão também
        # protege pedidos antigos que, por alguma versão anterior, tenham
        # recebido uma baixa antes da hora.
        await _reverter_movimentos_do_pedido(db, str(pedido["_id"]))
        await db.pedidos.update_one(
            {"_id": pedido["_id"], "status": "pendente"},
            {"$set": {"status": "cancelado", "historicoStatus": historico}},
        )
        atualizado = await db.pedidos.find_one({"_id": pedido["_id"]})
        invalidate_catalog_cache()
        return _resposta_publica(atualizado)
