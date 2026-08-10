import asyncio
from datetime import datetime, timezone

from fastapi.responses import StreamingResponse

from routers import admin


class CursorFalhas:
    def __init__(self, documentos):
        self.documentos = documentos

    def sort(self, *_args):
        return self

    def limit(self, limite):
        self.documentos = self.documentos[:limite]
        return self

    async def to_list(self, limite):
        return self.documentos[:limite]


class EventosPagamentoFalsos:
    def __init__(self):
        self.ultima_atualizacao = None

    async def count_documents(self, filtro):
        status = filtro["status"]
        if status == "falhou":
            return 1
        if status == "processando":
            return 2
        return 3

    def find(self, _filtro):
        return CursorFalhas([
            {
                "_id": "evento-1",
                "payload": {"order_nsu": "pedido-42", "customer_name": "sigiloso"},
                "tentativas": 5,
                "ultimoErro": "gateway indisponível",
                "ultimaTentativaEm": datetime(2026, 8, 10, tzinfo=timezone.utc),
            },
        ])

    async def update_many(self, filtro, atualizacao):
        self.ultima_atualizacao = (filtro, atualizacao)
        return type("Resultado", (), {"modified_count": 1})()


class OperacoesFalsas:
    def __init__(self):
        self.inseridos = []

    async def find_one(self, filtro, sort=None):
        assert sort == [("data", -1)]
        if filtro["tipo"] == "auditoria:exportar":
            return {"data": "2026-08-10T10:00:00+00:00"}
        return None

    async def insert_one(self, documento):
        self.inseridos.append(documento)


class BancoOperacionalFalso:
    def __init__(self):
        self.eventos_pagamento = EventosPagamentoFalsos()
        self.operacoes_sistema = OperacoesFalsas()


def test_resumo_operacional_expoe_fila_sem_dados_do_cliente(monkeypatch):
    monkeypatch.setattr(admin, "get_db", lambda: BancoOperacionalFalso())

    resumo = asyncio.run(admin.resumo_operacional("sessao"))

    assert resumo["status"] == "atencao"
    assert resumo["pagamentosFalhos"] == 1
    assert resumo["pagamentosEmEspera"] == 3
    assert resumo["pagamentosProcessando"] == 2
    assert resumo["ultimoBackupEm"] == "2026-08-10T10:00:00+00:00"
    assert resumo["falhasRecentes"][0]["orderNsu"] == "pedido-42"
    assert "customer_name" not in resumo["falhasRecentes"][0]


def test_reprocessamento_reenfileira_falhas_e_registra_auditoria(monkeypatch):
    banco = BancoOperacionalFalso()
    monkeypatch.setattr(admin, "get_db", lambda: banco)

    resposta = asyncio.run(admin.reprocessar_pagamentos_falhos("sessao"))

    assert resposta["reprocessados"] == 1
    filtro, atualizacao = banco.eventos_pagamento.ultima_atualizacao
    assert filtro == {"status": "falhou"}
    assert atualizacao["$set"]["status"] == "repetir"
    assert atualizacao["$set"]["tentativas"] == 0
    assert banco.operacoes_sistema.inseridos[0]["tipo"] == "auditoria:reprocessar"


def test_download_de_backup_retorna_stream_e_remove_temporario(monkeypatch, tmp_path):
    arquivo = tmp_path / "backup.lfe"
    arquivo.write_bytes(b"backup-criptografado")

    async def gerar(_db, _chave):
        return arquivo, {
            "colecoes": {"clientes": 1},
            "tamanhoBytes": arquivo.stat().st_size,
        }

    async def auditar(*_args, **_kwargs):
        return None

    monkeypatch.setattr(admin, "BACKUP_ENCRYPTION_KEY", "x" * 32)
    monkeypatch.setattr(admin, "gerar_backup_criptografado", gerar)
    monkeypatch.setattr(admin, "registrar_auditoria", auditar)
    monkeypatch.setattr(admin, "get_db", lambda: object())

    response = asyncio.run(admin.baixar_backup("sessao"))

    assert isinstance(response, StreamingResponse)
    assert response.headers["cache-control"] == "no-store, max-age=0"

    async def consumir():
        return b"".join([bloco async for bloco in response.body_iterator])

    assert asyncio.run(consumir()) == b"backup-criptografado"
    assert not arquivo.exists()
