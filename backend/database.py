"""Conexão única e compartilhada com o MongoDB.

Toda rota deve pegar o banco por `get_db()` em vez de criar seu próprio
client — evita abrir uma conexão nova a cada request.
"""
from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from config import DB_NAME, MONGO_URL

_client: AsyncMongoClient | None = None


def get_client() -> AsyncMongoClient:
    global _client
    if _client is None:
        if not MONGO_URL:
            raise RuntimeError(
                "MONGO_URL não configurado. Defina essa variável de ambiente "
                "(no Render: Environment) apontando para o cluster MongoDB."
            )
        _client = AsyncMongoClient(
            MONGO_URL,
            serverSelectionTimeoutMS=10_000,
            connectTimeoutMS=10_000,
            socketTimeoutMS=20_000,
        )
    return _client


def get_db() -> AsyncDatabase:
    return get_client()[DB_NAME]


async def close_client() -> None:
    """Fecha o pool compartilhado durante o encerramento do servidor."""
    global _client
    if _client is not None:
        await _client.close()
        _client = None
