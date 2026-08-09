import asyncio
import re

import requests
from fastapi import APIRouter, Depends, HTTPException

from rate_limit import cep_rate_limit

router = APIRouter(prefix="/api/cep", tags=["cep"])


@router.get("/{cep}", dependencies=[Depends(cep_rate_limit)])
async def consultar_cep(cep: str):
    cep_limpo = re.sub(r"\D", "", cep)
    if len(cep_limpo) != 8:
        raise HTTPException(status_code=422, detail="Informe um CEP com 8 números.")

    def buscar():
        resposta = requests.get(
            f"https://viacep.com.br/ws/{cep_limpo}/json/",
            timeout=8,
        )
        resposta.raise_for_status()
        return resposta.json()

    try:
        dados = await asyncio.to_thread(buscar)
    except (requests.RequestException, ValueError):
        raise HTTPException(status_code=502, detail="Não foi possível consultar o CEP agora.")

    if dados.get("erro"):
        raise HTTPException(status_code=404, detail="CEP não encontrado.")

    return {
        "cep": cep_limpo,
        "endereco": dados.get("logradouro", ""),
        "bairro": dados.get("bairro", ""),
        "cidade": dados.get("localidade", ""),
        "estado": dados.get("uf", ""),
    }
