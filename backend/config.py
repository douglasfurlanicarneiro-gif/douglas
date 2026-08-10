"""Configuração central da API — tudo lido de variáveis de ambiente.

Nenhum segredo (senha, chave JWT) deve ser hardcoded no código: sempre
configure essas variáveis no Render (ou no .env local, nunca versionado).
"""
import os

from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / ".env")

# O Render define esta variavel automaticamente. Recursos de desenvolvimento
# como a documentacao interativa da API ficam disponiveis apenas localmente.
IS_RENDER = os.getenv("RENDER", "").strip().casefold() == "true"

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
JWT_EXPIRE_HOURS = min(24, max(1, int(os.getenv("JWT_EXPIRE_HOURS", "12"))))
BACKUP_ENCRYPTION_KEY = os.getenv("BACKUP_ENCRYPTION_KEY", "") or (JWT_SECRET or "")

# --- CORS ---
# O padrão já é restrito à vitrine oficial e aos endereços de desenvolvimento.
# Instalações com outro domínio devem informar CORS_ORIGINS explicitamente.
_DEFAULT_CORS_ORIGINS = ",".join((
    "https://lessence-furlani-vitrine.onrender.com",
    "http://localhost:8081",
    "http://localhost:8082",
))
CORS_ORIGINS = [
    origem.strip()
    for origem in os.getenv("CORS_ORIGINS", _DEFAULT_CORS_ORIGINS).split(",")
    if origem.strip()
]

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
INFINITEPAY_WEBHOOK_SECRET = os.getenv("INFINITEPAY_WEBHOOK_SECRET", "") or (
    JWT_SECRET or ""
)
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
