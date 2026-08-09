import asyncio
import hashlib
import io
import json
import zipfile

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from backup_service import BACKUP_COLLECTIONS, BACKUP_MAGIC, gerar_backup_criptografado


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
        self._colecoes["clientes"] = ColecaoFalsa([
            {"nome": "Cliente Sigiloso", "email": "privado@example.com"},
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
