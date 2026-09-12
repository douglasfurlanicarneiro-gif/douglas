"""Ensaio real opt-in: somente MongoDB local efêmero, nunca MONGO_URL."""
import asyncio
import os
import uuid
from datetime import datetime, timezone

import pytest
from bson import ObjectId
from pymongo import AsyncMongoClient
from pymongo.errors import BulkWriteError

from backup_service import (
    BACKUP_COLLECTIONS, gerar_backup_criptografado,
    descriptografar_e_validar_backup, restaurar_backup_validado,
)
from routers import pedidos as pedidos_router


@pytest.mark.skipif(os.environ.get("RUN_ISOLATED_MONGO_BACKUP") != "1", reason="Requer réplica local descartável na porta 27028")
def test_backup_real_roundtrip_indices_e_rollback():
    asyncio.run(_ensaio())


@pytest.mark.skipif(os.environ.get("RUN_ISOLATED_MONGO_BACKUP") != "1", reason="Requer réplica local descartável na porta 27028")
def test_ajuste_manual_real_confirma_e_reverte_transacao(monkeypatch):
    asyncio.run(_ensaio_ajuste_manual(monkeypatch))


async def _ensaio_ajuste_manual(monkeypatch):
    client = AsyncMongoClient(
        "mongodb://127.0.0.1:27028/?replicaSet=backup_test&directConnection=true",
        serverSelectionTimeoutMS=10000, tz_aware=True,
    )
    nome_banco = "lessence_manual_order_test_" + uuid.uuid4().hex
    banco = client[nome_banco]
    try:
        pedido_ok = ObjectId()
        pedido_rollback = ObjectId()
        base = {
            "status": "pendente",
            "itens": [],
            "pagamento": {
                "provedor": "infinitepay",
                "status": "aguardando_pagamento",
                "checkoutUrl": "https://checkout.infinitepay.com.br/teste-isolado",
            },
        }
        await banco.pedidos.insert_many([
            {"_id": pedido_ok, **base},
            {"_id": pedido_rollback, **base},
        ])
        monkeypatch.setattr(pedidos_router, "get_db", lambda: banco)

        await pedidos_router.ajustar_status_manual(
            str(pedido_ok),
            pedidos_router.AjusteStatusIn(
                status="entregue",
                statusAnterior="pendente",
                motivo="Conferência transacional no MongoDB isolado",
                pagamento="pago",
            ),
            "admin-teste",
        )
        confirmado = await banco.pedidos.find_one({"_id": pedido_ok})
        assert confirmado["status"] == "entregue"
        assert confirmado["pagamento"]["status"] == "pago"
        assert confirmado["pagamento"]["checkoutUrl"].endswith("teste-isolado")
        assert confirmado["pagamentoRequerRevisao"] is True
        assert confirmado["historicoAjustesManuais"][-1]["ator"] == "admin-teste"

        async def falhar_depois_de_escrever(
            db, pedido_id, _itens, _status, session=None
        ):
            await db.movimentos.insert_one(
                {
                    "origem": f"pedido:{pedido_id}",
                    "tipo": "saida",
                    "quantidadeMl": 30,
                },
                session=session,
            )
            raise RuntimeError("falha provocada dentro da transação")

        monkeypatch.setattr(
            pedidos_router,
            "_sincronizar_movimentos_do_pedido",
            falhar_depois_de_escrever,
        )
        with pytest.raises(RuntimeError, match="falha provocada"):
            await pedidos_router.ajustar_status_manual(
                str(pedido_rollback),
                pedidos_router.AjusteStatusIn(
                    status="entregue",
                    statusAnterior="pendente",
                    motivo="Verificação de rollback integral",
                    pagamento="pago",
                ),
                "admin-teste",
            )
        revertido = await banco.pedidos.find_one({"_id": pedido_rollback})
        assert revertido["status"] == "pendente"
        assert revertido["pagamento"]["status"] == "aguardando_pagamento"
        assert await banco.movimentos.count_documents(
            {"origem": f"pedido:{pedido_rollback}"}
        ) == 0
    finally:
        assert banco.name == nome_banco
        await client.drop_database(nome_banco)
        await client.close()


