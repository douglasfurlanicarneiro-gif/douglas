"""Entrypoint da API do Contratipos Ateliê.

Deploy no Render: Root Directory = backend, Start Command =
    uvicorn server:app --host 0.0.0.0 --port $PORT

Variáveis de ambiente necessárias (ver config.py):
    MONGO_URL, DB_NAME, JWT_SECRET, ATELIE_ADMIN_USER, ATELIE_ADMIN_PASSWORD,
    CORS_ORIGINS (opcional, default "*")
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import ATELIE_ADMIN_PASSWORD, ATELIE_ADMIN_USER, CORS_ORIGINS
from database import get_db
from routers import auth, clientes, compras, movimentos, opinioes, pedidos, perfumes, sugestoes, vitrine
from security import hash_password

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("atelie")


async def _seed_admin():
    """Cria o usuário administrador do Ateliê na primeira inicialização,
    lendo ATELIE_ADMIN_USER/ATELIE_ADMIN_PASSWORD do ambiente. A senha nunca
    é guardada em texto puro — só o hash bcrypt."""
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


@asynccontextmanager
async def lifespan(_: FastAPI):
    await _seed_admin()
    yield


app = FastAPI(title="L’Essence Furlani API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(perfumes.router)
app.include_router(movimentos.router)
app.include_router(pedidos.router)
app.include_router(opinioes.router)
app.include_router(sugestoes.router)
app.include_router(compras.router)
app.include_router(vitrine.router)
app.include_router(clientes.router)


@app.get("/")
async def raiz():
    return {"status": "ok", "servico": "L’Essence Furlani API"}
