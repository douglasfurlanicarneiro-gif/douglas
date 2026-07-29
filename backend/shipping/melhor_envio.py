"""Cliente seguro para cotação e OAuth do Melhor Envio.

Tokens ficam no banco ou em variáveis de ambiente e nunca são enviados ao
frontend. Toda cotação escolhida pelo cliente é refeita no servidor antes da
criação do pedido.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import secrets
from typing import Any
from urllib.parse import urlencode

import requests

from config import (
    FRETE_TAXA_EMBALAGEM,
    MELHOR_ENVIO_ACCESS_TOKEN,
    MELHOR_ENVIO_ALLOWED_COMPANIES,
    MELHOR_ENVIO_BASE_URL,
    MELHOR_ENVIO_CLIENT_ID,
    MELHOR_ENVIO_CLIENT_SECRET,
    MELHOR_ENVIO_FROM_CEP,
    MELHOR_ENVIO_REDIRECT_URI,
    MELHOR_ENVIO_USER_AGENT,
)

INTEGRATION_ID = "melhor_envio"
OAUTH_SCOPES = "shipping-calculate"


class MelhorEnvioError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


def _headers(token: str | None = None) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "User-Agent": MELHOR_ENVIO_USER_AGENT,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["Content-Type"] = "application/json"
    return headers


def _request(method: str, url: str, **kwargs: Any) -> requests.Response:
    try:
        response = requests.request(method, url, timeout=20, **kwargs)
    except requests.RequestException as exc:
        raise MelhorEnvioError(
            "Não foi possível consultar a transportadora agora. Tente novamente em instantes."
        ) from exc
    return response


async def _run_request(method: str, url: str, **kwargs: Any) -> requests.Response:
    return await asyncio.to_thread(_request, method, url, **kwargs)


async def configuracao_frete(db) -> dict[str, Any]:
    saved = await db.configuracoes.find_one({"_id": "frete"})
    return {
        "taxaEmbalagem": round(
            float((saved or {}).get("taxaEmbalagem", FRETE_TAXA_EMBALAGEM)),
            2,
        ),
        "cepOrigem": str((saved or {}).get("cepOrigem", MELHOR_ENVIO_FROM_CEP)),
    }


async def salvar_configuracao_frete(
    db,
    *,
    taxa_embalagem: float,
    cep_origem: str,
) -> dict[str, Any]:
    await db.configuracoes.update_one(
        {"_id": "frete"},
        {
            "$set": {
                "taxaEmbalagem": round(taxa_embalagem, 2),
                "cepOrigem": cep_origem,
                "atualizadoEm": datetime.now(timezone.utc).isoformat(),
            }
        },
        upsert=True,
    )
    return await configuracao_frete(db)


async def criar_url_autorizacao(db) -> str:
    if not MELHOR_ENVIO_CLIENT_ID or not MELHOR_ENVIO_CLIENT_SECRET:
        raise MelhorEnvioError(
            "Cadastre o Client ID e o Client Secret do Melhor Envio no Render.",
            503,
        )
    state = secrets.token_urlsafe(32)
    await db.oauth_states.insert_one(
        {
            "provider": INTEGRATION_ID,
            "state": state,
            "expiraEm": datetime.now(timezone.utc) + timedelta(minutes=15),
        }
    )
    query = urlencode(
        {
            "client_id": MELHOR_ENVIO_CLIENT_ID,
            "redirect_uri": MELHOR_ENVIO_REDIRECT_URI,
            "response_type": "code",
            "state": state,
            "scope": OAUTH_SCOPES,
        }
    )
    return f"{MELHOR_ENVIO_BASE_URL}/oauth/authorize?{query}"


async def trocar_codigo_por_token(db, code: str, state: str) -> None:
    agora = datetime.now(timezone.utc)
    state_doc = await db.oauth_states.find_one_and_delete(
        {
            "provider": INTEGRATION_ID,
            "state": state,
            "expiraEm": {"$gt": agora},
        }
    )
    if not state_doc:
        raise MelhorEnvioError(
            "A autorização expirou ou não é válida. Inicie novamente pelo Painel de Controle.",
            400,
        )
    response = await _run_request(
        "POST",
        f"{MELHOR_ENVIO_BASE_URL}/oauth/token",
        headers=_headers(),
        data={
            "grant_type": "authorization_code",
            "client_id": MELHOR_ENVIO_CLIENT_ID,
            "client_secret": MELHOR_ENVIO_CLIENT_SECRET,
            "redirect_uri": MELHOR_ENVIO_REDIRECT_URI,
            "code": code,
        },
    )
    if not response.ok:
        raise MelhorEnvioError(
            "O Melhor Envio não aceitou a autorização. Confira o aplicativo e tente novamente.",
            400,
        )
    await _salvar_tokens(db, response.json())


async def _salvar_tokens(db, payload: dict[str, Any]) -> None:
    expires_in = int(payload.get("expires_in", 2_592_000))
    await db.integracoes.update_one(
        {"_id": INTEGRATION_ID},
        {
            "$set": {
                "accessToken": payload["access_token"],
                "refreshToken": payload.get("refresh_token"),
                "tokenType": payload.get("token_type", "Bearer"),
                "expiraEm": datetime.now(timezone.utc)
                + timedelta(seconds=max(60, expires_in)),
                "atualizadoEm": datetime.now(timezone.utc).isoformat(),
            }
        },
        upsert=True,
    )


async def _renovar_token(db, refresh_token: str) -> str:
    response = await _run_request(
        "POST",
        f"{MELHOR_ENVIO_BASE_URL}/oauth/token",
        headers=_headers(),
        data={
            "grant_type": "refresh_token",
            "client_id": MELHOR_ENVIO_CLIENT_ID,
            "client_secret": MELHOR_ENVIO_CLIENT_SECRET,
            "refresh_token": refresh_token,
        },
    )
    if not response.ok:
        raise MelhorEnvioError(
            "A integração do frete precisa ser autorizada novamente no Painel de Controle.",
            503,
        )
    payload = response.json()
    await _salvar_tokens(db, payload)
    return str(payload["access_token"])


async def obter_access_token(db) -> str:
    if MELHOR_ENVIO_ACCESS_TOKEN:
        return MELHOR_ENVIO_ACCESS_TOKEN
    integration = await db.integracoes.find_one({"_id": INTEGRATION_ID})
    if not integration or not integration.get("accessToken"):
        raise MelhorEnvioError(
            "O cálculo de entrega está em configuração. Tente novamente em breve.",
            503,
        )
    expira_em = integration.get("expiraEm")
    if isinstance(expira_em, datetime):
        if expira_em.tzinfo is None:
            expira_em = expira_em.replace(tzinfo=timezone.utc)
        if expira_em <= datetime.now(timezone.utc) + timedelta(minutes=5):
            refresh_token = integration.get("refreshToken")
            if not refresh_token:
                raise MelhorEnvioError(
                    "A integração do frete precisa ser autorizada novamente.",
                    503,
                )
            return await _renovar_token(db, str(refresh_token))
    return str(integration["accessToken"])


def _dimensoes_produto(ml: int) -> tuple[int, int, int, float]:
    """Dimensões conservadoras, configuráveis futuramente por embalagem."""
    if ml <= 30:
        return 8, 13, 8, 0.25
    if ml <= 50:
        return 9, 16, 9, 0.35
    return 10, 20, 10, 0.55


def _normalizar_nome(value: str) -> str:
    return "".join(char.lower() for char in value if char.isalnum())


def _empresa_permitida(nome: str) -> bool:
    nome_normalizado = _normalizar_nome(nome)
    return any(
        _normalizar_nome(permitida) in nome_normalizado
        or nome_normalizado in _normalizar_nome(permitida)
        for permitida in MELHOR_ENVIO_ALLOWED_COMPANIES
    )


async def cotar_frete(
    db,
    *,
    cep_destino: str,
    itens: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    config = await configuracao_frete(db)
    cep_origem = "".join(char for char in config["cepOrigem"] if char.isdigit())
    cep_destino = "".join(char for char in cep_destino if char.isdigit())
    if len(cep_origem) != 8:
        raise MelhorEnvioError(
            "O CEP de origem ainda não foi configurado no Painel de Controle.",
            503,
        )
    if len(cep_destino) != 8:
        raise MelhorEnvioError("Informe um CEP válido para calcular a entrega.", 400)

    products = []
    for item in itens:
        ml = int(item["ml"])
        width, height, length, weight = _dimensoes_produto(ml)
        products.append(
            {
                "id": str(item["perfumeId"]),
                "width": width,
                "height": height,
                "length": length,
                "weight": weight,
                "insurance_value": round(float(item["precoUnitario"]), 2),
                "quantity": int(item["quantidade"]),
            }
        )

    token = await obter_access_token(db)
    response = await _run_request(
        "POST",
        f"{MELHOR_ENVIO_BASE_URL}/api/v2/me/shipment/calculate",
        headers=_headers(token),
        json={
            "from": {"postal_code": cep_origem},
            "to": {"postal_code": cep_destino},
            "products": products,
            "options": {"receipt": False, "own_hand": False},
        },
    )
    if response.status_code == 401:
        integration = await db.integracoes.find_one({"_id": INTEGRATION_ID})
        refresh_token = (integration or {}).get("refreshToken")
        if refresh_token and not MELHOR_ENVIO_ACCESS_TOKEN:
            token = await _renovar_token(db, str(refresh_token))
            response = await _run_request(
                "POST",
                f"{MELHOR_ENVIO_BASE_URL}/api/v2/me/shipment/calculate",
                headers=_headers(token),
                json={
                    "from": {"postal_code": cep_origem},
                    "to": {"postal_code": cep_destino},
                    "products": products,
                    "options": {"receipt": False, "own_hand": False},
                },
            )
    if not response.ok:
        raise MelhorEnvioError(
            "Não foi possível calcular a entrega para este CEP agora.",
            502,
        )

    taxa = round(float(config["taxaEmbalagem"]), 2)
    opcoes: list[dict[str, Any]] = []
    for raw in response.json():
        if raw.get("error"):
            continue
        empresa = str((raw.get("company") or {}).get("name") or "")
        if not empresa or not _empresa_permitida(empresa):
            continue
        preco_transportadora = float(raw.get("custom_price") or raw.get("price") or 0)
        if preco_transportadora <= 0:
            continue
        prazo = int(
            raw.get("custom_delivery_time")
            or raw.get("delivery_time")
            or 0
        )
        opcoes.append(
            {
                "serviceId": int(raw["id"]),
                "transportadora": empresa,
                "servico": str(raw.get("name") or "Entrega"),
                "precoTransportadora": round(preco_transportadora, 2),
                "taxaEmbalagem": taxa,
                "preco": round(preco_transportadora + taxa, 2),
                "prazoDias": prazo,
            }
        )
    return sorted(opcoes, key=lambda item: (item["preco"], item["prazoDias"]))


async def status_integracao(db) -> dict[str, Any]:
    integration = await db.integracoes.find_one({"_id": INTEGRATION_ID})
    return {
        "integrado": bool(MELHOR_ENVIO_ACCESS_TOKEN or (integration or {}).get("accessToken")),
        "aplicativoConfigurado": bool(
            MELHOR_ENVIO_CLIENT_ID and MELHOR_ENVIO_CLIENT_SECRET
        ),
        "ambiente": (
            "sandbox"
            if "sandbox" in MELHOR_ENVIO_BASE_URL.lower()
            else "producao"
        ),
    }
