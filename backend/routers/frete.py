from html import escape
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from database import get_db
from security import require_atelie_auth
from shipping.melhor_envio import (
    MelhorEnvioError,
    configuracao_frete,
    cotar_frete,
    criar_url_autorizacao,
    salvar_configuracao_frete,
    status_integracao,
    trocar_codigo_por_token,
)

router = APIRouter(tags=["frete"])


class ItemFreteIn(BaseModel):
    perfumeId: str
    ml: int = Field(gt=0, le=1000)
    quantidade: int = Field(gt=0, le=20)


class CotacaoFreteIn(BaseModel):
    cepDestino: str = Field(min_length=8, max_length=9)
    itens: list[ItemFreteIn] = Field(min_length=1, max_length=50)


class ConfiguracaoFreteIn(BaseModel):
    taxaEmbalagem: float = Field(ge=0, le=1000)
    cepOrigem: str = Field(min_length=8, max_length=9)


async def itens_para_cotacao(db, itens: list[ItemFreteIn]) -> list[dict[str, Any]]:
    try:
        ids = [ObjectId(item.perfumeId) for item in itens]
    except InvalidId as exc:
        raise HTTPException(status_code=400, detail="Um dos produtos possui id inválido.") from exc
    perfumes = await db.perfumes.find({"_id": {"$in": ids}}).to_list(len(ids))
    perfumes_por_id = {str(perfume["_id"]): perfume for perfume in perfumes}
    resultado = []
    for item in itens:
        perfume = perfumes_por_id.get(item.perfumeId)
        if not perfume or perfume.get("publicavel") is False:
            raise HTTPException(status_code=404, detail="Produto não encontrado na vitrine.")
        opcao = next(
            (preco for preco in perfume.get("precos", []) if preco.get("ml") == item.ml),
            None,
        )
        if not opcao or float(opcao.get("preco", 0)) <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"Tamanho indisponível para {perfume['nome']}.",
            )
        resultado.append(
            {
                "perfumeId": item.perfumeId,
                "ml": item.ml,
                "quantidade": item.quantidade,
                "precoUnitario": float(opcao["preco"]),
            }
        )
    return resultado


@router.post("/api/frete/cotar")
async def cotar(payload: CotacaoFreteIn):
    db = get_db()
    itens = await itens_para_cotacao(db, payload.itens)
    try:
        opcoes = await cotar_frete(
            db,
            cep_destino=payload.cepDestino,
            itens=itens,
        )
    except MelhorEnvioError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    if not opcoes:
        raise HTTPException(
            status_code=404,
            detail="Não encontramos uma transportadora disponível para perfume neste CEP.",
        )
    return {"opcoes": opcoes}


@router.get("/api/frete/configuracao")
async def obter_configuracao(_: str = Depends(require_atelie_auth)):
    db = get_db()
    config = await configuracao_frete(db)
    return {**config, **(await status_integracao(db))}


@router.put("/api/frete/configuracao")
async def atualizar_configuracao(
    payload: ConfiguracaoFreteIn,
    _: str = Depends(require_atelie_auth),
):
    cep = "".join(char for char in payload.cepOrigem if char.isdigit())
    if len(cep) != 8:
        raise HTTPException(status_code=400, detail="Informe um CEP de origem válido.")
    db = get_db()
    config = await salvar_configuracao_frete(
        db,
        taxa_embalagem=payload.taxaEmbalagem,
        cep_origem=cep,
    )
    return {**config, **(await status_integracao(db))}


@router.post("/api/integracoes/melhor-envio/autorizar")
async def autorizar_melhor_envio(_: str = Depends(require_atelie_auth)):
    try:
        url = await criar_url_autorizacao(get_db())
    except MelhorEnvioError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return {"url": url}


@router.get(
    "/api/integracoes/melhor-envio/callback",
    response_class=HTMLResponse,
)
async def callback_melhor_envio(
    code: str = Query(min_length=1),
    state: str = Query(min_length=1),
):
    try:
        await trocar_codigo_por_token(get_db(), code, state)
    except MelhorEnvioError as exc:
        message = escape(str(exc))
        return HTMLResponse(
            f"<html><body style='font-family:sans-serif;background:#11100d;color:#f2eadf;"
            f"padding:40px'><h1>Não foi possível conectar</h1><p>{message}</p></body></html>",
            status_code=exc.status_code,
        )
    return HTMLResponse(
        "<html><body style='font-family:sans-serif;background:#11100d;color:#f2eadf;"
        "padding:40px;text-align:center'><h1 style='color:#d7ad5c'>Melhor Envio conectado</h1>"
        "<p>A integração de frete da L’Essence Furlani foi autorizada com sucesso.</p>"
        "<p>Você já pode fechar esta janela.</p></body></html>"
    )
