"""Entrypoint da API do Contratipos Ateliê.

Deploy no Render: Root Directory = backend, Start Command =
    uvicorn server:app --host 0.0.0.0 --port $PORT

Variáveis de ambiente necessárias (ver config.py):
    MONGO_URL, DB_NAME, JWT_SECRET, ATELIE_ADMIN_USER, ATELIE_ADMIN_PASSWORD,
    CORS_ORIGINS (opcional, default "*")
"""
import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from availability import ensure_initial_ready_delivery
from config import ATELIE_ADMIN_PASSWORD, ATELIE_ADMIN_USER, CORS_ORIGINS
from database import get_db
from routers import (
    acompanhamento,
    admin,
    auth,
    catalogo_estoque,
    cep,
    clientes,
    compras,
    frete,
    movimentos,
    opinioes,
    pedidos,
    perfumes,
    sugestoes,
    vitrine,
)
from security import hash_password

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
        return
    await db.admins.insert_one({
        "usuario": ATELIE_ADMIN_USER,
        "senhaHash": hash_password(ATELIE_ADMIN_PASSWORD),
    })
    logger.info("Usuário administrador do Ateliê criado.")


async def _criar_indices():
    """Índices de integridade e desempenho das rotas mais acessadas."""
    db = get_db()
    await db.admins.create_index("usuario", unique=True)
    await db.pedidos.create_index("seq")
    await db.pedidos.create_index("status")
    await db.pedidos.create_index(
        "codigoAcompanhamento",
        unique=True,
        sparse=True,
    )
    await db.movimentos.create_index("perfumeId")
    await db.movimentos.create_index("origem")
    await db.operacoes_sistema.create_index("data")


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
            disponibilidade = await ensure_initial_ready_delivery(get_db())
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

app.include_router(auth.router)
app.include_router(catalogo_estoque.router)
app.include_router(cep.router)
app.include_router(perfumes.router)
app.include_router(movimentos.router)
app.include_router(pedidos.router)
app.include_router(opinioes.router)
app.include_router(sugestoes.router)
app.include_router(compras.router)
app.include_router(frete.router)
app.include_router(vitrine.router)
app.include_router(clientes.router)
app.include_router(acompanhamento.router)
app.include_router(admin.router)


@app.get("/")
async def raiz():
    return {"status": "ok", "servico": "L’Essence Furlani API"}


@app.get("/health")
async def health():
    """Health check leve, sem depender do MongoDB."""
    return {"status": "ok"}
