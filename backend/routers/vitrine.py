import asyncio
from datetime import datetime, timedelta, timezone
import logging
import time
import unicodedata

from fastapi import APIRouter, Depends, Response

from database import get_db
from locks import distributed_lock
from security import require_atelie_auth
from stock import mapa_reservado, mapa_saldo_fisico, tamanhos_disponiveis
from utils import serialize

router = APIRouter(prefix="/api/vitrine", tags=["vitrine"])

_PUBLICATION_STATE_ID = "vitrine_publicacao"
_PUBLICATION_LOCK_ID = "vitrine-publicacao"
_AUTO_PUBLICATION_DELAY_SECONDS = 5
_auto_publication_task: asyncio.Task | None = None
logger = logging.getLogger("atelie.vitrine")

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


async def _estado_publicacao(db) -> dict:
    existente = await db.configuracoes.find_one({"_id": _PUBLICATION_STATE_ID})
    if existente:
        return existente
    await db.configuracoes.update_one(
        {"_id": _PUBLICATION_STATE_ID},
        {"$setOnInsert": {"revisao": 0, "pendente": False}},
        upsert=True,
    )
    return await db.configuracoes.find_one({"_id": _PUBLICATION_STATE_ID}) or {
        "revisao": 0,
        "pendente": False,
    }


async def _publicar_automaticamente(db) -> None:
    try:
        await asyncio.sleep(_AUTO_PUBLICATION_DELAY_SECONDS)
        await garantir_vitrine_atualizada(db)
    except asyncio.CancelledError:
        return
    except Exception:
        # O marcador durável continua pendente. A próxima consulta pública ou
        # publicação manual tenta novamente, inclusive após reinício do Render.
        logger.exception("Falha na publicação automática da vitrine.")


def _agendar_publicacao(db) -> None:
    global _auto_publication_task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if _auto_publication_task and not _auto_publication_task.done():
        _auto_publication_task.cancel()
    _auto_publication_task = loop.create_task(_publicar_automaticamente(db))


async def marcar_vitrine_pendente(db) -> dict:
    """Registra uma alteração pública e agrupa edições feitas em sequência."""
    agora = datetime.now(timezone.utc)
    await db.configuracoes.update_one(
        {"_id": _PUBLICATION_STATE_ID},
        {
            "$inc": {"revisao": 1},
            "$set": {"pendente": True, "alteradaEm": agora},
            "$setOnInsert": {"publicadaEm": None},
        },
        upsert=True,
    )
    _agendar_publicacao(db)
    return await _estado_publicacao(db)


async def _publicar_snapshot_sem_trava(db, *, registrar_operacao: bool = True) -> dict:
    estado = await _estado_publicacao(db)
    revisao = int(estado.get("revisao", 0))
    perfumes = await db.perfumes.find({
        "publicavel": True,
        "arquivadoEm": None,
    }).to_list(2000)

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
    await db.configuracoes.update_one(
        {"_id": _PUBLICATION_STATE_ID, "revisao": revisao},
        {
            "$set": {
                "pendente": False,
                "revisaoPublicada": revisao,
                "publicadaEm": datetime.now(timezone.utc),
            }
        },
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


async def publicar_snapshot(db, *, registrar_operacao: bool = True) -> dict:
    async with distributed_lock(
        db,
        _PUBLICATION_LOCK_ID,
        wait_seconds=8,
        lease_seconds=90,
        busy_detail="A vitrine já está sendo atualizada. Aguarde alguns segundos.",
    ):
        return await _publicar_snapshot_sem_trava(
            db,
            registrar_operacao=registrar_operacao,
        )


async def garantir_vitrine_atualizada(db, *, forcar: bool = False) -> dict | None:
    estado = await _estado_publicacao(db)
    if not estado.get("pendente"):
        return None

    alterada_em = estado.get("alteradaEm")
    if (
        not forcar
        and isinstance(alterada_em, datetime)
        and datetime.now(timezone.utc) - alterada_em
        < timedelta(seconds=_AUTO_PUBLICATION_DELAY_SECONDS)
    ):
        return None

    async with distributed_lock(
        db,
        _PUBLICATION_LOCK_ID,
        wait_seconds=8,
        lease_seconds=90,
        busy_detail="A vitrine já está sendo atualizada. Aguarde alguns segundos.",
    ):
        # Outra instância pode ter concluído a publicação enquanto esta
        # aguardava a trava.
        estado_atual = await _estado_publicacao(db)
        if not estado_atual.get("pendente"):
            return None
        return await _publicar_snapshot_sem_trava(db)


@router.get("")
async def obter_vitrine(response: Response, atualizar: bool = False):
    inicio = time.perf_counter()
    db = get_db()
    # Estado da publicação, snapshot e saldos são independentes na leitura
    # comum. Executá-los em paralelo elimina viagens sequenciais ao MongoDB,
    # que eram o maior custo na primeira abertura da vitrine.
    publicacao, snapshot, estoque_map, reservado_map = await asyncio.gather(
        garantir_vitrine_atualizada(db, forcar=atualizar),
        db.vitrine.find_one({"_id": "snapshot"}),
        mapa_saldo_fisico(db),
        mapa_reservado(db),
    )
    if publicacao:
        # A publicação pode ter substituído o snapshot lido em paralelo.
        snapshot = await db.vitrine.find_one({"_id": "snapshot"})
    if not snapshot:
        await publicar_snapshot(db, registrar_operacao=False)
        snapshot = await db.vitrine.find_one({"_id": "snapshot"})
        if not snapshot:
            return {"atualizadoEm": None, "itens": []}

    itens = [_item_publico(dict(item)) for item in snapshot.get("itens", [])]
    for item in itens:
        qtd = estoque_map.get(item.get("id"), 0)
        _aplicar_disponibilidade(
            item,
            saldo_fisico_ml=qtd,
            saldo_reservado_ml=reservado_map.get(item.get("id"), 0),
        )

    itens.sort(key=_alphabetical_name)
    duracao_ms = (time.perf_counter() - inicio) * 1_000
    response.headers["Server-Timing"] = f'catalog;dur={duracao_ms:.1f}'
    response.headers["Cache-Control"] = (
        "no-store"
        if atualizar
        else "public, max-age=2, s-maxage=2, must-revalidate"
    )
    if snapshot.get("atualizadoEm"):
        response.headers["X-Catalog-Updated-At"] = str(snapshot["atualizadoEm"])
    return {"atualizadoEm": snapshot.get("atualizadoEm"), "itens": itens}


@router.post("/publish")
async def publicar_vitrine(_: str = Depends(require_atelie_auth)):
    db = get_db()
    return await publicar_snapshot(db)
