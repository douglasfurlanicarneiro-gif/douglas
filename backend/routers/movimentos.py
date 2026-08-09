from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from audit import registrar_auditoria
from database import get_db
from locks import stock_lock
from security import require_atelie_auth
from stock import STOCK_PIPELINE, mapa_reservado, mapa_saldo_fisico
from utils import serialize

router = APIRouter(tags=["estoque"])

# Soma de entradas menos saídas, agrupado por perfume — é assim que o
# estoque "atual" é sempre calculado, nunca guardado como um número solto
# no documento do perfume (ver auditoria: única fonte da verdade).
_PIPELINE_ESTOQUE = STOCK_PIPELINE


class MovimentoIn(BaseModel):
    perfumeId: str
    tipo: str  # 'entrada' | 'saida'
    quantidadeMl: int
    motivo: str = ""
    categoria: str = "ajuste"


class CompletarEstoqueIn(BaseModel):
    quantidadeMl: int = Field(default=1000, gt=0, le=1_000_000)
    somentePublicaveis: bool = True


class ConferenciaEstoqueIn(BaseModel):
    perfumeId: str
    quantidadeFisicaMl: int = Field(ge=0, le=1_000_000)
    saldoEsperadoMl: int | None = Field(default=None, ge=-1_000_000, le=1_000_000)
    motivo: str = Field(default="Conferência física", max_length=200)


def calcular_ajuste_contagem(saldo_atual: int, quantidade_fisica: int) -> tuple[str, int] | None:
    diferenca = quantidade_fisica - saldo_atual
    if diferenca == 0:
        return None
    return ("entrada" if diferenca > 0 else "saida", abs(diferenca))


@router.get("/api/movimentos")
async def listar_movimentos(_: str = Depends(require_atelie_auth)):
    db = get_db()
    movimentos = await db.movimentos.find().sort("data", -1).to_list(5000)
    return [serialize(m) for m in movimentos]


@router.post("/api/movimentos")
async def criar_movimento(payload: MovimentoIn, _: str = Depends(require_atelie_auth)):
    if payload.tipo not in ("entrada", "saida"):
        raise HTTPException(status_code=400, detail="Tipo de movimento inválido.")
    if payload.quantidadeMl <= 0:
        raise HTTPException(status_code=400, detail="Quantidade deve ser maior que zero.")
    db = get_db()
    async with stock_lock(db):
        doc = payload.model_dump()
        doc["data"] = datetime.now(timezone.utc).isoformat()
        doc["origem"] = "manual"
        resultado = await db.movimentos.insert_one(doc)
        novo = await db.movimentos.find_one({"_id": resultado.inserted_id})
    return serialize(novo)


@router.post("/api/movimentos/completar-estoque")
async def completar_estoque(payload: CompletarEstoqueIn, _: str = Depends(require_atelie_auth)):
    """Completa cada perfume até o saldo alvo sem duplicar entradas existentes."""
    db = get_db()
    async with stock_lock(db):
        filtro = {"arquivadoEm": None}
        if payload.somentePublicaveis:
            filtro["publicavel"] = True
        perfumes = await db.perfumes.find(filtro, {"_id": 1}).to_list(5000)
        estoque_atual = await mapa_saldo_fisico(db)

        agora = datetime.now(timezone.utc).isoformat()
        movimentos = []
        for perfume in perfumes:
            perfume_id = str(perfume["_id"])
            diferenca = payload.quantidadeMl - estoque_atual.get(perfume_id, 0)
            if diferenca <= 0:
                continue
            movimentos.append({
                "perfumeId": perfume_id,
                "tipo": "entrada",
                "quantidadeMl": diferenca,
                "motivo": f"Carga inicial até {payload.quantidadeMl}ml",
                "origem": "ajuste-inicial-em-massa",
                "data": agora,
            })

        if movimentos:
            await db.movimentos.insert_many(movimentos)

    return {
        "perfumesConsiderados": len(perfumes),
        "perfumesAtualizados": len(movimentos),
        "estoqueAlvoMl": payload.quantidadeMl,
    }


