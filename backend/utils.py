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
    # Bancos importados ou restaurados podem ter o contador atras do maior
    # numero ja existente. Sincronizar antes do incremento evita reutilizar
    # numeros antigos em novos registros.
    colecao = getattr(db, nome, None)
    if colecao is not None:
        maiores = await colecao.find(
            {"seq": {"$type": "number"}},
            {"seq": 1},
        ).sort("seq", -1).to_list(1)
        maior_existente = int(maiores[0].get("seq", 0)) if maiores else 0
        await db.counters.update_one(
            {"_id": nome},
            {"$max": {"seq": maior_existente}},
            upsert=True,
        )

    doc = await db.counters.find_one_and_update(
        {"_id": nome},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return doc["seq"]


def planejar_reparo_sequencias(documentos: list[dict]) -> tuple[list[tuple[object, int]], int]:
    """Mantem o registro mais antigo e renumera somente duplicados/invalidos."""
    ordenados = sorted(documentos, key=lambda item: str(item.get("_id", "")))
    sequencias_validas = [
        int(item["seq"])
        for item in ordenados
        if isinstance(item.get("seq"), int) and int(item["seq"]) > 0
    ]
    proximo = max(sequencias_validas, default=0)
    usados: set[int] = set()
    reparos: list[tuple[object, int]] = []

    for item in ordenados:
        seq = item.get("seq")
        if isinstance(seq, int) and seq > 0 and seq not in usados:
            usados.add(seq)
            continue
        proximo += 1
        usados.add(proximo)
        reparos.append((item["_id"], proximo))

    return reparos, proximo


async def reparar_sequencias(db: AsyncIOMotorDatabase, nome: str) -> int:
    """Corrige sequencias duplicadas sem renumerar o catalogo inteiro."""
    colecao = getattr(db, nome)
    documentos = await colecao.find({}, {"_id": 1, "seq": 1}).to_list(100_000)
    reparos, maior_seq = planejar_reparo_sequencias(documentos)
    for documento_id, nova_seq in reparos:
        await colecao.update_one(
            {"_id": documento_id},
            {"$set": {"seq": nova_seq}},
        )
    await db.counters.update_one(
        {"_id": nome},
        {"$max": {"seq": maior_seq}},
        upsert=True,
    )
    return len(reparos)
