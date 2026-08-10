"""Geração, validação e restauração criptografada do backup administrativo."""

import asyncio
import hashlib
import json
import os
import tempfile
import zipfile
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path

from bson import ObjectId
from cryptography.exceptions import InvalidTag
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
    "eventos_pagamento",
)

# Limites deliberadamente conservadores para o plano gratuito do Render. O
# catálogo usa URLs de imagens, portanto um backup normal fica muito abaixo
# desses valores e um arquivo hostil não consegue exaurir a memória da API.
MAX_BACKUP_ENCRYPTED_BYTES = 64 * 1024 * 1024
MAX_BACKUP_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
MAX_BACKUP_LINE_BYTES = 2 * 1024 * 1024


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


def descriptografar_e_validar_backup(path: Path, segredo: str) -> tuple[Path, dict]:
    """Autentica, descriptografa e valida integralmente um backup v3."""
    chave = _chave_aes(segredo)
    tamanho = path.stat().st_size
    minimo = len(BACKUP_MAGIC) + 12 + 16
    if tamanho < minimo or tamanho > MAX_BACKUP_ENCRYPTED_BYTES:
        raise ValueError("O arquivo de backup possui tamanho inválido.")

    zip_fd, zip_name = tempfile.mkstemp(prefix="lessence-restore-", suffix=".zip")
    os.close(zip_fd)
    zip_path = Path(zip_name)
    try:
        with path.open("rb") as origem:
            if origem.read(len(BACKUP_MAGIC)) != BACKUP_MAGIC:
                raise ValueError("Este arquivo não é um backup L’Essence válido.")
            nonce = origem.read(12)
            origem.seek(-16, os.SEEK_END)
            tag = origem.read(16)
            inicio_cifrado = len(BACKUP_MAGIC) + 12
            restante = tamanho - inicio_cifrado - 16
            origem.seek(inicio_cifrado)
            decryptor = Cipher(algorithms.AES(chave), modes.GCM(nonce, tag)).decryptor()
            decryptor.authenticate_additional_data(BACKUP_MAGIC)
            with zip_path.open("wb") as destino:
                while restante > 0:
                    bloco = origem.read(min(1024 * 1024, restante))
                    if not bloco:
                        raise ValueError("O arquivo de backup está incompleto.")
                    destino.write(decryptor.update(bloco))
                    restante -= len(bloco)
                destino.write(decryptor.finalize())
    except InvalidTag as exc:
        raise ValueError("Backup adulterado ou chave de criptografia incorreta.") from exc
    except Exception:
        zip_path.unlink(missing_ok=True)
        raise

    try:
        manifesto = _validar_zip_backup(zip_path)
    except Exception:
        zip_path.unlink(missing_ok=True)
        raise
    return zip_path, manifesto


def _validar_zip_backup(zip_path: Path) -> dict:
    try:
        archive = zipfile.ZipFile(zip_path, "r")
    except zipfile.BadZipFile as exc:
        raise ValueError("O conteúdo descriptografado do backup é inválido.") from exc

    with archive:
        lista_nomes = archive.namelist()
        nomes = set(lista_nomes)
        if len(lista_nomes) != len(nomes):
            raise ValueError("O backup contém arquivos internos duplicados.")
        if "manifesto.json" not in nomes:
            raise ValueError("O backup não contém manifesto.")
        try:
            manifesto = json.loads(archive.read("manifesto.json"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ValueError("O manifesto do backup é inválido.") from exc
        if manifesto.get("aplicacao") != "L'Essence Furlani" or manifesto.get("versao") != 3:
            raise ValueError("Versão ou origem do backup não reconhecida.")
        contagens = manifesto.get("colecoes")
        if not isinstance(contagens, dict) or not contagens:
            raise ValueError("O manifesto não informa as coleções do backup.")
        if any(
            not isinstance(nome, str)
            or not isinstance(total, int)
            or isinstance(total, bool)
            or total < 0
            for nome, total in contagens.items()
        ):
            raise ValueError("O manifesto contém contagens inválidas.")
        colecoes = set(contagens)
        if not colecoes.issubset(set(BACKUP_COLLECTIONS)):
            raise ValueError("O backup contém uma coleção não permitida.")
        esperados = {"manifesto.json", *(f"dados/{nome}.ndjson" for nome in colecoes)}
        if nomes != esperados:
            raise ValueError("A estrutura interna do backup não corresponde ao manifesto.")
        tamanho_total = sum(info.file_size for info in archive.infolist())
        if tamanho_total > MAX_BACKUP_UNCOMPRESSED_BYTES:
            raise ValueError("O backup descompactado excede o limite de segurança.")

        for colecao in colecoes:
            total = 0
            with archive.open(f"dados/{colecao}.ndjson") as origem:
                for linha in origem:
                    if len(linha) > MAX_BACKUP_LINE_BYTES:
                        raise ValueError(f"Registro excessivamente grande em {colecao}.")
                    try:
                        documento = json.loads(linha)
                    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                        raise ValueError(f"Registro inválido na coleção {colecao}.") from exc
                    if not isinstance(documento, dict):
                        raise ValueError(f"Registro inválido na coleção {colecao}.")
                    total += 1
            if total != contagens[colecao]:
                raise ValueError(f"A contagem da coleção {colecao} não confere.")
    return manifesto


def carregar_documentos_backup(zip_path: Path, colecao: str) -> list[dict]:
    documentos: list[dict] = []
    with zipfile.ZipFile(zip_path, "r") as archive:
        with archive.open(f"dados/{colecao}.ndjson") as origem:
            for linha in origem:
                documento = json.loads(linha)
                identificador = documento.get("_id")
                if isinstance(identificador, str) and ObjectId.is_valid(identificador):
                    documento["_id"] = ObjectId(identificador)
                documentos.append(documento)
    return documentos


async def restaurar_backup_validado(db, zip_path: Path, manifesto: dict) -> dict:
    """Substitui as coleções do manifesto dentro de uma única transação."""
    colecoes = list(manifesto["colecoes"])
    documentos = {
        colecao: await asyncio.to_thread(carregar_documentos_backup, zip_path, colecao)
        for colecao in colecoes
    }
    async with db.client.start_session() as session:
        async with session.start_transaction():
            for colecao in colecoes:
                await db[colecao].delete_many({}, session=session)
                if documentos[colecao]:
                    await db[colecao].insert_many(
                        documentos[colecao], ordered=True, session=session
                    )
    return {
        "colecoes": {colecao: len(documentos[colecao]) for colecao in colecoes},
        "totalRegistros": sum(len(itens) for itens in documentos.values()),
    }
