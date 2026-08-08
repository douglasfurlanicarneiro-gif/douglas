"""Recursos operacionais do painel: métricas e backup."""
import asyncio
import json
import os
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from config import INFINITEPAY_HANDLE
from database import get_db
from finance import estimar_custo_unitario, obter_config_custos
from locks import stock_lock
from payments.pix import PIX_KEY
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
    infinitePayHandle: str = Field(default="", max_length=120)
    cnpj: str = Field(default="", max_length=30)
    margemLucro: float = Field(default=0, ge=0, le=10000)


class ConfiguracoesLojaPublica(BaseModel):
    nomeLoja: str
    logoUrl: str
    whatsapp: str
    instagram: str
    email: str
    cartaoOnlineAtivo: bool
    pixManualAtivo: bool


def _configuracoes_completas(doc: dict | None = None) -> dict:
    documento = doc or {}
    return {
        chave: documento.get(chave, padrao)
        for chave, padrao in ConfiguracoesLojaIn().model_dump().items()
    }


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
        "operacoes_sistema",
        "fornecedores",
        "cotacoes_fornecedores",
        "insumos",
        "movimentos_insumos",
        "producoes",
        "configuracoes",
    )
    conteudo = {
        "aplicacao": "L'Essence Furlani",
        "geradoEm": datetime.now(timezone.utc).isoformat(),
        "versao": 2,
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
async def obter_metricas(
    periodo: str = "30d",
    _: str = Depends(require_atelie_auth),
):
    """BI operacional com receita somente de pedidos efetivamente pagos.

    ``periodo`` aceita 7d, 30d, mes e todos. O cálculo de lucro usa o custo
    congelado no item quando existir e, para pedidos antigos, a configuração
    atual de custos como estimativa.
    """
    db = get_db()
    agora = datetime.now(timezone.utc)
    filtro: dict = {}
    if periodo == "7d":
        filtro["criadoEm"] = {"$gte": (agora - timedelta(days=7)).isoformat()}
    elif periodo == "30d":
        filtro["criadoEm"] = {"$gte": (agora - timedelta(days=30)).isoformat()}
    elif periodo == "mes":
        inicio_mes = agora.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        filtro["criadoEm"] = {"$gte": inicio_mes.isoformat()}
    elif periodo != "todos":
        periodo = "30d"
        filtro["criadoEm"] = {"$gte": (agora - timedelta(days=30)).isoformat()}

    pedidos = await db.pedidos.find(filtro).to_list(20_000)
    status_pagos = {
        "pagamento_confirmado",
        "preparando",
        "pronto",
        "enviado",
        "entregue",
    }
    pagos = [p for p in pedidos if p.get("status") in status_pagos]
    pendentes = [p for p in pedidos if p.get("status", "pendente") == "pendente"]
    cancelados = [p for p in pedidos if p.get("status") == "cancelado"]

    por_status: dict[str, int] = {}
    for pedido in pedidos:
        status = pedido.get("status", "pendente")
        por_status[status] = por_status.get(status, 0) + 1

    ids_perfumes: set[ObjectId] = set()
    for pedido in pagos:
        for item in pedido.get("itens", []):
            try:
                ids_perfumes.add(ObjectId(str(item.get("perfumeId"))))
            except Exception:
                continue
    perfumes = await db.perfumes.find(
        {"_id": {"$in": list(ids_perfumes)}},
        {"nome": 1, "custoEssenciaPorMl": 1, "concentracaoPercentual": 1},
    ).to_list(len(ids_perfumes)) if ids_perfumes else []
    perfumes_por_id = {str(item["_id"]): item for item in perfumes}
    config_custos = await obter_config_custos(db)

    produtos: dict[str, dict] = {}
    serie_diaria: dict[str, dict] = {}
    tamanhos: dict[int, dict] = {}
    receita_confirmada = 0.0
    receita_entregue = 0.0
    a_receber = sum(float(p.get("total", 0) or 0) for p in pendentes)
    custo_estimado = 0.0
    receita_produtos = 0.0
    lucro_produtos_estimado = 0.0
    ml_vendidos = 0

    for pedido in pagos:
        total_pedido = float(pedido.get("total", 0) or 0)
        receita_confirmada += total_pedido
        if pedido.get("status") == "entregue":
            receita_entregue += total_pedido

        data_pedido = str(pedido.get("criadoEm") or "")[:10]
        dia = None
        if len(data_pedido) == 10:
            dia = serie_diaria.setdefault(data_pedido, {
                "data": data_pedido, "receita": 0.0, "lucro": 0.0, "pedidos": 0, "ml": 0,
            })
            dia["receita"] += total_pedido
            dia["pedidos"] += 1

        for item in pedido.get("itens", []):
            perfume_id = str(item.get("perfumeId") or "")
            nome = item.get("perfumeNome") or perfumes_por_id.get(perfume_id, {}).get("nome") or "Perfume"
            chave = perfume_id or nome
            if not chave:
                continue
            quantidade = max(1, int(item.get("quantidade", 1) or 1))
            ml = max(0, int(item.get("ml", 0) or 0))
            preco_unitario = float(item.get("precoUnitario", 0) or 0)
            subtotal = float(item.get("subtotal", preco_unitario * quantidade) or 0)

            custo_unitario = item.get("custoUnitarioEstimado")
            if custo_unitario is None:
                perfume = perfumes_por_id.get(perfume_id, {})
                custo_unitario = estimar_custo_unitario(
                    perfume, ml, preco_unitario, config_custos
                )["custoTotal"]
            custo_item = float(custo_unitario or 0) * quantidade
            lucro_item = subtotal - custo_item
            custo_estimado += custo_item
            receita_produtos += subtotal
            lucro_produtos_estimado += lucro_item
            ml_item = ml * quantidade
            ml_vendidos += ml_item
            if dia is not None:
                dia["lucro"] += lucro_item
                dia["ml"] += ml_item
            tamanho = tamanhos.setdefault(ml, {"ml": ml, "quantidade": 0, "faturamento": 0.0})
            tamanho["quantidade"] += quantidade
            tamanho["faturamento"] += subtotal

            linha = produtos.setdefault(chave, {
                "perfumeId": perfume_id or None,
                "nome": nome,
                "quantidade": 0,
                "ml": 0,
                "faturamento": 0.0,
                "lucroEstimado": 0.0,
            })
            linha["quantidade"] += quantidade
            linha["ml"] += ml_item
            linha["faturamento"] += subtotal
            linha["lucroEstimado"] += lucro_item

    # Lucro de produto não inclui frete cobrado do cliente. Isso evita
    # inflar a margem quando o total do pedido contém entrega.
    lucro_estimado = lucro_produtos_estimado
    margem_estimada = (lucro_estimado / receita_produtos * 100) if receita_produtos else 0.0
    ticket_medio = receita_confirmada / len(pagos) if pagos else 0.0
    mais_vendidos = sorted(
        produtos.values(),
        key=lambda item: (item["ml"], item["faturamento"]),
        reverse=True,
    )[:10]
    mais_lucrativos = sorted(
        produtos.values(),
        key=lambda item: (item["lucroEstimado"], item["faturamento"]),
        reverse=True,
    )[:10]
    tamanho_mais_vendido = max(
        tamanhos.values(), key=lambda item: (item["quantidade"], item["faturamento"]), default=None
    )

    # Para períodos curtos, preenche dias sem venda para o gráfico não
    # desaparecer nem sugerir continuidade onde houve zero movimento.
    if periodo in {"7d", "30d", "mes"}:
        if periodo == "7d":
            inicio_serie = (agora - timedelta(days=6)).date()
        elif periodo == "30d":
            inicio_serie = (agora - timedelta(days=29)).date()
        else:
            inicio_serie = agora.replace(day=1).date()
        cursor = inicio_serie
        while cursor <= agora.date():
            chave_dia = cursor.isoformat()
            serie_diaria.setdefault(chave_dia, {
                "data": chave_dia, "receita": 0.0, "lucro": 0.0, "pedidos": 0, "ml": 0,
            })
            cursor += timedelta(days=1)

    return {
        "periodo": periodo,
        "pedidosTotal": len(pedidos),
        "pedidosValidos": len([p for p in pedidos if p.get("status") != "cancelado"]),
        "pedidosPagos": len(pagos),
        "pedidosPendentes": len(pendentes),
        "pedidosCancelados": len(cancelados),
        "pedidosPorStatus": por_status,
        # Mantido por compatibilidade; agora significa receita confirmada.
        "faturamento": round(receita_confirmada, 2),
        "receitaConfirmada": round(receita_confirmada, 2),
        "receitaEntregue": round(receita_entregue, 2),
        "aReceber": round(a_receber, 2),
        "ticketMedio": round(ticket_medio, 2),
        "custoEstimado": round(custo_estimado, 2),
        "lucroEstimado": round(lucro_estimado, 2),
        "margemEstimada": round(margem_estimada, 2),
        "mlVendidos": int(ml_vendidos),
        "tamanhoMaisVendido": (
            {**tamanho_mais_vendido, "faturamento": round(tamanho_mais_vendido["faturamento"], 2)}
            if tamanho_mais_vendido else None
        ),
        "serieDiaria": [
            {
                **item,
                "receita": round(item["receita"], 2),
                "lucro": round(item["lucro"], 2),
            }
            for item in sorted(serie_diaria.values(), key=lambda item: item["data"])
        ],
        "maisVendidos": [
            {
                **item,
                "faturamento": round(item["faturamento"], 2),
                "lucroEstimado": round(item["lucroEstimado"], 2),
            }
            for item in mais_vendidos
        ],
        "maisLucrativos": [
            {
                **item,
                "faturamento": round(item["faturamento"], 2),
                "lucroEstimado": round(item["lucroEstimado"], 2),
            }
            for item in mais_lucrativos
        ],
    }


@router.get("/configuracoes")
async def obter_configuracoes(_: str = Depends(require_atelie_auth)):
    doc = await get_db().configuracoes.find_one({"_id": "loja"}) or {}
    dados = _configuracoes_completas(doc)
    dados["whatsapp"] = (
        str(dados["whatsapp"]).strip()
        or os.getenv("WHATSAPP_NUMBER", "").strip()
    )
    dados["pix"] = str(dados["pix"]).strip() or PIX_KEY
    dados["infinitePayHandle"] = (
        str(dados["infinitePayHandle"]).strip().lstrip("$")
        or INFINITEPAY_HANDLE
    )
    return ConfiguracoesLojaIn(**dados).model_dump()


@router.get("/configuracoes/publicas")
async def obter_configuracoes_publicas():
    """Identidade e contatos necessários à vitrine, sem dados administrativos."""
    doc = await get_db().configuracoes.find_one({"_id": "loja"}) or {}
    dados = _configuracoes_completas(doc)
    return ConfiguracoesLojaPublica(
        nomeLoja=str(dados["nomeLoja"]).strip() or "L’Essence Furlani",
        logoUrl=str(dados["logoUrl"]).strip(),
        whatsapp=(
            str(dados["whatsapp"]).strip()
            or os.getenv("WHATSAPP_NUMBER", "").strip()
        ),
        instagram=str(dados["instagram"]).strip(),
        email=str(dados["email"]).strip(),
        cartaoOnlineAtivo=bool(
            str(dados["infinitePayHandle"]).strip().lstrip("$")
            or INFINITEPAY_HANDLE
        ),
        pixManualAtivo=bool(str(dados["pix"]).strip() or PIX_KEY),
    ).model_dump()


@router.put("/configuracoes")
async def salvar_configuracoes(
    payload: ConfiguracoesLojaIn,
    _: str = Depends(require_atelie_auth),
):
    db = get_db()
    atuais = _configuracoes_completas(
        await db.configuracoes.find_one({"_id": "loja"}) or {}
    )
    enviados = payload.model_dump()
    dados = {
        chave: (
            valor.strip()
            if isinstance(valor, str) and valor.strip()
            else atuais[chave]
            if isinstance(valor, str)
            else valor
        )
        for chave, valor in enviados.items()
    }
    dados["nomeLoja"] = dados["nomeLoja"] or "L’Essence Furlani"
    # Limpar a InfiniteTag deve realmente desativar o checkout de cartao.
    dados["infinitePayHandle"] = (
        str(enviados.get("infinitePayHandle", "")).strip().lstrip("$")
    )
    # Permite desativar a contingencia manual sem manter uma chave antiga.
    dados["pix"] = str(enviados.get("pix", "")).strip()
    dados["atualizadoEm"] = datetime.now(timezone.utc).isoformat()
    await db.configuracoes.update_one(
        {"_id": "loja"},
        {"$set": dados},
        upsert=True,
    )
    return ConfiguracoesLojaIn(**dados).model_dump()


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
        async with stock_lock(db):
            movimentos = await db.movimentos.delete_many({})
        return {
            "status": "Movimentos de estoque removidos.",
            "removidos": movimentos.deleted_count,
        }
    if recurso == "catalogo":
        async with stock_lock(db):
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
    db = get_db()
    async with stock_lock(db):
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
