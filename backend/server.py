"""Entrypoint da API do Contratipos Ateliê.

Deploy no Render: Root Directory = backend, Start Command =
    uvicorn server:app --host 0.0.0.0 --port $PORT

Variáveis de ambiente necessárias (ver config.py):
    MONGO_URL, DB_NAME, JWT_SECRET, ATELIE_ADMIN_USER, ATELIE_ADMIN_PASSWORD,
    CORS_ORIGINS (opcional; por padrão, somente a vitrine oficial e ambiente local)
"""
import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from availability import ensure_initial_ready_delivery
from config import ATELIE_ADMIN_PASSWORD, ATELIE_ADMIN_USER, CORS_ORIGINS
from database import get_db
from locks import stock_lock
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
    """Índices de integridade e desempenho das rotas mais acessadas."""
    db = get_db()
    await db.admins.create_index("usuario", unique=True)
    await db.auth_login_attempts.create_index("expireAt", expireAfterSeconds=0)
    await db.auth_revoked_tokens.create_index("expireAt", expireAfterSeconds=0)
    await db.api_rate_limits.create_index("expiresAt", expireAfterSeconds=0)
    await db.pedidos.create_index("seq")
    await db.pedidos.create_index("status")
    await db.pedidos.create_index(
        "checkoutIdempotencyKey",
        unique=True,
        sparse=True,
    )
    await db.pedidos.create_index("pagamento.transactionNsu", sparse=True)
    await db.pedidos.create_index(
        "codigoAcompanhamento",
        unique=True,
        sparse=True,
    )
    await db.movimentos.create_index("perfumeId")
    await db.movimentos.create_index("origem")
    await db.operacoes_sistema.create_index("data")
    await db.fornecedores.create_index("nome")
    await db.cotacoes_fornecedores.create_index([("fornecedorId", 1), ("data", -1)])
    await db.cotacoes_fornecedores.create_index([("perfumeId", 1), ("data", -1)])
    await db.insumos.create_index([("categoria", 1), ("ativo", -1)])
    await db.insumos.create_index("perfumeId")
    await db.movimentos_insumos.create_index([("insumoId", 1), ("data", -1)])
    await db.producoes.create_index([("perfumeId", 1), ("data", -1)])
    await db.solicitacoes_privacidade.create_index("protocolo", unique=True)
    await db.solicitacoes_privacidade.create_index([("status", 1), ("criadoEm", -1)])


async def _bootstrap_database() -> None:
    """Executa as preparações do banco sem bloquear a abertura da API.

    Antes, essas operações aconteciam antes do ``yield`` do lifespan. Se o
    MongoDB demorasse para responder, o Uvicorn não abria a porta e o Render
    encerrava o deploy com ``no open ports detected``.
    """
    try:
        async with asyncio.timeout(_BOOTSTRAP_TIMEOUT_SECONDS):
            await _seed_admin()
            await _criar_indices()
            db = get_db()
            async with stock_lock(db):
                sequencias_reparadas = await reparar_sequencias(db, "perfumes")
                disponibilidade = await ensure_initial_ready_delivery(db)
            if sequencias_reparadas:
                await vitrine.marcar_vitrine_pendente(db)
    except TimeoutError:
        logger.error(
            "Bootstrap do banco excedeu %ss. A API continuará disponível e "
            "uma nova tentativa ocorrerá no próximo reinício.",
            _BOOTSTRAP_TIMEOUT_SECONDS,
        )
        return
    except Exception:
        # O erro fica registrado nos logs, mas não derruba o servidor web.
        logger.exception(
            "Não foi possível concluir o bootstrap do banco. "
            "A API foi iniciada mesmo assim."
        )
        return

    logger.info(
        "Pronta entrega configurada: %s item(ns), %s não encontrado(s), %s ambíguo(s). "
        "Estoque zerado em %s item(ns) sob encomenda (%s ml).",
        disponibilidade.get("prontaEntrega", 0),
        len(disponibilidade.get("naoEncontrados", [])),
        len(disponibilidade.get("ambiguos", [])),
        disponibilidade.get("estoquesZerados", 0),
        disponibilidade.get("quantidadeZeradaMl", 0),
    )
    if sequencias_reparadas:
        logger.info(
            "%s sequencia(s) duplicada(s) do catalogo foram corrigidas.",
            sequencias_reparadas,
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Agenda o bootstrap e libera imediatamente a inicialização do Uvicorn.
    # Assim o Render detecta a porta mesmo se o MongoDB estiver lento.
    bootstrap_task = asyncio.create_task(
        _bootstrap_database(),
        name="bootstrap-database",
    )
    yield

    if not bootstrap_task.done():
        bootstrap_task.cancel()
        with suppress(asyncio.CancelledError):
            await bootstrap_task


app = FastAPI(title="L’Essence Furlani API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    if request.headers.get("x-atelie-token") or request.url.path.startswith("/api/auth"):
        response.headers.setdefault("Cache-Control", "no-store")
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
async def health():
    """Health check leve, sem depender do MongoDB."""
    return {"status": "ok"}


@app.get("/health/ready")
async def health_ready():
    """Confirma que a API e o MongoDB estão prontos para atender o app."""
    try:
        await asyncio.wait_for(get_db().command("ping"), timeout=5)
    except Exception:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Banco de dados indisponível.")
    return {"status": "ready", "database": "ok"}
