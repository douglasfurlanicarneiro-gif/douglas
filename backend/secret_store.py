"""Criptografia autenticada para credenciais persistidas no MongoDB."""

import base64
import hashlib
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from config import BACKUP_ENCRYPTION_KEY

_PREFIX = "enc:v1:"


class SecretProtectionError(RuntimeError):
    pass


def _key() -> bytes:
    if not BACKUP_ENCRYPTION_KEY:
        raise SecretProtectionError(
            "Configure BACKUP_ENCRYPTION_KEY para proteger credenciais de integração."
        )
    return hashlib.sha256(
        f"lessence-secret-store:v1:{BACKUP_ENCRYPTION_KEY}".encode("utf-8")
    ).digest()


def encrypt_secret(value: str | None, *, context: str) -> str:
    plain = str(value or "")
    if not plain:
        return ""
    nonce = os.urandom(12)
    encrypted = AESGCM(_key()).encrypt(
        nonce,
        plain.encode("utf-8"),
        context.encode("utf-8"),
    )
    payload = base64.urlsafe_b64encode(nonce + encrypted).decode("ascii").rstrip("=")
    return f"{_PREFIX}{payload}"


def decrypt_secret(value: str | None, *, context: str) -> str:
    stored = str(value or "")
    if not stored:
        return ""
    # Compatibilidade com tokens salvos antes da criptografia. Eles serão
    # regravados protegidos na próxima autorização ou renovação.
    if not stored.startswith(_PREFIX):
        return stored
    payload = stored.removeprefix(_PREFIX)
    payload += "=" * (-len(payload) % 4)
    try:
        raw = base64.urlsafe_b64decode(payload.encode("ascii"))
        if len(raw) < 29:
            raise ValueError("payload curto")
        return AESGCM(_key()).decrypt(
            raw[:12],
            raw[12:],
            context.encode("utf-8"),
        ).decode("utf-8")
    except (InvalidTag, UnicodeDecodeError, ValueError) as exc:
        raise SecretProtectionError(
            "Não foi possível ler a credencial protegida. Autorize a integração novamente."
        ) from exc
