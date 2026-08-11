import re
import unicodedata
from datetime import datetime, timezone

INITIAL_READY_DELIVERY_NAMES = [
    "Armani Code Profumo Giorgio Armani Masculino",
    "Invictus Rabanne Masculino",
    "212 VIP Black Carolina Herrera Masculino",
    "Olympea Legend Rabanne Feminino",
    "J'adore Dior Feminino",
    "Althaïr Parfums de Marly Masculino",
    "Prada Paradoxe Radical Essence Prada Feminino",
    "Boss Bottled Hugo Boss Masculino",
    "Atheeri Lattafa Perfumes Feminino",
    "Fame Rabanne Feminino",
    "Good Girl Blush Carolina Herrera Feminino",
    "Vanilla | 28 Kayali Fragrances Compartilhável",
    "Erba Pura Xerjoff Compartilhável",
    "The Most Wanted Azzaro Masculino",
    "Emporio Armani Stronger With You Giorgio Armani Masculino",
    "Vibrato Sospiro Perfumes - Compartilhável",
    "Burberry Her Feminino",
    "Baccarat Rouge 540 – Maison Francis Kurkdjian",
    "Scandal By Night Jean Paul Gaultier Feminino",
    "Pegasus Parfums de Marly Masculino",
    "Tobacco Vanille Tom Ford Compartilhável",
    "Oud Wood Tom Ford Compartilhável",
]

_MIGRATION_ID = "pronta_entrega_inicial"
_MIGRATION_VERSION = 2
_QUALIFIERS = {"masculino", "feminino", "compartilhavel"}
_STOCK_PIPELINE = [
    {
        "$group": {
            "_id": "$perfumeId",
            "total": {
                "$sum": {
                    "$cond": [
                        {"$eq": ["$tipo", "entrada"]},
                        "$quantidadeMl",
                        {"$multiply": ["$quantidadeMl", -1]},
                    ]
                }
            },
        }
    },
]


def name_signature(name: str) -> str:
    without_accents = "".join(
        character
        for character in unicodedata.normalize("NFD", str(name or ""))
        if unicodedata.category(character) != "Mn"
    )
    tokens = [
        token
        for token in re.findall(r"[a-z0-9]+", without_accents.casefold())
        if token not in _QUALIFIERS
    ]
    return " ".join(sorted(tokens))


async def apply_ready_delivery(db, names: list[str]) -> dict:
    perfumes = await db.perfumes.find({"arquivadoEm": None}).to_list(5000)
    by_signature: dict[str, list[dict]] = {}
    for perfume in perfumes:
        by_signature.setdefault(name_signature(perfume.get("nome", "")), []).append(perfume)

    matched: list[dict] = []
    missing: list[str] = []
    ambiguous: list[str] = []
    matched_ids: set[object] = set()

    unique_names = list(dict.fromkeys(name.strip() for name in names if name.strip()))
    for name in unique_names:
        candidates = by_signature.get(name_signature(name), [])
        if len(candidates) == 1:
            perfume = candidates[0]
            if perfume["_id"] not in matched_ids:
                matched.append(perfume)
                matched_ids.add(perfume["_id"])
        elif len(candidates) > 1:
            ambiguous.append(name)
        else:
            missing.append(name)

    await db.perfumes.update_many(
        {"arquivadoEm": None}, {"$set": {"prontaEntrega": False}}
    )
    if matched_ids:
        await db.perfumes.update_many(
            {"_id": {"$in": list(matched_ids)}},
            {"$set": {"prontaEntrega": True}},
        )

    snapshot = await db.vitrine.find_one({"_id": "snapshot"})
    if snapshot:
        text_ids = {str(perfume_id) for perfume_id in matched_ids}
        items = [
            {
                **item,
                "prontaEntrega": str(item.get("id", "")) in text_ids,
            }
            for item in snapshot.get("itens", [])
        ]
        await db.vitrine.update_one(
            {"_id": "snapshot"},
            {"$set": {"itens": items}},
        )

    return {
        "prontaEntrega": len(matched),
        "sobEncomenda": max(0, len(perfumes) - len(matched)),
        "encontrados": [perfume.get("nome", "") for perfume in matched],
        "naoEncontrados": missing,
        "ambiguos": ambiguous,
    }


