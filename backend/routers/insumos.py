"""Estoque de matérias-primas e registro de produção."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from catalog_cache import invalidate_catalog_cache
from database import get_db
from locks import stock_lock
from security import require_atelie_auth
from utils import serialize

router = APIRouter(prefix="/api/admin/insumos", tags=["insumos"])

CATEGORIAS = ("essencia", "base", "frasco", "valvula", "tampa", "etiqueta", "embalagem", "outro")


class InsumoIn(BaseModel):
    nome: str = Field(min_length=2, max_length=180)
    categoria: Literal["essencia", "base", "frasco", "valvula", "tampa", "etiqueta", "embalagem", "outro"]
    unidade: Literal["ml", "g", "un"]
    custoUnitario: float = Field(default=0, ge=0, le=1_000_000)
    estoqueMinimo: float = Field(default=0, ge=0, le=1_000_000_000)
    estoqueInicial: float = Field(default=0, ge=0, le=1_000_000_000)
    fornecedorId: str | None = None
    perfumeId: str | None = None
    tamanhoMl: int | None = Field(default=None, gt=0, le=5000)
    observacoes: str = Field(default="", max_length=2000)
    ativo: bool = True

    @model_validator(mode="after")
    def validar_unidade_operacional(self):
        if self.categoria in {"essencia", "base"} and self.unidade != "ml":
            raise ValueError("Essência e base devem ser cadastradas em ml para o cálculo de produção.")
        if self.categoria in {"frasco", "valvula", "tampa", "etiqueta", "embalagem"} and self.unidade != "un":
            raise ValueError("Frascos e componentes devem ser cadastrados por unidade.")
        if self.categoria == "frasco" and not self.tamanhoMl:
            raise ValueError("Informe o tamanho em ml do frasco.")
        if self.categoria == "essencia" and not self.perfumeId:
            raise ValueError("Vincule a essência ao perfume correspondente.")
        return self


class InsumoUpdateIn(BaseModel):
    nome: str = Field(min_length=2, max_length=180)
    categoria: Literal["essencia", "base", "frasco", "valvula", "tampa", "etiqueta", "embalagem", "outro"]
    unidade: Literal["ml", "g", "un"]
    custoUnitario: float = Field(default=0, ge=0, le=1_000_000)
    estoqueMinimo: float = Field(default=0, ge=0, le=1_000_000_000)
    fornecedorId: str | None = None
    perfumeId: str | None = None
    tamanhoMl: int | None = Field(default=None, gt=0, le=5000)
    observacoes: str = Field(default="", max_length=2000)
    ativo: bool = True

    @model_validator(mode="after")
    def validar_unidade_operacional(self):
        if self.categoria in {"essencia", "base"} and self.unidade != "ml":
            raise ValueError("Essência e base devem ser cadastradas em ml para o cálculo de produção.")
        if self.categoria in {"frasco", "valvula", "tampa", "etiqueta", "embalagem"} and self.unidade != "un":
            raise ValueError("Frascos e componentes devem ser cadastrados por unidade.")
        if self.categoria == "frasco" and not self.tamanhoMl:
            raise ValueError("Informe o tamanho em ml do frasco.")
        if self.categoria == "essencia" and not self.perfumeId:
            raise ValueError("Vincule a essência ao perfume correspondente.")
        return self


class MovimentoInsumoIn(BaseModel):
    tipo: Literal["entrada", "saida"]
    quantidade: float = Field(gt=0, le=1_000_000_000)
    motivo: str = Field(default="Ajuste manual", max_length=300)


class ProducaoIn(BaseModel):
    perfumeId: str
    ml: int = Field(gt=0, le=1000)
    quantidade: int = Field(gt=0, le=1000)


def _oid(valor: str, label: str = "Registro") -> ObjectId:
    try:
        return ObjectId(valor)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail=f"{label} inválido.") from exc


async def _sincronizar_custo_operacional(db, dados: dict) -> None:
    """Mantém o cadastro de insumos e o motor de rentabilidade alinhados."""
    categoria = dados.get("categoria")
    custo = max(0.0, float(dados.get("custoUnitario", 0) or 0))
    if categoria == "essencia" and dados.get("perfumeId") and custo > 0:
        try:
            perfume_oid = ObjectId(str(dados["perfumeId"]))
        except InvalidId:
            return
        await db.perfumes.update_one(
            {"_id": perfume_oid},
            {"$set": {"custoEssenciaPorMl": custo}},
        )
        return

    mapa = {
        "base": "custoBasePorMl",
        "valvula": "custoValvula",
        "tampa": "custoTampa",
        "etiqueta": "custoEtiqueta",
        "embalagem": "custoEmbalagem",
    }
    campo = mapa.get(str(categoria))
    if campo:
        await db.configuracoes.update_one(
            {"_id": "custos"}, {"$set": {campo: custo}}, upsert=True
        )
    elif categoria == "frasco" and dados.get("tamanhoMl"):
        tamanho = int(dados["tamanhoMl"])
        await db.configuracoes.update_one(
            {"_id": "custos"},
            {"$set": {f"frascos.{tamanho}": custo}},
            upsert=True,
        )


async def _saldos(db, ids: list[str] | None = None) -> dict[str, float]:
    match = {"insumoId": {"$in": ids}} if ids is not None else {}
    pipeline = []
    if match:
        pipeline.append({"$match": match})
    pipeline.append({
        "$group": {
            "_id": "$insumoId",
            "total": {"$sum": {"$cond": [
                {"$eq": ["$tipo", "entrada"]},
                "$quantidade",
                {"$multiply": ["$quantidade", -1]},
            ]}},
        }
    })
    resultado: dict[str, float] = {}
    async for linha in await db.movimentos_insumos.aggregate(pipeline):
        resultado[str(linha["_id"])] = float(linha.get("total", 0) or 0)
    return resultado


async def _resolver_plano(db, payload: ProducaoIn) -> dict:
    perfume_oid = _oid(payload.perfumeId, "Perfume")
    perfume = await db.perfumes.find_one({"_id": perfume_oid})
    if not perfume:
        raise HTTPException(status_code=404, detail="Perfume não encontrado.")

    concentracao = min(100.0, max(0.0, float(perfume.get("concentracaoPercentual", 25) or 25)))
    volume_total = payload.ml * payload.quantidade
    essencia_ml = round(volume_total * concentracao / 100.0, 3)
    base_ml = round(volume_total - essencia_ml, 3)

    insumos = await db.insumos.find({"ativo": {"$ne": False}}).to_list(5000)
    saldo = await _saldos(db, [str(item["_id"]) for item in insumos])

    def escolher(categoria: str, *, perfume_id: str | None = None, tamanho: int | None = None):
        candidatos = [item for item in insumos if item.get("categoria") == categoria]
        if perfume_id is not None:
            candidatos = [item for item in candidatos if str(item.get("perfumeId") or "") == perfume_id]
        if tamanho is not None:
            candidatos = [item for item in candidatos if int(item.get("tamanhoMl") or 0) == tamanho]
        return candidatos[0] if candidatos else None

    requisitos = []
    faltantes_config = []
    especificacoes = [
        ("essencia", escolher("essencia", perfume_id=payload.perfumeId), essencia_ml, "ml"),
        ("base", escolher("base"), base_ml, "ml"),
        ("frasco", escolher("frasco", tamanho=payload.ml), float(payload.quantidade), "un"),
    ]
    # Componentes unitários são opcionais até serem cadastrados. Quando existem,
    # passam automaticamente a fazer parte do custo e da baixa da produção.
    for categoria in ("valvula", "tampa", "etiqueta", "embalagem"):
        item = escolher(categoria)
        if item:
            especificacoes.append((categoria, item, float(payload.quantidade), "un"))

    for categoria, insumo, quantidade, unidade in especificacoes:
        if not insumo:
            faltantes_config.append(categoria)
            continue
        insumo_id = str(insumo["_id"])
        disponivel = saldo.get(insumo_id, 0.0)
        custo = float(insumo.get("custoUnitario", 0) or 0) * quantidade
        requisitos.append({
            "insumoId": insumo_id,
            "nome": insumo.get("nome", categoria.title()),
            "categoria": categoria,
            "unidade": insumo.get("unidade", unidade),
            "necessario": round(quantidade, 3),
            "disponivel": round(disponivel, 3),
            "suficiente": disponivel + 1e-9 >= quantidade,
            "custo": round(custo, 4),
        })

    custo_total = sum(item["custo"] for item in requisitos)
    faltantes_estoque = [item for item in requisitos if not item["suficiente"]]
    return {
        "perfumeId": payload.perfumeId,
        "perfumeNome": perfume.get("nome", "Perfume"),
        "ml": payload.ml,
        "quantidade": payload.quantidade,
        "volumeTotalMl": volume_total,
        "concentracaoPercentual": concentracao,
        "requisitos": requisitos,
        "faltantesConfiguracao": faltantes_config,
        "faltantesEstoque": faltantes_estoque,
        "custoTotal": round(custo_total, 2),
        "custoPorFrasco": round(custo_total / payload.quantidade, 2),
        "podeProduzir": not faltantes_config and not faltantes_estoque,
    }


@router.get("")
async def listar_insumos(_: str = Depends(require_atelie_auth)):
    db = get_db()
    docs = await db.insumos.find().sort([("ativo", -1), ("categoria", 1), ("nome", 1)]).to_list(5000)
    saldos = await _saldos(db, [str(item["_id"]) for item in docs])
    return [{
        **serialize(item),
        "saldoAtual": round(saldos.get(str(item["_id"]), 0.0), 3),
        "valorEstoque": round(saldos.get(str(item["_id"]), 0.0) * float(item.get("custoUnitario", 0) or 0), 2),
    } for item in docs]


@router.post("")
async def criar_insumo(payload: InsumoIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    agora = datetime.now(timezone.utc).isoformat()
    dados = payload.model_dump(exclude={"estoqueInicial"})
    dados.update({"criadoEm": agora, "atualizadoEm": agora})
    resultado = await db.insumos.insert_one(dados)
    insumo_id = str(resultado.inserted_id)
    await _sincronizar_custo_operacional(db, dados)
    if payload.estoqueInicial > 0:
        await db.movimentos_insumos.insert_one({
            "insumoId": insumo_id,
            "tipo": "entrada",
            "quantidade": float(payload.estoqueInicial),
            "motivo": "Estoque inicial",
            "origem": "cadastro",
            "data": agora,
        })
    return serialize(await db.insumos.find_one({"_id": resultado.inserted_id}))


@router.put("/{insumo_id}")
async def atualizar_insumo(insumo_id: str, payload: InsumoUpdateIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    oid = _oid(insumo_id, "Insumo")
    dados = {**payload.model_dump(), "atualizadoEm": datetime.now(timezone.utc).isoformat()}
    resultado = await db.insumos.update_one({"_id": oid}, {"$set": dados})
    await _sincronizar_custo_operacional(db, dados)
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Insumo não encontrado.")
    return serialize(await db.insumos.find_one({"_id": oid}))


@router.delete("/{insumo_id}")
async def arquivar_insumo(insumo_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    oid = _oid(insumo_id, "Insumo")
    resultado = await db.insumos.update_one(
        {"_id": oid},
        {"$set": {"ativo": False, "atualizadoEm": datetime.now(timezone.utc).isoformat()}},
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Insumo não encontrado.")
    return {"status": "Insumo arquivado."}


@router.post("/{insumo_id}/movimentos")
async def movimentar_insumo(
    insumo_id: str,
    payload: MovimentoInsumoIn,
    _: str = Depends(require_atelie_auth),
):
    db = get_db()
    oid = _oid(insumo_id, "Insumo")
    async with stock_lock(db):
        insumo = await db.insumos.find_one({"_id": oid})
        if not insumo:
            raise HTTPException(status_code=404, detail="Insumo não encontrado.")
        saldo = (await _saldos(db, [insumo_id])).get(insumo_id, 0.0)
        if payload.tipo == "saida" and saldo + 1e-9 < payload.quantidade:
            raise HTTPException(
                status_code=409,
                detail=f"Saldo insuficiente. Disponível: {saldo:g} {insumo.get('unidade', '')}.",
            )
        doc = {
            "insumoId": insumo_id,
            **payload.model_dump(),
            "origem": "manual",
            "data": datetime.now(timezone.utc).isoformat(),
        }
        resultado = await db.movimentos_insumos.insert_one(doc)
    return serialize(await db.movimentos_insumos.find_one({"_id": resultado.inserted_id}))


@router.post("/producao/simular")
async def simular_producao(payload: ProducaoIn, _: str = Depends(require_atelie_auth)):
    return await _resolver_plano(get_db(), payload)


@router.post("/producao/registrar")
async def registrar_producao(payload: ProducaoIn, _: str = Depends(require_atelie_auth)):
    db = get_db()
    async with stock_lock(db):
        plano = await _resolver_plano(db, payload)
        if plano["faltantesConfiguracao"]:
            nomes = ", ".join(plano["faltantesConfiguracao"])
            raise HTTPException(status_code=409, detail=f"Cadastre os insumos obrigatórios: {nomes}.")
        if plano["faltantesEstoque"]:
            raise HTTPException(status_code=409, detail="Há matéria-prima insuficiente para essa produção.")

        agora = datetime.now(timezone.utc).isoformat()
        producao_doc = {
            "perfumeId": payload.perfumeId,
            "perfumeNome": plano["perfumeNome"],
            "ml": payload.ml,
            "quantidade": payload.quantidade,
            "volumeTotalMl": plano["volumeTotalMl"],
            "custoTotal": plano["custoTotal"],
            "custoPorFrasco": plano["custoPorFrasco"],
            "requisitos": plano["requisitos"],
            "data": agora,
        }
        resultado = await db.producoes.insert_one(producao_doc)
        producao_id = str(resultado.inserted_id)

        movimentos = [{
            "insumoId": item["insumoId"],
            "tipo": "saida",
            "quantidade": item["necessario"],
            "motivo": f"Produção de {payload.quantidade}x {payload.ml}ml — {plano['perfumeNome']}",
            "origem": f"producao:{producao_id}",
            "data": agora,
        } for item in plano["requisitos"]]
        if movimentos:
            await db.movimentos_insumos.insert_many(movimentos)

        # O produto acabado entra no estoque comercial existente. Assim a
        # vitrine e as reservas passam a enxergar imediatamente o novo lote.
        await db.movimentos.insert_one({
            "perfumeId": payload.perfumeId,
            "tipo": "entrada",
            "quantidadeMl": plano["volumeTotalMl"],
            "motivo": f"Produção registrada: {payload.quantidade}x {payload.ml}ml",
            "categoria": "producao",
            "origem": f"producao:{producao_id}",
            "data": agora,
        })
        invalidate_catalog_cache()

    return {**plano, "producaoId": producao_id, "registrada": True}
