from datetime import datetime, timezone

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


@router.get("")
async def obter_vitrine():
    db = get_db()
    snapshot = await db.vitrine.find_one({"_id": "snapshot"})
    if not snapshot:
        return {"atualizadoEm": None, "itens": []}

    # 'disponivel' é recalculado a cada leitura a partir do estoque atual —
    # NUNCA usar o valor congelado de quando a vitrine foi publicada, senão um
    # perfume que ficou sem estoque depois da publicação continua aparecendo
    # como disponível até o dono publicar de novo (bug já corrigido antes,
    # coberto por tests/test_vitrine_disponivel_dynamic.py).
    estoque_map: dict[str, int] = {}
    async for linha in db.movimentos.aggregate(_PIPELINE_ESTOQUE):
        estoque_map[linha["_id"]] = linha["total"]

    itens = snapshot.get("itens", [])
    for item in itens:
        item["disponivel"] = estoque_map.get(item.get("id"), 0) > 0

    return {"atualizadoEm": snapshot.get("atualizadoEm"), "itens": itens}


@router.post("/publish")
async def publicar_vitrine(_: str = Depends(require_atelie_auth)):
    db = get_db()

    # Só publica quem o Ateliê marcou explicitamente como publicável
    # (ver auditoria A6 sobre itens importados em massa).
    perfumes = await db.perfumes.find({"publicavel": True}).sort("seq", 1).to_list(2000)

    estoque_map: dict[str, int] = {}
    async for linha in db.movimentos.aggregate(_PIPELINE_ESTOQUE):
        estoque_map[linha["_id"]] = linha["total"]

    itens = []
    for p in perfumes:
        item = serialize(p)
        item["disponivel"] = estoque_map.get(item["id"], 0) > 0
        itens.append(item)

    atualizado_em = datetime.now(timezone.utc).isoformat()
    await db.vitrine.update_one(
        {"_id": "snapshot"},
        {"$set": {"atualizadoEm": atualizado_em, "itens": itens}},
        upsert=True,
    )
    return {"atualizadoEm": atualizado_em, "itensPublicados": len(itens)}
