import asyncio
import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone

import pytest
from bson import ObjectId
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
import backup_service

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

    def find(self, _filtro, session=None):
        assert session is not None
        return CursorAssincrono(self._documentos)


class BancoFalso:
    def __init__(self):
        self.client = ClienteMongoFalso()
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
    async def start_transaction(self):
        return ContextoAssincrono(self)


class ClienteMongoFalso:
    def start_session(self, **kwargs):
        if kwargs:
            assert kwargs == {"snapshot": True}
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


@pytest.mark.parametrize("adulterar", [False, True])
def test_falha_de_autenticidade_remove_temporario(monkeypatch, tmp_path, adulterar):
    monkeypatch.setattr(backup_service.tempfile, "tempdir", str(tmp_path))
    segredo = "chave-ficticia-de-teste-com-mais-de-32-caracteres"
    caminho, _ = asyncio.run(gerar_backup_criptografado(BancoFalso(), segredo))
    try:
        if adulterar:
            conteudo = bytearray(caminho.read_bytes())
            conteudo[-1] ^= 1
            caminho.write_bytes(conteudo)
        else:
            segredo = "outra-chave-ficticia-de-teste-com-32-caracteres"
        with pytest.raises(ValueError, match="adulterado|chave"):
            descriptografar_e_validar_backup(caminho, segredo)
        assert list(tmp_path.iterdir()) == [caminho]
    finally:
        caminho.unlink(missing_ok=True)


@pytest.mark.parametrize("manifesto", [[], None, "invalido", 42])
def test_manifesto_deve_ser_objeto(tmp_path, manifesto):
    caminho = tmp_path / "manifesto.zip"
    with zipfile.ZipFile(caminho, "w") as archive:
        archive.writestr("manifesto.json", json.dumps(manifesto))
    with pytest.raises(ValueError, match="manifesto.*inválido"):
        backup_service._validar_zip_backup(caminho)


