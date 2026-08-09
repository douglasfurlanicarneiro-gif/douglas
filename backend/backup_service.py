"""Geração incremental e criptografada do backup administrativo."""

import hashlib
import json
import os
import tempfile
import zipfile
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


BACKUP_MAGIC = b"LESSENCE-BACKUP-V3\x00"
BACKUP_COLLECTIONS = (
    "perfumes",
    "movimentos",
    "pedidos",
    "clientes",
    "opinioes",
    "sugestoes",
    "compras",
    "operacoes_sistema",
    "fornecedores",
    "cotacoes_fornecedores",
    "insumos",
    "movimentos_insumos",
    "producoes",
    "configuracoes",
    "vitrine",
    "solicitacoes_privacidade",
)


def _json_seguro(valor):
    from bson import ObjectId

    if isinstance(valor, ObjectId):
        return str(valor)
    if isinstance(valor, datetime):
        return valor.isoformat()
    if isinstance(valor, dict):
        return {chave: _json_seguro(item) for chave, item in valor.items()}
    if isinstance(valor, list):
        return [_json_seguro(item) for item in valor]
    return valor


def _chave_aes(segredo: str) -> bytes:
    if len(segredo.strip()) < 32:
        raise ValueError("A chave de backup precisa ter pelo menos 32 caracteres.")
    return hashlib.sha256(
        f"lessence-backup-v3|{segredo}".encode("utf-8")
    ).digest()


async def gerar_backup_criptografado(db, segredo: str) -> tuple[Path, dict]:
    """Cria ZIP interno por cursor e o cifra em AES-256-GCM por blocos."""
    chave = _chave_aes(segredo)
    plain_fd, plain_name = tempfile.mkstemp(prefix="lessence-backup-", suffix=".zip")
    encrypted_fd, encrypted_name = tempfile.mkstemp(
        prefix="lessence-backup-", suffix=".lfe"
    )
    os.close(plain_fd)
    os.close(encrypted_fd)
    plain_path = Path(plain_name)
    encrypted_path = Path(encrypted_name)
    gerado_em = datetime.now(timezone.utc).isoformat()
    contagens: dict[str, int] = {}

    try:
        with zipfile.ZipFile(
            plain_path,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        ) as archive:
            for colecao in BACKUP_COLLECTIONS:
                total = 0
                with archive.open(f"dados/{colecao}.ndjson", "w") as destino:
                    async for documento in db[colecao].find({}):
                        linha = json.dumps(
                            _json_seguro(documento),
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ).encode("utf-8")
                        destino.write(linha + b"\n")
                        total += 1
                contagens[colecao] = total
            manifesto = {
                "aplicacao": "L'Essence Furlani",
                "geradoEm": gerado_em,
                "versao": 3,
                "formato": "ndjson-em-zip-cifrado-aes-256-gcm",
                "colecoes": contagens,
            }
            archive.writestr(
                "manifesto.json",
                json.dumps(manifesto, ensure_ascii=False, indent=2).encode("utf-8"),
            )

        nonce = os.urandom(12)
        encryptor = Cipher(algorithms.AES(chave), modes.GCM(nonce)).encryptor()
        encryptor.authenticate_additional_data(BACKUP_MAGIC)
        with plain_path.open("rb") as origem, encrypted_path.open("wb") as destino:
            destino.write(BACKUP_MAGIC)
            destino.write(nonce)
            while bloco := origem.read(1024 * 1024):
                destino.write(encryptor.update(bloco))
            destino.write(encryptor.finalize())
            destino.write(encryptor.tag)
    except Exception:
        encrypted_path.unlink(missing_ok=True)
        raise
    finally:
        plain_path.unlink(missing_ok=True)

    return encrypted_path, {
        "geradoEm": gerado_em,
        "colecoes": contagens,
        "tamanhoBytes": encrypted_path.stat().st_size,
    }


async def transmitir_e_remover(path: Path) -> AsyncIterator[bytes]:
    try:
        with path.open("rb") as arquivo:
            while bloco := arquivo.read(1024 * 1024):
                yield bloco
    finally:
        path.unlink(missing_ok=True)