async def _ensaio():
    # Endereço deliberadamente fixo: não aceita URI externa ou configuração do app.
    client = AsyncMongoClient(
        "mongodb://127.0.0.1:27028/?replicaSet=backup_test&directConnection=true",
        serverSelectionTimeoutMS=10000, tz_aware=True,
    )
    prefixo = "lessence_backup_test_" + uuid.uuid4().hex
    origem = client[prefixo + "_origem"]
    destino = client[prefixo + "_destino"]
    arquivos = []
    try:
        hello = await client.admin.command("hello")
        assert hello.get("setName") == "backup_test"
        assert hello.get("isWritablePrimary") is True
        for nome in BACKUP_COLLECTIONS:
            await origem[nome].insert_one({
                "_id": ObjectId(), "codigo": nome, "totalCentavos": 12345,
                "data": datetime(2026, 9, 6, tzinfo=timezone.utc),
                "itens": [{"referencia": ObjectId(), "descricao": "Fictício — coração"}],
            })
            await destino[nome].insert_one({"codigo": "legado"})
        await destino.clientes.create_index("codigo", unique=True, name="codigo_unico_teste")
        indices = await destino.clientes.index_information()

        async def restaurar_origem():
            chave = "chave-ficticia-descartavel-exclusiva-do-ensaio"
            cifrado, _ = await gerar_backup_criptografado(origem, chave)
            arquivos.append(cifrado)
            zip_path, manifesto = descriptografar_e_validar_backup(cifrado, chave)
            arquivos.append(zip_path)
            return await restaurar_backup_validado(destino, zip_path, manifesto)

        resumo = await restaurar_origem()
        assert resumo["totalRegistros"] == len(BACKUP_COLLECTIONS)
        antes = {}
        for nome in BACKUP_COLLECTIONS:
            esperados = await origem[nome].find({}).to_list(None)
            antes[nome] = await destino[nome].find({}).to_list(None)
            assert antes[nome] == esperados
        assert await destino.clientes.index_information() == indices

        # Alterar duas coleções atomicamente DEPOIS de ler a primeira, mas
        # ANTES de ler a segunda. Sem snapshot o backup mistura os dois momentos.
        class ColecaoComEscritaConcorrente:
            def __init__(self, nome):
                self.nome = nome

            async def find(self, filtro, **kwargs):
                async for documento in origem[self.nome].find(filtro, **kwargs):
                    yield documento
                if self.nome == "perfumes":
                    async with client.start_session() as escrita:
                        async with await escrita.start_transaction():
                            for nome in ("perfumes", "pedidos"):
                                await origem[nome].update_one({}, {"$set": {"totalCentavos": 54321}}, session=escrita)

        class BancoComEscritaConcorrente:
            def __init__(self):
                self.client = client

            def __getitem__(self, nome):
                return ColecaoComEscritaConcorrente(nome)

        chave = "chave-ficticia-exclusiva-do-ensaio-concorrente"
        cifrado, _ = await gerar_backup_criptografado(BancoComEscritaConcorrente(), chave)
        arquivos.append(cifrado)
        zip_path, manifesto = descriptografar_e_validar_backup(cifrado, chave)
        arquivos.append(zip_path)
        assert manifesto["consistencia"] == "snapshot-majority"
        await restaurar_backup_validado(destino, zip_path, manifesto)
        for nome in BACKUP_COLLECTIONS:
            assert await destino[nome].find({}).to_list(None) == antes[nome]
        for nome in ("perfumes", "pedidos"):
            assert (await origem[nome].find_one({}))["totalCentavos"] == 54321

        # A falha ocorre depois de coleções anteriores já terem sido substituídas
        # dentro da transação. O índice único real força o aborto integral.
        await origem.perfumes.update_one({}, {"$set": {"totalCentavos": 99999}})
        await origem.clientes.insert_one({"codigo": "clientes"})
        with pytest.raises(BulkWriteError):
            await restaurar_origem()
        for nome in BACKUP_COLLECTIONS:
            assert await destino[nome].find({}).to_list(None) == antes[nome]
        assert await destino.clientes.index_information() == indices
    finally:
        # Somente os dois bancos de nome aleatório criados neste ensaio.
        for banco in (origem, destino):
            assert banco.name in {prefixo + "_origem", prefixo + "_destino"}
            await client.drop_database(banco.name)
        await client.close()
        for arquivo in arquivos:
            arquivo.unlink(missing_ok=True)
