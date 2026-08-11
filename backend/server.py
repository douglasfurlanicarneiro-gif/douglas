"""Entrypoint da API do Contratipos Ateliê.

Deploy no Render: Root Directory = backend, Start Command =
    uvicorn server:app --host 0.0.0.0 --port $PORT

Variáveis de ambiente necessárias (ver config.py):
    MONGO_URL, DB_NAME, JWT_SECRET, ATELIE_ADMIN_USER, ATELIE_ADMIN_PASSWORD,
    CORS_ORIGINS (opcional; por padrão, somente a vitrine oficial e ambiente local)
"""
import asyncio
import logging
import time
from uuid import uuid4
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from availability import ensure_initial_ready_delivery
from config import ATELIE_ADMIN_PASSWORD, ATELIE_ADMIN_USER, CORS_ORIGINS, IS_RENDER
from database import close_client, get_db
from database_integrity import ensure_database_schema
from locks import distributed_lock, stock_lock
from routers import (acompanhamento, admin, auth, catalogo_estoque, cep,
                     clientes, compras, custos, fornecedores, frete, insumos,
                     movimentos, opinioes, pagamentos, pedidos, perfumes,
                     privacidade, sugestoes, vitrine)
from security import hash_password, verify_password
from utils import reparar_sequencias

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("atelie")

# O bootstrap acessa o MongoDB e pode levar alguns segundos quando o cluster
# está acordando. Ele não deve impedir o Uvicorn de abrir a porta no Render.
_BOOTSTRAP_TIMEOUT_SECONDS = 120
_PROCESS_STARTED_AT = time.monotonic()
_BOOTSTRAP_STATE = {
    "status": "iniciando",
    "tentativas": 0,
    "erro": None,
}


async def _seed_admin():
    """Cria o usuário administrador na primeira inicialização."""
    if not ATELIE_ADMIN_USER or not ATELIE_ADMIN_PASSWORD:
        logger.warning(
            "ATELIE_ADMIN_USER/ATELIE_ADMIN_PASSWORD não configurados — "
            "o login do Ateliê ficará indisponível até essas variáveis serem definidas."
        )
        return
    db = get_db()
    existente = await db.admins.find_one({"usuario": ATELIE_ADMIN_USER})
    if existente:
        # As credenciais de ambiente são a fonte de verdade. Assim, trocar
        # ATELIE_ADMIN_PASSWORD no Render efetivamente rotaciona a senha no
        # MongoDB no próximo reinício/deploy, em vez de manter o hash antigo.
        senha_hash = existente.get("senhaHash", "")
        if not senha_hash or not verify_password(ATELIE_ADMIN_PASSWORD, senha_hash):
            await db.admins.update_one(
                {"_id": existente["_id"]},
                {
                    "$set": {"senhaHash": hash_password(ATELIE_ADMIN_PASSWORD)},
                    "$inc": {"authVersion": 1},
                },
            )
            logger.info("Senha do administrador sincronizada com a configuração do ambiente.")
        elif "authVersion" not in existente:
            await db.admins.update_one(
                {"_id": existente["_id"]},
                {"$set": {"authVersion": 1}},
            )
        return
    await db.admins.insert_one({
        "usuario": ATELIE_ADMIN_USER,
        "senhaHash": hash_password(ATELIE_ADMIN_PASSWORD),
        "authVersion": 1,
    })
    logger.info("Usuário administrador do Ateliê criado.")


async def _criar_indices():
    """Compatibilidade interna para a aplicação do esquema versionado."""
    return await ensure_database_schema(get_db())