def test_limite_e_verificado_antes_de_descompactar_manifesto(monkeypatch, tmp_path):
    caminho = tmp_path / "grande.zip"
    with zipfile.ZipFile(caminho, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifesto.json", " " * 1024)
    monkeypatch.setattr(backup_service, "MAX_BACKUP_UNCOMPRESSED_BYTES", 512)
    def leitura_proibida(*args, **kwargs):
        pytest.fail("Não deveria descompactar um arquivo acima do limite")
    monkeypatch.setattr(zipfile.ZipFile, "read", leitura_proibida)
    with pytest.raises(ValueError, match="descompactado excede"):
        backup_service._validar_zip_backup(caminho)


def test_rejeita_registro_acima_do_limite(monkeypatch, tmp_path):
    caminho = tmp_path / "registro.zip"
    manifesto = {"aplicacao": "L'Essence Furlani", "versao": 3, "colecoes": {"clientes": 1}}
    with zipfile.ZipFile(caminho, "w") as archive:
        archive.writestr("manifesto.json", json.dumps(manifesto))
        archive.writestr("dados/clientes.ndjson", json.dumps({"nome": "a" * 1024}) + "\n")
    monkeypatch.setattr(backup_service, "MAX_BACKUP_LINE_BYTES", 512)
    with pytest.raises(ValueError, match="Registro excessivamente grande"):
        backup_service._validar_zip_backup(caminho)


def test_ciclo_completo_preserva_todas_as_colecoes_com_dados_ficticios(monkeypatch, tmp_path):
    monkeypatch.setattr(backup_service.tempfile, "tempdir", str(tmp_path))
    origem = BancoFalso()
    esperados = {}
    for nome in BACKUP_COLLECTIONS:
        esperados[nome] = [{
            "_id": ObjectId(), "referenciaTeste": nome,
            "totalCentavos": 12345, "ativo": True, "opcional": None,
            "itens": [{"perfumeId": ObjectId(), "volume": 50}],
            "data": datetime(2026, 9, 5, tzinfo=timezone.utc),
            "texto": "Fragrância fictícia — coração",
        }]
        origem._colecoes[nome] = ColecaoFalsa(esperados[nome])
    segredo = "chave-apenas-para-ensaio-isolado-sem-dados-reais"
    caminho, resumo_exportado = asyncio.run(gerar_backup_criptografado(origem, segredo))
    zip_path = None
    try:
        zip_path, manifesto = descriptografar_e_validar_backup(caminho, segredo)
        destino = BancoRestauravel()
        resumo = asyncio.run(restaurar_backup_validado(destino, zip_path, manifesto))
        assert resumo["totalRegistros"] == len(BACKUP_COLLECTIONS)
        assert resumo["colecoes"] == resumo_exportado["colecoes"]
        for nome in BACKUP_COLLECTIONS:
            assert destino.colecoes[nome].documentos == esperados[nome]
    finally:
        caminho.unlink(missing_ok=True)
        if zip_path:
            zip_path.unlink(missing_ok=True)
    assert list(tmp_path.iterdir()) == []


def test_snapshot_unico_e_falha_descarta_backup_parcial(monkeypatch, tmp_path):
    monkeypatch.setattr(backup_service.tempfile, "tempdir", str(tmp_path))
    banco = BancoFalso()
    sessoes = []
    class ColecaoComFalha:
        async def find(self, _filtro, session=None):
            sessoes.append(session)
            yield {"codigo": "ficticio"}
            if len(sessoes) == 2:
                raise RuntimeError("SnapshotTooOld simulado")
    for nome in BACKUP_COLLECTIONS:
        banco._colecoes[nome] = ColecaoComFalha()
    with pytest.raises(RuntimeError, match="SnapshotTooOld"):
        asyncio.run(gerar_backup_criptografado(banco, "chave-ficticia-de-teste-com-mais-de-32-caracteres"))
    assert len(sessoes) == 2
    assert sessoes[0] is not None and sessoes[0] is sessoes[1]
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("limite", ["MAX_BACKUP_LINE_BYTES", "MAX_BACKUP_UNCOMPRESSED_BYTES", "MAX_BACKUP_ENCRYPTED_BYTES"])
def test_exportacao_respeita_limites_da_restauracao(monkeypatch, tmp_path, limite):
    monkeypatch.setattr(backup_service.tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(backup_service, limite, 64)
    with pytest.raises(ValueError, match="limite restaurável"):
        asyncio.run(gerar_backup_criptografado(BancoFalso(), "chave-ficticia-com-mais-de-trinta-e-dois-caracteres"))
    assert list(tmp_path.iterdir()) == []


def test_cancelamento_remove_arquivos_parciais(monkeypatch, tmp_path):
    monkeypatch.setattr(backup_service.tempfile, "tempdir", str(tmp_path))
    banco = BancoFalso()
    class ColecaoCancelada:
        async def find(self, *args, **kwargs):
            yield {"ficticio": True}
            raise asyncio.CancelledError()
    banco._colecoes["perfumes"] = ColecaoCancelada()
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(gerar_backup_criptografado(banco, "chave-ficticia-com-mais-de-trinta-e-dois-caracteres"))
    assert list(tmp_path.iterdir()) == []


def test_timeout_descarta_exportacao(monkeypatch, tmp_path):
    monkeypatch.setattr(backup_service.tempfile, "tempdir", str(tmp_path))
    monkeypatch.setattr(backup_service, "MAX_BACKUP_EXPORT_SECONDS", 0.01)
    banco = BancoFalso()
    class ColecaoLenta:
        async def find(self, *args, **kwargs):
            yield {"ficticio": True}
            await asyncio.sleep(10)
    banco._colecoes["perfumes"] = ColecaoLenta()
    with pytest.raises(TimeoutError):
        asyncio.run(gerar_backup_criptografado(banco, "chave-ficticia-com-mais-de-trinta-e-dois-caracteres"))
    assert list(tmp_path.iterdir()) == []


def test_falha_no_segundo_temporario_remove_primeiro(monkeypatch, tmp_path):
    monkeypatch.setattr(backup_service.tempfile, "tempdir", str(tmp_path))
    mkstemp_real = backup_service.tempfile.mkstemp
    chamadas = 0
    def criar(*args, **kwargs):
        nonlocal chamadas
        chamadas += 1
        if chamadas == 2:
            raise OSError("disco cheio simulado")
        return mkstemp_real(*args, **kwargs)
    monkeypatch.setattr(backup_service.tempfile, "mkstemp", criar)
    with pytest.raises(OSError):
        asyncio.run(gerar_backup_criptografado(BancoFalso(), "chave-ficticia-com-mais-de-trinta-e-dois-caracteres"))
    assert list(tmp_path.iterdir()) == []