async def apply_ready_delivery_by_ids(db, ids: list[str]) -> dict:
    """Atualiza a disponibilidade por ids exatos, sem depender do nome."""
    perfumes = await db.perfumes.find(
        {"arquivadoEm": None}, {"_id": 1}
    ).to_list(5000)
    perfumes_por_id = {str(perfume["_id"]): perfume["_id"] for perfume in perfumes}
    ids_unicos = list(dict.fromkeys(str(item).strip() for item in ids if str(item).strip()))
    encontrados = [item_id for item_id in ids_unicos if item_id in perfumes_por_id]
    nao_encontrados = [item_id for item_id in ids_unicos if item_id not in perfumes_por_id]
    object_ids = [perfumes_por_id[item_id] for item_id in encontrados]

    await db.perfumes.update_many(
        {"arquivadoEm": None}, {"$set": {"prontaEntrega": False}}
    )
    if object_ids:
        await db.perfumes.update_many(
            {"_id": {"$in": object_ids}},
            {"$set": {"prontaEntrega": True}},
        )

    snapshot = await db.vitrine.find_one({"_id": "snapshot"})
    if snapshot:
        ids_encontrados = set(encontrados)
        items = [
            {
                **item,
                "prontaEntrega": str(item.get("id", "")) in ids_encontrados,
            }
            for item in snapshot.get("itens", [])
        ]
        await db.vitrine.update_one(
            {"_id": "snapshot"},
            {"$set": {"itens": items}},
        )

    return {
        "prontaEntrega": len(encontrados),
        "sobEncomenda": max(0, len(perfumes) - len(encontrados)),
        "encontrados": encontrados,
        "naoEncontrados": nao_encontrados,
    }


async def zero_made_to_order_stock(db) -> dict:
    perfumes = await db.perfumes.find(
        {"prontaEntrega": {"$ne": True}, "arquivadoEm": None},
        {"_id": 1},
    ).to_list(5000)
    perfume_ids = {str(perfume["_id"]) for perfume in perfumes}

    movimentos = []
    quantidade_zerada_ml = 0
    agora = datetime.now(timezone.utc)
    async for linha in await db.movimentos.aggregate(_STOCK_PIPELINE):
        perfume_id = str(linha.get("_id", ""))
        saldo_atual = int(linha.get("total", 0))
        if perfume_id not in perfume_ids or saldo_atual <= 0:
            continue
        movimentos.append({
            "perfumeId": perfume_id,
            "tipo": "saida",
            "quantidadeMl": saldo_atual,
            "motivo": "Ajuste de estoque para Sob encomenda",
            "categoria": "ajuste-negativo",
            "origem": "ajuste-sob-encomenda-v2",
            "data": agora,
        })
        quantidade_zerada_ml += saldo_atual

    if movimentos:
        await db.movimentos.insert_many(movimentos)

    return {
        "estoquesZerados": len(movimentos),
        "quantidadeZeradaMl": quantidade_zerada_ml,
    }


async def ensure_initial_ready_delivery(db) -> dict:
    control = await db.configuracoes.find_one({"_id": _MIGRATION_ID})
    if control and control.get("versao", 0) >= _MIGRATION_VERSION:
        return {
            "jaEstavaAtualizado": True,
            "prontaEntrega": int(control.get("prontaEntrega", 0)),
            "naoEncontrados": control.get("naoEncontrados", []),
            "ambiguos": control.get("ambiguos", []),
        }

    result = await apply_ready_delivery(db, INITIAL_READY_DELIVERY_NAMES)
    stock_result = await zero_made_to_order_stock(db)
    await db.configuracoes.update_one(
        {"_id": _MIGRATION_ID},
        {
            "$set": {
                "versao": _MIGRATION_VERSION,
                "prontaEntrega": result["prontaEntrega"],
                "naoEncontrados": result["naoEncontrados"],
                "ambiguos": result["ambiguos"],
                "estoquesZerados": stock_result["estoquesZerados"],
                "quantidadeZeradaMl": stock_result["quantidadeZeradaMl"],
            }
        },
        upsert=True,
    )
    return {**result, **stock_result, "jaEstavaAtualizado": False}
