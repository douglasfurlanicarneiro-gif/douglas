"""Identificação anônima de origem para controles de segurança.

Endereços IP são dados pessoais e não precisam ser persistidos em texto puro
para rate limit ou bloqueio de login. No Render, o tráfego oficial passa pelo
Cloudflare; fora dele, usamos o primeiro endereço válido encaminhado pelo proxy.
"""

import hashlib
import hmac
import ipaddress

from fastapi import Request

from config import JWT_SECRET


def _valid_ip(value: str) -> str | None:
    candidate = value.strip()
    if not candidate:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def client_address(request: Request) -> str:
    cloudflare = _valid_ip(request.headers.get("cf-connecting-ip", ""))
    if cloudflare:
        return cloudflare

    for item in request.headers.get("x-forwarded-for", "").split(","):
        forwarded = _valid_ip(item)
        if forwarded:
            return forwarded

    direct = _valid_ip(request.client.host if request.client else "")
    return direct or "unknown"


def anonymous_client_key(request: Request, scope: str) -> str:
    """Gera chave estável, mas não reversível, sem armazenar o IP bruto."""
    secret = (JWT_SECRET or "lessence-local-rate-limit").encode("utf-8")
    message = f"{scope}|{client_address(request)}".encode("utf-8")
    return hmac.new(secret, message, hashlib.sha256).hexdigest()[:32]
