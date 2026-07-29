"""Recursos operacionais do painel: métricas e backup."""
import asyncio
import json
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from database import get_db
from locks import stock_lock
from security import require_atelie_auth

router = APIRouter(prefix="/api/admin", tags=["admin"])
PEDIDOS_RESET_ID = "pedidos-reset"
PEDIDOS_RESET_VERSAO_INICIAL = 2


class ConfiguracoesLojaIn(BaseModel):
    nomeLoja: str = Field(default="L’Essence Furlani", max_length=120)
    logoUrl: str = Field(default="", max_length=2000)
    whatsapp: str = Field(default="", max_length=40)
    instagram: str = Field(default="", max_length=120)
    email: str = Field(default="", max_length=160)
    pix: str = Field(default="", max_length=160)
    cnpj: str = Field(default="", max_length=30)
    margemLucro: float = Field(default=0, ge=0, le=10000)


def _json_seguro(valor):
    if isinstance(valor, ObjectId):
        return str(valor)
    if isinstance(valor, datetime):
        return valor.isoformat()
    if isinstance(valor, dict):
        return {chave: _json_seguro(item) for chave, item in valor.items()}
    if isinstance(valor, list):
        return [_json_seguro(item) for item in valor]
    return valor


@router.get("/backup")
async def baixar_backup(_: str = Depends(require_atelie_auth)):
    db = get_db()
    colecoes = (
        "perfumes",
        "movimentos",
        "pedidos",
        "clientes",
        "opinioes",
        "sugestoes",
        "compras",
    )
    conteudo = {
        "aplicacao": "L'Essence Furlani",
        "geradoEm": datetime.now(timezone.utc).isoformat(),
        "versao": 1,
        "dados": {},
    }
    resultados = await asyncio.gather(*[
        db[nome].find().to_list(length=100_000)
        for nome in colecoes
    ])
    for nome, documentos in zip(colecoes, resultados):
        conteudo["dados"][nome] = [
            _json_seguro(documento) for documento in documentos
        ]

    arquivo = json.dumps(conteudo, ensure_ascii=False, indent=2).encode("utf-8")
    data = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return Response(
        content=arquivo,
        media_type="application/json; charset=utf-8",
        headers={
            "Content-Disposition": (
                f'attachment; filename="lessence-furlani-backup-{data}.json"'
            )
        },
    )


@router.get("/metricas")
async def obter_metricas(_: str = Depends(require_atelie_auth)):
    db = get_db()
    pedidos = await db.pedidos.find().to_list(length=None)
    validos = [p for p in pedidos if p.get("status") != "cancelado"]

    por_status: dict[str, int] = {}
    produtos: dict[str, dict] = {}
    faturamento = 0.0
    for pedido in pedidos:
        status = pedido.get("status", "pendente")
        por_status[status] = por_status.get(status, 0) + 1
    for pedido in validos:
        faturamento += float(pedido.get("total", 0) or 0)
        for item in pedido.get("itens", []):
            chave = str(item.get("perfumeId", item.get("perfumeNome", "")))
            if not chave:
                continue
            linha = produtos.setdefault(
                chave,
                {
                    "perfumeId": item.get("perfumeId"),
                    "nome": item.get("perfumeNome", "Perfume"),
                    "quantidade": 0,
                    "faturamento": 0.0,
                },
            )
            quantidade = int(item.get("quantidade", 1) or 1)
            linha["quantidade"] += quantidade
            linha["faturamento"] += float(
                item.get(
                    "subtotal",
                    float(item.get("precoUnitario", 0) or 0) * quantidade,
                )
                or 0
            )

    mais_vendidos = sorted(
        produtos.values(),
        key=lambda item: (item["quantidade"], item["faturamento"]),
        reverse=True,
    )[:10]
    ticket_medio = faturamento / len(validos) if validos else 0
    return {
        "pedidosTotal": len(pedidos),
        "pedidosValidos": len(validos),
        "pedidosPorStatus": por_status,
        "faturamento": round(faturamento, 2),
        "ticketMedio": round(ticket_medio, 2),
        "maisVendidos": [
            {**item, "faturamento": round(item["faturamento"], 2)}
            for item in mais_vendidos
        ],
    }


