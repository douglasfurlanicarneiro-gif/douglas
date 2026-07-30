from datetime import datetime, timezone
import unicodedata

from fastapi import APIRouter, Depends

from database import get_db
from security import require_atelie_auth
from utils import serialize

router = APIRouter(prefix="/api/vitrine", tags=["vitrine"])

_PIPELINE_ESTOQUE = [
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


def _alphabetical_name(item: dict) -> str:
    name = str(item.get("nome", ""))
    try:
        repaired_name = name.encode("cp1252").decode("utf-8")
        if repaired_name.count("Ã") + repaired_name.count("Â") < name.count("Ã") + name.count("Â"):
            name = repaired_name
    except (UnicodeEncodeError, UnicodeDecodeError):
        pass
    return "".join(
        character
        for character in unicodedata.normalize("NFD", name)
        if unicodedata.category(character) != "Mn"
    ).casefold()


@router.get("")
async def obter_vitrine():
    db = get_db()
    snapshot = await db.vitrine.find_one({"_id": "snapshot"})
    if not snapshot:
        return {"atualizadoEm": None, "itens": []}

    estoque_map: dict[str, int] = {}
    async for linha in db.movimentos.aggregate(_PIPELINE_ESTOQUE):
        estoque_map[linha["_id"]] = linha["total"]

    itens = [dict(item) for item in snapshot.get("itens", [])]
    for item in itens:
        qtd = estoque_map.get(item.get("id"), 0)
        # Estoque baixo gera alerta interno, mas não bloqueia tamanhos na
        # vitrine. A disponibilidade comercial continua sob controle manual.
        item["disponivel"] = True
        item["prontaEntrega"] = bool(item.get("prontaEntrega", False))
        item["estoqueAtualMl"] = max(qtd, 0)
        item["statusEstoque"] = "sob_consulta" if qtd <= 0 else "envio_imediato"

    itens.sort(key=_alphabetical_name)
    return {"atualizadoEm": snapshot.get("atualizadoEm"), "itens": itens}


@router.post("/publish")
async def publicar_vitrine(_: str = Depends(require_atelie_auth)):
    db = get_db()

    perfumes = await db.perfumes.find({"publicavel": True}).to_list(2000)

    estoque_map: dict[str, int] = {}
    async for linha in db.movimentos.aggregate(_PIPELINE_ESTOQUE):
        estoque_map[linha["_id"]] = linha["total"]

    itens = []
    for p in perfumes:
        item = serialize(p)
        qtd = estoque_map.get(item["id"], 0)
        item["disponivel"] = True
        item["prontaEntrega"] = bool(item.get("prontaEntrega", False))
        item["estoqueAtualMl"] = max(qtd, 0)
        item["statusEstoque"] = "sob_consulta" if qtd <= 0 else "envio_imediato"
        itens.append(item)

    itens.sort(key=_alphabetical_name)
    atualizado_em = datetime.now(timezone.utc).isoformat()
    await db.vitrine.update_one(
        {"_id": "snapshot"},
        {"$set": {"atualizadoEm": atualizado_em, "itens": itens}},
        upsert=True,
    )
    return {"atualizadoEm": atualizado_em, "itensPublicados": len(itens)}
