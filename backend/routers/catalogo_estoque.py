"""Operações em massa de catálogo e estoque disponíveis no painel Sistema."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from availability import apply_ready_delivery_by_ids
from database import get_db
from locks import stock_lock
from routers.vitrine import marcar_vitrine_pendente
from security import require_atelie_auth
from utils import serialize

router = APIRouter(
    prefix="/api/admin/catalogo-estoque",
    tags=["catalogo-estoque"],
)

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


class CompletarProntaEntregaIn(BaseModel):
    quantidadeMl: int = Field(default=1000, gt=0, le=1_000_000)


class DisponibilidadeIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=5000)


async def _estoque_atual(db) -> dict[str, int]:
    estoque: dict[str, int] = {}
    async for linha in await db.movimentos.aggregate(_STOCK_PIPELINE):
        estoque[str(linha["_id"])] = int(linha.get("total", 0))
    return estoque


async def _registrar_operacao(
    db,
    *,
    tipo: str,
    titulo: str,
    detalhes: str,
    perfumes_afetados: int,
    quantidade_ml: int,
) -> dict:
    doc = {
        "tipo": tipo,
        "titulo": titulo,
        "detalhes": detalhes,
        "perfumesAfetados": perfumes_afetados,
        "quantidadeMl": quantidade_ml,
        "data": datetime.now(timezone.utc).isoformat(),
    }
    await db.operacoes_sistema.insert_one(doc)
    return serialize(doc)


def _movimentos_para_zerar(
    ids: set[str],
    estoque: dict[str, int],
    data: str,
) -> list[dict]:
    return [
        {
            "perfumeId": perfume_id,
            "tipo": "saida",
            "quantidadeMl": estoque[perfume_id],
            "motivo": "Zerado pelo Sistema: item Sob encomenda",
            "categoria": "ajuste-negativo",
            "origem": "sistema:zerar-sob-encomenda",
            "data": data,
        }
        for perfume_id in ids
        if estoque.get(perfume_id, 0) > 0
    ]


def _movimentos_para_completar(
    ids: set[str],
    estoque: dict[str, int],
    alvo_ml: int,
    data: str,
) -> list[dict]:
    movimentos = []
    for perfume_id in ids:
        quantidade = alvo_ml - estoque.get(perfume_id, 0)
        if quantidade <= 0:
            continue
        movimentos.append({
            "perfumeId": perfume_id,
            "tipo": "entrada",
            "quantidadeMl": quantidade,
            "motivo": f"Completado pelo Sistema até {alvo_ml}ml",
            "categoria": "ajuste-positivo",
            "origem": "sistema:completar-pronta-entrega",
            "data": data,
        })
    return movimentos


@router.get("/resumo")
async def obter_resumo(_: str = Depends(require_atelie_auth)):
    db = get_db()
    perfumes = await db.perfumes.find(
        {"arquivadoEm": None},
        {"_id": 1, "prontaEntrega": 1},
    ).to_list(5000)
    estoque = await _estoque_atual(db)

    pronta_ids = {
        str(perfume["_id"])
        for perfume in perfumes
        if perfume.get("prontaEntrega") is True
    }
    sob_ids = {str(perfume["_id"]) for perfume in perfumes} - pronta_ids
    historico = await db.operacoes_sistema.find().sort("data", -1).to_list(20)
    return {
        "totalPerfumes": len(perfumes),
        "prontaEntrega": len(pronta_ids),
        "sobEncomenda": len(sob_ids),
        "estoqueProntaEntregaMl": sum(max(0, estoque.get(item_id, 0)) for item_id in pronta_ids),
        "estoqueSobEncomendaMl": sum(max(0, estoque.get(item_id, 0)) for item_id in sob_ids),
        "sobEncomendaComSaldo": sum(1 for item_id in sob_ids if estoque.get(item_id, 0) > 0),
        "historico": [serialize(item) for item in historico],
    }


@router.put("/disponibilidade")
async def atualizar_disponibilidade(
    payload: DisponibilidadeIn,
    _: str = Depends(require_atelie_auth),
):
    db = get_db()
    async with stock_lock(db):
        result = await apply_ready_delivery_by_ids(db, payload.ids)
        await _registrar_operacao(
            db,
            tipo="atualizar_disponibilidade",
            titulo="Disponibilidade do catálogo atualizada",
            detalhes=(
                f"{result['prontaEntrega']} perfume(s) em pronta entrega e "
                f"{result['sobEncomenda']} sob encomenda."
            ),
            perfumes_afetados=result["prontaEntrega"] + result["sobEncomenda"],
            quantidade_ml=0,
        )
        await marcar_vitrine_pendente(db)
    return result


@router.post("/zerar-sob-encomenda")
async def zerar_sob_encomenda(_: str = Depends(require_atelie_auth)):
    db = get_db()
    async with stock_lock(db):
        perfumes = await db.perfumes.find(
            {"prontaEntrega": {"$ne": True}, "arquivadoEm": None},
            {"_id": 1},
        ).to_list(5000)
        ids = {str(perfume["_id"]) for perfume in perfumes}
        estoque = await _estoque_atual(db)
        agora = datetime.now(timezone.utc).isoformat()
        movimentos = _movimentos_para_zerar(ids, estoque, agora)
        if movimentos:
            await db.movimentos.insert_many(movimentos)
        quantidade_ml = sum(item["quantidadeMl"] for item in movimentos)
        await _registrar_operacao(
            db,
            tipo="zerar_sob_encomenda",
            titulo="Estoque sob encomenda zerado",
            detalhes=f"{len(movimentos)} perfume(s) tiveram o saldo ajustado para zero.",
            perfumes_afetados=len(movimentos),
            quantidade_ml=quantidade_ml,
        )
    return {
        "perfumesConsiderados": len(ids),
        "perfumesAtualizados": len(movimentos),
        "quantidadeRetiradaMl": quantidade_ml,
    }


@router.post("/completar-pronta-entrega")
async def completar_pronta_entrega(
    payload: CompletarProntaEntregaIn,
    _: str = Depends(require_atelie_auth),
):
    db = get_db()
    async with stock_lock(db):
        perfumes = await db.perfumes.find(
            {"prontaEntrega": True, "arquivadoEm": None},
            {"_id": 1},
        ).to_list(5000)
        ids = {str(perfume["_id"]) for perfume in perfumes}
        estoque = await _estoque_atual(db)
        agora = datetime.now(timezone.utc).isoformat()
        movimentos = _movimentos_para_completar(
            ids,
            estoque,
            payload.quantidadeMl,
            agora,
        )
        if movimentos:
            await db.movimentos.insert_many(movimentos)
        quantidade_ml = sum(item["quantidadeMl"] for item in movimentos)
        await _registrar_operacao(
            db,
            tipo="completar_pronta_entrega",
            titulo="Estoque de pronta entrega atualizado",
            detalhes=(
                f"{len(movimentos)} perfume(s) foram completados até "
                f"{payload.quantidadeMl}ml."
            ),
            perfumes_afetados=len(movimentos),
            quantidade_ml=quantidade_ml,
        )
    return {
        "perfumesConsiderados": len(perfumes),
        "perfumesAtualizados": len(movimentos),
        "quantidadeAdicionadaMl": quantidade_ml,
        "estoqueAlvoMl": payload.quantidadeMl,
    }
