from datetime import datetime, timezone
import unicodedata

from fastapi import APIRouter, Depends

from database import get_db
from security import require_atelie_auth
from stock import mapa_reservado, mapa_saldo_fisico, tamanhos_disponiveis
from utils import serialize

router = APIRouter(prefix="/api/vitrine", tags=["vitrine"])

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


_ADMIN_ONLY_FIELDS = {
    "estoqueAtualMl",
    "estoqueMinimoMl",
    "custoEssenciaPorMl",
    "concentracaoPercentual",
    "fornecedorId",
    "fornecedorCodigo",
}


def _item_publico(item: dict) -> dict:
    """Remove estoque exato, custos e referências internas do payload público."""
    return {chave: valor for chave, valor in item.items() if chave not in _ADMIN_ONLY_FIELDS}


def _aplicar_disponibilidade(
    item: dict,
    *,
    saldo_fisico_ml: int,
    saldo_reservado_ml: int,
) -> None:
    pronta_entrega = bool(item.get("prontaEntrega", False))
    saldo_livre_ml = saldo_fisico_ml - saldo_reservado_ml
    tamanhos = tamanhos_disponiveis(item, saldo_livre_ml)

    item["prontaEntrega"] = pronta_entrega
    item["tamanhosDisponiveisMl"] = tamanhos
    if pronta_entrega:
        item["disponivel"] = bool(tamanhos)
        item["statusEstoque"] = "envio_imediato" if tamanhos else "indisponivel"
    else:
        item["disponivel"] = True
        item["statusEstoque"] = "sob_encomenda"


async def publicar_snapshot(db, *, registrar_operacao: bool = True) -> dict:
    perfumes = await db.perfumes.find({"publicavel": True}).to_list(2000)

    estoque_map = await mapa_saldo_fisico(db)
    reservado_map = await mapa_reservado(db)

    itens = []
    for perfume in perfumes:
        item = _item_publico(serialize(perfume))
        qtd = estoque_map.get(item["id"], 0)
        _aplicar_disponibilidade(
            item,
            saldo_fisico_ml=qtd,
            saldo_reservado_ml=reservado_map.get(item["id"], 0),
        )
        itens.append(item)

    itens.sort(key=_alphabetical_name)
    atualizado_em = datetime.now(timezone.utc).isoformat()
    await db.vitrine.update_one(
        {"_id": "snapshot"},
        {"$set": {"atualizadoEm": atualizado_em, "itens": itens}},
        upsert=True,
    )
    if registrar_operacao:
        await db.operacoes_sistema.insert_one({
            "tipo": "publicar_vitrine",
            "titulo": "Vitrine publicada",
            "detalhes": f"{len(itens)} perfume(s) publicados em ordem alfabética.",
            "perfumesAfetados": len(itens),
            "quantidadeMl": 0,
            "data": atualizado_em,
        })
    return {"atualizadoEm": atualizado_em, "itensPublicados": len(itens)}


@router.get("")
async def obter_vitrine():
    db = get_db()
    snapshot = await db.vitrine.find_one({"_id": "snapshot"})
    if not snapshot:
        return {"atualizadoEm": None, "itens": []}

    estoque_map = await mapa_saldo_fisico(db)
    reservado_map = await mapa_reservado(db)

    itens = [_item_publico(dict(item)) for item in snapshot.get("itens", [])]
    for item in itens:
        qtd = estoque_map.get(item.get("id"), 0)
        _aplicar_disponibilidade(
            item,
            saldo_fisico_ml=qtd,
            saldo_reservado_ml=reservado_map.get(item.get("id"), 0),
        )

    itens.sort(key=_alphabetical_name)
    return {"atualizadoEm": snapshot.get("atualizadoEm"), "itens": itens}


@router.post("/publish")
async def publicar_vitrine(_: str = Depends(require_atelie_auth)):
    db = get_db()
    return await publicar_snapshot(db)
