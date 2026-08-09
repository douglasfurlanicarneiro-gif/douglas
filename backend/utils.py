"""Helpers pequenos e reaproveitados por várias rotas."""
from motor.motor_asyncio import AsyncIOMotorDatabase
from pymongo import ReturnDocument


def serialize(doc: dict | None) -> dict | None:
    """Converte um documento do Mongo para o formato que o app espera:
    `_id` (ObjectId) vira `id` (string). Nunca devolvemos ObjectId cru pro front.
    """
    if not doc:
        return doc
    limpo = dict(doc)
    if "_id" in limpo:
        limpo["id"] = str(limpo.pop("_id"))
    return limpo


def pagamento_publico(pagamento: dict | None) -> dict | None:
    """Remove identificadores internos ao expor um pagamento ao cliente.

    O checkout e o codigo Pix precisam continuar disponiveis enquanto o pedido
    aguarda pagamento. NSU, slug, IDs de cobranca e referencias administrativas
    ficam restritos ao painel autenticado.
    """
    if not pagamento:
        return pagamento
    campos_permitidos = (
        "metodo",
        "provedor",
        "status",
        "valor",
        "checkoutUrl",
        "pixCopiaECola",
        "recebedor",
        "instituicao",
        "captureMethod",
        "parcelas",
        "pagoEm",
        "observacao",
    )
    return {
        campo: pagamento.get(campo)
        for campo in campos_permitidos
        if campo in pagamento
    }


async def next_seq(db: AsyncIOMotorDatabase, nome: str) -> int:
    """Contador atômico por coleção (usado para os números sequenciais
    "Nº 007" exibidos no catálogo e nos pedidos)."""
    doc = await db.counters.find_one_and_update(
        {"_id": nome},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return doc["seq"]