async def _bootstrap_database_once() -> dict:
    """Executa uma tentativa completa e idempotente de preparação."""
    db = get_db()
    # A unicidade deve existir antes do primeiro cadastro. Em uma subida com
    # duas instâncias, ambas podem procurar o usuário ao mesmo tempo; este
    # índice impede que a corrida produza dois administradores iguais.
    await db.admins.create_index("usuario", name="usuario_1", unique=True)
    await _seed_admin()
    # O lease cobre o timeout total desta tentativa e evita que duas
    # instâncias reparem as mesmas sequências simultaneamente durante deploys.
    async with stock_lock(
        db,
        wait_seconds=15,
        lease_seconds=_BOOTSTRAP_TIMEOUT_SECONDS + 30,
    ):
        sequencias_reparadas = await reparar_sequencias(db, "perfumes")
        pedidos_reparados = await reparar_sequencias(db, "pedidos")
        disponibilidade = await ensure_initial_ready_delivery(db)
    # Migrações e índices usam uma trava própria: não bloqueiam o checkout e
    # também não são executados simultaneamente por duas instâncias no deploy.
    async with distributed_lock(
        db,
        "database-schema",
        wait_seconds=15,
        lease_seconds=_BOOTSTRAP_TIMEOUT_SECONDS + 30,
        busy_detail="O esquema do banco está sendo atualizado por outra instância.",
    ):
        esquema = await _criar_indices()
    if sequencias_reparadas:
        await vitrine.marcar_vitrine_pendente(db)
    return {
        "sequenciasReparadas": sequencias_reparadas,
        "pedidosReparados": pedidos_reparados,
        "disponibilidade": disponibilidade,
        "esquema": esquema,
    }


async def _bootstrap_database() -> None:
    """Prepara o banco em segundo plano e se recupera sem reiniciar a API.

    Antes, essas operações aconteciam antes do ``yield`` do lifespan. Se o
    MongoDB demorasse para responder, o Uvicorn não abria a porta e o Render
    encerrava o deploy com ``no open ports detected``. Agora, uma falha
    transitória também é repetida automaticamente dentro do mesmo processo.
    """
    while True:
        _BOOTSTRAP_STATE["tentativas"] += 1
        _BOOTSTRAP_STATE.update(status="iniciando", erro=None)
        try:
            async with asyncio.timeout(_BOOTSTRAP_TIMEOUT_SECONDS):
                resultado = await _bootstrap_database_once()
        except asyncio.CancelledError:
            raise
        except TimeoutError:
            _BOOTSTRAP_STATE.update(status="erro", erro="timeout")
            logger.error(
                "Bootstrap do banco excedeu %ss; uma nova tentativa será feita automaticamente.",
                _BOOTSTRAP_TIMEOUT_SECONDS,
            )
        except Exception as exc:
            _BOOTSTRAP_STATE.update(status="erro", erro=type(exc).__name__)
            logger.exception(
                "Não foi possível concluir o bootstrap do banco; "
                "uma nova tentativa será feita automaticamente."
            )
        else:
            _BOOTSTRAP_STATE.update(status="pronto", erro=None)
            disponibilidade = resultado["disponibilidade"]
            logger.info(
                "Banco pronto no esquema v%s com %s indices. "
                "Pronta entrega: %s item(ns), %s não encontrado(s), %s ambíguo(s).",
                resultado["esquema"]["versao"],
                resultado["esquema"]["indicesConfirmados"],
                disponibilidade.get("prontaEntrega", 0),
                len(disponibilidade.get("naoEncontrados", [])),
                len(disponibilidade.get("ambiguos", [])),
            )
            if resultado["sequenciasReparadas"]:
                logger.info(
                    "%s sequencia(s) duplicada(s) do catalogo foram corrigidas.",
                    resultado["sequenciasReparadas"],
                )
            if resultado["pedidosReparados"]:
                logger.info(
                    "%s sequencia(s) duplicada(s) de pedidos foram corrigidas.",
                    resultado["pedidosReparados"],
                )
            return

        retry_seconds = min(60, 5 * _BOOTSTRAP_STATE["tentativas"])
        await asyncio.sleep(retry_seconds)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Agenda o bootstrap e libera imediatamente a inicialização do Uvicorn.
    # Assim o Render detecta a porta mesmo se o MongoDB estiver lento.
    bootstrap_task = asyncio.create_task(
        _bootstrap_database(),
        name="bootstrap-database",
    )
    payment_reconciliation_task = asyncio.create_task(
        pagamentos.reconciliacao_pagamentos_worker(),
        name="payment-reconciliation",
    )
    yield

    if not bootstrap_task.done():
        bootstrap_task.cancel()
        with suppress(asyncio.CancelledError):
            await bootstrap_task
    if not payment_reconciliation_task.done():
        payment_reconciliation_task.cancel()
        with suppress(asyncio.CancelledError):
            await payment_reconciliation_task
    await close_client()


