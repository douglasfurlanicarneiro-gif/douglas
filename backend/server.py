from fastapi import FastAPI, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from pydantic import BaseModel
from typing import List, Optional
import os

app = FastAPI()

# Conexão Banco
MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("DB_NAME", "atelier_perfumes")
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# ROTA DE PEDIDOS - Agora com baixa por ML
@app.post("/pedidos")
async def criar_pedido(pedido: dict):
    # O pedido deve vir com: perfume_id, nome_perfume, ml_escolhido (30, 50 ou 100)
    perfume_id = pedido.get("perfume_id")
    ml_venda = int(pedido.get("ml_escolhido", 0))
    
    # 1. Registra o Pedido na "gaveta" de Pedidos
    novo_pedido = await db.pedidos.insert_one(pedido)
    
    # 2. Busca o perfume e retira do estoque (em ml ou unidades)
    if perfume_id:
        # Aqui ele subtrai o valor de ML do campo 'estoque' do perfume
        await db.perfumes.update_one(
            {"_id": ObjectId(perfume_id)},
            {"$inc": {"estoque": -ml_venda}} 
        )
    
    return {"status": "Pedido registrado e estoque atualizado"}

# ROTA DE OPINIÕES - Vai para a gaveta de opiniões, não mensagens
@app.post("/opinioes")
async def salvar_opiniao(opiniao: dict):
    await db.opinioes.insert_one(opiniao)
    return {"status": "Opinião salva com sucesso"}

# ROTA DE PERFUMES (Lista para a Vitrine)
@app.get("/perfumes")
async def listar_perfumes():
    perfumes = await db.perfumes.find().to_list(1000)
    for p in perfumes:
        p["_id"] = str(p["_id"])
    return perfumes

# ROTA DE LANÇAMENTO DE ESTOQUE (Manual pelo Ateliê)
@app.patch("/perfumes/{id}/estoque")
async def atualizar_estoque(id: str, dados: dict):
    nova_qtd = dados.get("quantidade")
    await db.perfumes.update_one(
        {"_id": ObjectId(id)},
        {"$set": {"estoque": nova_qtd}}
    )
    return {"status": "Estoque atualizado manualmente"}
