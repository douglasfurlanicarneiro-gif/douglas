import re
import unicodedata

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
_MIGRATION_VERSION = 1
_QUALIFIERS = {"masculino", "feminino", "compartilhavel"}


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
    perfumes = await db.perfumes.find().to_list(5000)
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

    await db.perfumes.update_many({}, {"$set": {"prontaEntrega": False}})
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
    await db.configuracoes.update_one(
        {"_id": _MIGRATION_ID},
        {
            "$set": {
                "versao": _MIGRATION_VERSION,
                "prontaEntrega": result["prontaEntrega"],
                "naoEncontrados": result["naoEncontrados"],
                "ambiguos": result["ambiguos"],
            }
        },
        upsert=True,
    )
    return {**result, "jaEstavaAtualizado": False}
