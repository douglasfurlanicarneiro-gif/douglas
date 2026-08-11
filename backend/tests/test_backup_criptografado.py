import asyncio
import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone

import pytest
from bson import ObjectId
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from backup_service import (
    BACKUP_COLLECTIONS,
    BACKUP_MAGIC,
    descriptografar_e_validar_backup,
    gerar_backup_criptografado,
    restaurar_backup_validado,
)


class CursorAssincrono:
    def __init__(self, documentos):
        self._documentos = iter(documentos)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._documentos)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class ColecaoFalsa:
    def __init__(self, documentos):
        self._documentos = documentos

    def find(self, _filtro):
        return CursorAssincrono(self._documentos)


class BancoFalso:
    def __init__(self):
        self._colecoes = {
            nome: ColecaoFalsa([]) for nome in BACKUP_COLLECTIONS
        }
        self.cliente_id = ObjectId()
        self._colecoes["clientes"] = ColecaoFalsa([
            {
                "_id": self.cliente_id,
                "nome": "Cliente Sigiloso",
                "email": "privado@example.com",
                "atualizadoEm": datetime(2026, 8, 11, 12, 30, tzinfo=timezone.utc),
            },
        ])

    def __getitem__(self, nome):
        return self._colecoes[nome]


def _descriptografar(conteudo: bytes, segredo: str) -> bytes:
    nonce_inicio = len(BACKUP_MAGIC)
    nonce = conteudo[nonce_inicio:nonce_inicio + 12]
    tag = conteudo[-16:]
    cifrado = conteudo[nonce_inicio + 12:-16]
    chave = hashlib.sha256(
        f"lessence-backup-v3|{segredo}".encode("utf-8")
    ).digest()
    decryptor = Cipher(algorithms.AES(chave), modes.GCM(nonce, tag)).decryptor()
    decryptor.authenticate_additional_data(BACKUP_MAGIC)
    return decryptor.update(cifrado) + decryptor.finalize()


def test_backup_nao_expoe_dados_e_contem_manifesto_e_colecoes():
    segredo = "segredo-de-backup-com-mais-de-trinta-e-dois-caracteres"
    caminho, resumo = asyncio.run(
        gerar_backup_criptografado(BancoFalso(), segredo)
    )
    try:
        conteudo = caminho.read_bytes()
        assert conteudo.startswith(BACKUP_MAGIC)
        assert b"privado@example.com" not in conteudo
        assert resumo["colecoes"]["clientes"] == 1

        zip_bytes = _descriptografar(conteudo, segredo)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
            manifesto = json.loads(archive.read("manifesto.json"))
            cliente = json.loads(
                archive.read("dados/clientes.ndjson").decode("utf-8")
            )
        assert manifesto["versao"] == 3
        assert manifesto["colecoes"]["clientes"] == 1
        assert cliente["email"] == "privado@example.com"
    finally:
        caminho.unlink(missing_ok=True)


def test_backup_valida_autenticidade_e_rejeita_chave_incorreta_ou_adulteracao():
    segredo = "segredo-de-backup-com-mais-de-trinta-e-dois-caracteres"
    caminho, _ = asyncio.run(gerar_backup_criptografado(BancoFalso(), segredo))
    zip_path = None
    try:
        zip_path, manifesto = descriptografar_e_validar_backup(caminho, segredo)
        assert manifesto["colecoes"]["clientes"] == 1
        zip_path.unlink(missing_ok=True)
        zip_path = None

        with pytest.raises(ValueError, match="adulterado|chave"):
            descriptografar_e_validar_backup(
                caminho,
                "outra-chave-segura-com-mais-de-trinta-e-dois-caracteres",
            )

        conteudo = bytearray(caminho.read_bytes())
        conteudo[len(BACKUP_MAGIC) + 20] ^= 0x01
        caminho.write_bytes(conteudo)
        with pytest.raises(ValueError, match="adulterado|chave"):
            descriptografar_e_validar_backup(caminho, segredo)
    finally:
        caminho.unlink(missing_ok=True)
        if zip_path:
            zip_path.unlink(missing_ok=True)


class ContextoAssincrono:
    def __init__(self, valor):
        self.valor = valor

    async def __aenter__(self):
        return self.valor

    async def __aexit__(self, *_args):
        return False


class SessaoFalsa:
    def start_transaction(self):
        return ContextoAssincrono(self)


class ClienteMongoFalso:
    def start_session(self):
        return ContextoAssincrono(SessaoFalsa())


class ColecaoRestauravel:
    def __init__(self):
        self.documentos = [{"legado": True}]

    async def delete_many(self, _filtro, session=None):
        assert session is not None
        self.documentos = []

    async def insert_many(self, documentos, ordered=True, session=None):
        assert ordered is True
        assert session is not None
        self.documentos.extend(documentos)


class BancoRestauravel:
    def __init__(self):
        self.client = ClienteMongoFalso()
        self.colecoes = {
            nome: ColecaoRestauravel() for nome in BACKUP_COLLECTIONS
        }

    def __getitem__(self, nome):
        return self.colecoes[nome]


def test_restauracao_substitui_colecoes_e_reconstroi_object_id():
    segredo = "segredo-de-backup-com-mais-de-trinta-e-dois-caracteres"
    origem = BancoFalso()
    caminho, _ = asyncio.run(gerar_backup_criptografado(origem, segredo))
    zip_path = None
    try:
        zip_path, manifesto = descriptografar_e_validar_backup(caminho, segredo)
        destino = BancoRestauravel()
        resumo = asyncio.run(restaurar_backup_validado(destino, zip_path, manifesto))

        assert resumo["totalRegistros"] == 1
        cliente = destino.colecoes["clientes"].documentos[0]
        assert cliente["_id"] == origem.cliente_id
        assert isinstance(cliente["_id"], ObjectId)
        assert cliente["atualizadoEm"] == datetime(
            2026, 8, 11, 12, 30, tzinfo=timezone.utc
        )
        assert isinstance(cliente["atualizadoEm"], datetime)
        assert destino.colecoes["perfumes"].documentos == []
    finally:
        caminho.unlink(missing_ok=True)
        if zip_path:
            zip_path.unlink(missing_ok=True)