@router.get("/configuracoes")
async def obter_configuracoes(_: str = Depends(require_atelie_auth)):
    doc = await get_db().configuracoes.find_one({"_id": "loja"}) or {}
    return ConfiguracoesLojaIn(**{
        chave: doc.get(chave, padrao)
        for chave, padrao in ConfiguracoesLojaIn().model_dump().items()
    }).model_dump()


@router.put("/configuracoes")
async def salvar_configuracoes(
    payload: ConfiguracoesLojaIn,
    _: str = Depends(require_atelie_auth),
):
    dados = payload.model_dump()
    dados["atualizadoEm"] = datetime.now(timezone.utc).isoformat()
    await get_db().configuracoes.update_one(
        {"_id": "loja"},
        {"$set": dados},
        upsert=True,
    )
    return payload.model_dump()


@router.post("/dados/{recurso}/limpar")
async def limpar_dados(recurso: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    if recurso == "opinioes":
        opinioes = await db.opinioes.delete_many({})
        sugestoes = await db.sugestoes.delete_many({})
        return {
            "status": "Opiniões e sugestões removidas.",
            "removidos": opinioes.deleted_count + sugestoes.deleted_count,
        }
    if recurso == "estoque":
        movimentos = await db.movimentos.delete_many({})
        return {
            "status": "Movimentos de estoque removidos.",
            "removidos": movimentos.deleted_count,
        }
    if recurso == "catalogo":
        pedidos_ativos = await db.pedidos.count_documents({
            "status": {"$nin": ["cancelado", "entregue"]},
        })
        if pedidos_ativos:
            raise HTTPException(
                status_code=409,
                detail="Conclua ou cancele os pedidos ativos antes de resetar o catálogo.",
            )
        perfumes = await db.perfumes.delete_many({})
        await asyncio.gather(
            db.movimentos.delete_many({}),
            db.opinioes.delete_many({}),
            db.vitrine.delete_many({}),
            db.counters.delete_one({"_id": "perfumes"}),
        )
        return {
            "status": "Catálogo resetado.",
            "removidos": perfumes.deleted_count,
        }
    raise HTTPException(status_code=404, detail="Ação de limpeza não encontrada.")


@router.get("/pedidos/reset-version")
async def obter_versao_reset_pedidos():
    """Versão pública usada pelos aparelhos para invalidar históricos locais."""
    doc = await get_db().configuracoes.find_one({"_id": PEDIDOS_RESET_ID})
    return {
        "version": int(
            doc.get("version", PEDIDOS_RESET_VERSAO_INICIAL)
            if doc
            else PEDIDOS_RESET_VERSAO_INICIAL
        )
    }


@router.post("/pedidos/reset")
async def resetar_base_pedidos(_: str = Depends(require_atelie_auth)):
    """Apaga pedidos e invalida os códigos salvos em todos os aparelhos."""
    async with stock_lock:
        db = get_db()
        pedidos = await db.pedidos.count_documents({})
        compras_legadas = await db.compras.count_documents({})

        # Os movimentos com essa origem são as baixas automáticas dos pedidos.
        # Removê-los devolve o saldo ao estado anterior sem tocar nas entradas.
        movimentos = await db.movimentos.delete_many({
            "origem": {"$regex": r"^pedido:"},
        })
        await db.pedidos.delete_many({})
        await db.compras.delete_many({})
        await db.counters.delete_one({"_id": "pedidos"})

        await db.configuracoes.update_one(
            {"_id": PEDIDOS_RESET_ID},
            {"$setOnInsert": {"version": PEDIDOS_RESET_VERSAO_INICIAL}},
            upsert=True,
        )
        versao = await db.configuracoes.find_one_and_update(
            {"_id": PEDIDOS_RESET_ID},
            {
                "$inc": {"version": 1},
                "$set": {"atualizadoEm": datetime.now(timezone.utc).isoformat()},
            },
            return_document=ReturnDocument.AFTER,
        )

    return {
        "status": "Base de pedidos zerada.",
        "pedidosApagados": pedidos,
        "comprasLegadasApagadas": compras_legadas,
        "movimentosEstornados": movimentos.deleted_count,
        "resetVersion": versao["version"],
    }
