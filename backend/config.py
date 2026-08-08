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
# O usuário é criado quando necessário e a senha é sincronizada no bootstrap.
# Assim, rotacionar ATELIE_ADMIN_PASSWORD no Render atualiza o hash no MongoDB.
ATELIE_ADMIN_USER = os.getenv("ATELIE_ADMIN_USER")
ATELIE_ADMIN_PASSWORD = os.getenv("ATELIE_ADMIN_PASSWORD")

JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "72"))

# --- CORS ---
# Em produção, prefira restringir a origens conhecidas em vez de "*".
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")]

# --- Frete / Melhor Envio ---
# O Sandbox e a produção são ambientes independentes. Para entrar em produção,
# troque a URL e cadastre um novo aplicativo no painel oficial do Melhor Envio.
MELHOR_ENVIO_BASE_URL = os.getenv(
    "MELHOR_ENVIO_BASE_URL",
    "https://sandbox.melhorenvio.com.br",
).rstrip("/")
MELHOR_ENVIO_CLIENT_ID = os.getenv("MELHOR_ENVIO_CLIENT_ID", "")
MELHOR_ENVIO_CLIENT_SECRET = os.getenv("MELHOR_ENVIO_CLIENT_SECRET", "")
MELHOR_ENVIO_REDIRECT_URI = os.getenv(
    "MELHOR_ENVIO_REDIRECT_URI",
    "https://lessence-furlani-api.onrender.com/api/integracoes/melhor-envio/callback",
)
MELHOR_ENVIO_ACCESS_TOKEN = os.getenv("MELHOR_ENVIO_ACCESS_TOKEN", "")
MELHOR_ENVIO_USER_AGENT = os.getenv(
    "MELHOR_ENVIO_USER_AGENT",
    "L'Essence Furlani (contato tecnico configurado no Render)",
)
MELHOR_ENVIO_FROM_CEP = os.getenv("MELHOR_ENVIO_FROM_CEP", "")
MELHOR_ENVIO_ALLOWED_COMPANIES = [
    item.strip()
    for item in os.getenv(
        "MELHOR_ENVIO_ALLOWED_COMPANIES",
        "Jadlog,Buslog,J&T Express,Pegaki",
    ).split(",")
    if item.strip()
]
FRETE_TAXA_EMBALAGEM = float(os.getenv("FRETE_TAXA_EMBALAGEM", "0"))

# --- Pagamentos / InfinitePay ---
# A InfiniteTag pode ser cadastrada pelo painel. A variavel serve como fallback
# para instalacoes que prefiram manter essa configuracao no Render.
INFINITEPAY_HANDLE = os.getenv("INFINITEPAY_HANDLE", "").strip().lstrip("$")
INFINITEPAY_API_URL = os.getenv(
    "INFINITEPAY_API_URL",
    "https://api.checkout.infinitepay.io",
).rstrip("/")
PUBLIC_API_URL = os.getenv(
    "PUBLIC_API_URL",
    "https://lessence-furlani-api.onrender.com",
).rstrip("/")
STOREFRONT_URL = os.getenv(
    "STOREFRONT_URL",
    "https://lessence-furlani-vitrine.onrender.com",
).rstrip("/")