@router.post("/api/estoque/conferir")
async def conferir_estoque(payload: ConferenciaEstoqueIn, _: str = Depends(require_atelie_auth)):
    """Registra somente a diferença entre o saldo atual e a contagem física."""
    db = get_db()
    try:
        perfume_oid = ObjectId(payload.perfumeId)
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Perfume inválido.") from exc
    async with stock_lock(db):
        perfume = await db.perfumes.find_one({"_id": perfume_oid}, {"nome": 1})
        if not perfume:
            raise HTTPException(status_code=404, detail="Perfume não encontrado.")

        saldo_atual = 0
        pipeline = [
            {"$match": {"perfumeId": payload.perfumeId}},
            *_PIPELINE_ESTOQUE,
        ]
        async for linha in db.movimentos.aggregate(pipeline):
            saldo_atual = int(linha["total"])

        if payload.saldoEsperadoMl is not None and payload.saldoEsperadoMl != saldo_atual:
            raise HTTPException(
                status_code=409,
                detail=f"O saldo mudou para {saldo_atual}ml. Atualize a tela e confira novamente.",
            )

        ajuste = calcular_ajuste_contagem(saldo_atual, payload.quantidadeFisicaMl)
        if not ajuste:
            return {
                "alterado": False,
                "saldoAnteriorMl": saldo_atual,
                "saldoAtualMl": saldo_atual,
                "diferencaMl": 0,
                "movimento": None,
            }

        tipo, quantidade = ajuste
        agora = datetime.now(timezone.utc).isoformat()
        motivo = payload.motivo.strip() or "Conferência física"
        doc = {
            "perfumeId": payload.perfumeId,
            "tipo": tipo,
            "quantidadeMl": quantidade,
            "motivo": motivo,
            "categoria": "conferencia-inventario",
            "origem": "conferencia-fisica",
            "saldoAnteriorMl": saldo_atual,
            "saldoEncontradoMl": payload.quantidadeFisicaMl,
            "data": agora,
        }
        resultado = await db.movimentos.insert_one(doc)
        novo = await db.movimentos.find_one({"_id": resultado.inserted_id})
    return {
        "alterado": True,
        "saldoAnteriorMl": saldo_atual,
        "saldoAtualMl": payload.quantidadeFisicaMl,
        "diferencaMl": payload.quantidadeFisicaMl - saldo_atual,
        "movimento": serialize(novo),
    }


@router.delete("/api/movimentos/{movimento_id}")
async def apagar_movimento(movimento_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    try:
        oid = ObjectId(movimento_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de movimento inválido.")
    async with stock_lock(db):
        movimento = await db.movimentos.find_one({"_id": oid})
        if not movimento:
            raise HTTPException(status_code=404, detail="Movimento não encontrado.")
        if movimento.get("anuladoEm"):
            return {"status": "Movimento já estava estornado."}
        origem = str(movimento.get("origem") or "")
        if origem.startswith("pedido:"):
            raise HTTPException(
                status_code=409,
                detail=(
                    "A baixa automática pertence a um pedido. "
                    "Cancele ou corrija o pedido para ajustar o estoque."
                ),
            )
        if movimento.get("categoria") == "estorno":
            raise HTTPException(
                status_code=409,
                detail="Um estorno não pode ser excluído; faça uma nova movimentação de ajuste.",
            )

        agora = datetime.now(timezone.utc).isoformat()
        estorno = {
            "perfumeId": movimento.get("perfumeId"),
            "tipo": "saida" if movimento.get("tipo") == "entrada" else "entrada",
            "quantidadeMl": int(movimento.get("quantidadeMl", 0) or 0),
            "motivo": f"Estorno do movimento {movimento_id}",
            "categoria": "estorno",
            "origem": f"estorno:{movimento_id}",
            "movimentoEstornadoId": movimento_id,
            "data": agora,
        }
        resultado_estorno = await db.movimentos.insert_one(estorno)
        await db.movimentos.update_one(
            {"_id": oid, "anuladoEm": None},
            {"$set": {
                "anuladoEm": agora,
                "anuladoPor": "administrador",
                "estornoMovimentoId": str(resultado_estorno.inserted_id),
            }},
        )
        await registrar_auditoria(
            db,
            acao="estornar",
            recurso="movimento_estoque",
            recurso_id=movimento_id,
            titulo="Movimento de estoque estornado",
            detalhes=(
                f"Lançamento de {movimento.get('quantidadeMl', 0)}ml compensado "
                "por um movimento inverso."
            ),
            metadados={
                "perfumeId": movimento.get("perfumeId"),
                "estornoId": str(resultado_estorno.inserted_id),
            },
        )
    return {"status": "Movimento estornado com histórico preservado."}


@router.get("/api/estoque")
async def mapa_estoque(_: str = Depends(require_atelie_auth)):
    db = get_db()
    mapa: dict[str, int] = {}
    async for linha in db.movimentos.aggregate(_PIPELINE_ESTOQUE):
        mapa[linha["_id"]] = linha["total"]
    return mapa


@router.get("/api/estoque/resumo")
async def resumo_estoque(_: str = Depends(require_atelie_auth)):
    """Separa saldo físico, reservas pendentes e saldo livre para planejamento."""
    db = get_db()
    saldo_atual = await mapa_saldo_fisico(db)
    reservado = await mapa_reservado(db)

    # Todo perfume cadastrado pertence ao estoque, mesmo antes da primeira
    # entrada. Assim itens novos aparecem explicitamente com saldo de 0 ml.
    perfumes = await db.perfumes.find(
        {"arquivadoEm": None}, {"_id": 1}
    ).to_list(100_000)
    ids = {str(perfume["_id"]) for perfume in perfumes} | set(saldo_atual) | set(reservado)
    return {
        perfume_id: {
            "saldoAtualMl": saldo_atual.get(perfume_id, 0),
            "reservadoMl": reservado.get(perfume_id, 0),
            "disponivelMl": saldo_atual.get(perfume_id, 0) - reservado.get(perfume_id, 0),
        }
        for perfume_id in ids
    }
