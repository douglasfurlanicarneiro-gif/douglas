"""Recursos operacionais do painel: métricas e backup."""
import asyncio
import json
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends
from fastapi.responses import Response

from database import get_db
from security import require_atelie_auth

router = APIRouter(prefix="/api/admin", tags=["admin"])


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