app = FastAPI(
    title="L’Essence Furlani API",
    lifespan=lifespan,
    docs_url=None if IS_RENDER else "/docs",
    redoc_url=None if IS_RENDER else "/redoc",
    openapi_url=None if IS_RENDER else "/openapi.json",
)

app.add_middleware(GZipMiddleware, minimum_size=1_000, compresslevel=6)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Accept",
        "Content-Type",
        "Idempotency-Key",
        "X-Atelie-Token",
        "X-Request-ID",
    ],
    expose_headers=["X-Request-ID"],
    max_age=600,
)


@app.middleware("http")
async def security_headers(request, call_next):
    request_id = uuid4().hex[:16]
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.perf_counter() - started_at) * 1_000
        logger.exception(
            "request_failed method=%s path=%s duration_ms=%.1f request_id=%s",
            request.method,
            request.url.path,
            elapsed_ms,
            request_id,
        )
        raise
    elapsed_ms = (time.perf_counter() - started_at) * 1_000
    if request.url.path not in {"/health", "/health/ready"}:
        logger.info(
            "request method=%s path=%s status=%s duration_ms=%.1f request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )
    response.headers.setdefault("X-Request-ID", request_id)
    response.headers.setdefault("Server-Timing", f'app;dur={elapsed_ms:.1f}')
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    )
    if (
        request.headers.get("x-atelie-token")
        or request.url.path.startswith(("/api/auth", "/api/admin"))
        or response.status_code in {401, 403}
    ):
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault("Pragma", "no-cache")
    return response

app.include_router(auth.router)
app.include_router(catalogo_estoque.router)
app.include_router(cep.router)
app.include_router(perfumes.router)
app.include_router(movimentos.router)
app.include_router(pedidos.router)
app.include_router(opinioes.router)
app.include_router(pagamentos.router)
app.include_router(sugestoes.router)
app.include_router(compras.router)
app.include_router(custos.router)
app.include_router(fornecedores.router)
app.include_router(insumos.router)
app.include_router(frete.router)
app.include_router(vitrine.router)
app.include_router(clientes.router)
app.include_router(acompanhamento.router)
app.include_router(privacidade.router)
app.include_router(admin.router)


@app.get("/")
async def raiz():
    return {"status": "ok", "servico": "L’Essence Furlani API"}


@app.get("/health")
async def health(response: Response):
    """Health check leve, sem depender do MongoDB."""
    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "ok",
        "uptimeSeconds": round(time.monotonic() - _PROCESS_STARTED_AT, 1),
    }


@app.get("/health/ready")
async def health_ready(response: Response):
    """Confirma que a API e o MongoDB estão prontos para atender o app."""
    started_at = time.perf_counter()
    try:
        await asyncio.wait_for(get_db().command("ping"), timeout=5)
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Banco de dados indisponível.")
    database_latency_ms = (time.perf_counter() - started_at) * 1_000
    if _BOOTSTRAP_STATE["status"] != "pronto":
        from fastapi import HTTPException
        detail = (
            "Inicialização segura do banco em andamento."
            if _BOOTSTRAP_STATE["status"] == "iniciando"
            else "Integridade do banco ainda não confirmada. Nova tentativa em andamento."
        )
        raise HTTPException(
            status_code=503,
            detail={
                "message": detail,
                "code": _BOOTSTRAP_STATE.get("erro") or "EM_ANDAMENTO",
                "attempts": int(_BOOTSTRAP_STATE.get("tentativas", 0)),
            },
            headers={"Cache-Control": "no-store", "Retry-After": "5"},
        )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Server-Timing"] = f'database;dur={database_latency_ms:.1f}'
    return {
        "status": "ready",
        "database": "ok",
        "databaseSchema": "ok",
        "bootstrapAttempts": _BOOTSTRAP_STATE["tentativas"],
        "databaseLatencyMs": round(database_latency_ms, 1),
        "uptimeSeconds": round(time.monotonic() - _PROCESS_STARTED_AT, 1),
    }
