"""Configuração central da API — tudo lido de variáveis de ambiente.

Nenhum segredo (senha, chave JWT) deve ser hardcoded no código: sempre
configure essas variáveis no Render (ou no .env local, nunca versionado).
"""
import os

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

# --- Banco de dados ---
MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("DB_NAME", "atelier_perfumes")

# --- Autenticação do Ateliê ---
# Usadas apenas na primeira inicialização, para criar o usuário admin caso
# a coleção `admins` ainda esteja vazia (ver server.py -> _seed_admin).
ATELIE_ADMIN_USER = os.getenv("ATELIE_ADMIN_USER")
ATELIE_ADMIN_PASSWORD = os.getenv("ATELIE_ADMIN_PASSWORD")

JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "72"))

# --- CORS ---
# Em produção, prefira restringir a origens conhecidas em vez de "*".
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")]
