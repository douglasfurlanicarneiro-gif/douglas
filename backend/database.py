"""Conexão única e compartilhada com o MongoDB.

Toda rota deve pegar o banco por `get_db()` em vez de criar seu próprio
client — evita abrir uma conexão nova a cada request.
"""
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from config import DB_NAME, MONGO_URL

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        if not MONGO_URL:
            raise RuntimeError(
                "MONGO_URL não configurado. Defina essa variável de ambiente "
                "(no Render: Environment) apontando para o cluster MongoDB."
            )
        _client = AsyncIOMotorClient(
            MONGO_URL,
            serverSelectionTimeoutMS=10_000,
            connectTimeoutMS=10_000,
            socketTimeoutMS=20_000,
        )
    return _client


def get_db() -> AsyncIOMotorDatabase:
    return get_client()[DB_NAME]
