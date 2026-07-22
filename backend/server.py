from fastapi import FastAPI, HTTPException
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI()

# Permite que o celular conecte no servidor sem bloqueios
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Conexão com as variáveis que você configurou no Render
MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("DB_NAME", "atelier_perfumes")
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# --- ROTA 1: LISTAR PERFUMES NA VITRINE ---
@app.get("/perfumes")
async def listar_perfumes():
    perfumes = await db.perfumes.find().to_list(1000)
    for p in perfumes:
        p["_id"] = str(p["_id"])
    return perfumes

# --- ROTA 2: PEDIDOS COM BAIXA AUTOMÁTICA POR ML ---
@app.post("/pedidos")
async def criar_pedido(pedido: dict):
    # Salva na gaveta de PEDIDOS
    novo_pedido = await db.pedidos.insert_one(pedido)

    perfume_id = pedido.get("perfume_id")
    ml_venda = int(pedido.get("ml_escolhido", 0))

    # Se o pedido tem ID, tira do estoque de perfumes
    if perfume_id:
        await db.perfumes.update_one(
            {"_id": ObjectId(perfume_id)},
            {"$inc": {"estoque": -ml_venda}}
        )
    return {"status": "Pedido realizado e estoque baixado"}

# --- ROTA 3: OPINIÕES (GAVETA DE AVALIAÇÕES) ---
@app.post("/opinioes")
async def salvar_opiniao(opiniao: dict):
    await db.opinioes.insert_one(opiniao)
    return {"status": "Opinião salva"}

# --- ROTA 4: LANÇAMENTO DE ESTOQUE MANUAL (ATELIÊ) ---
@app.patch("/perfumes/{id}/estoque")
async def atualizar_estoque(id: str, dados: dict):
    nova_qtd = int(dados.get("quantidade", 0))
    await db.perfumes.update_one(
        {"_id": ObjectId(id)},
        {"$set": {"estoque": nova_qtd}}
    )
    return {"status": "Estoque atualizado"}

# --- ROTA 5: LISTAR PEDIDOS (PARA O RESUMO E A ABA PEDIDOS DO PAINEL) ---
@app.get("/pedidos")
async def listar_pedidos():
    pedidos = await db.pedidos.find().to_list(1000)
    for p in pedidos:
        p["_id"] = str(p["_id"])
    return pedidos

# --- ROTA 6: ATUALIZAR UM PEDIDO (EX: MUDAR STATUS) ---
@app.patch("/pedidos/{id}")
async def atualizar_pedido(id: str, dados: dict):
    resultado = await db.pedidos.update_one(
        {"_id": ObjectId(id)},
        {"$set": dados}
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    return {"status": "Pedido atualizado"}

# --- ROTA 6B: APAGAR UM PEDIDO ---
@app.delete("/pedidos/{id}")
async def apagar_pedido(id: str):
    resultado = await db.pedidos.delete_one({"_id": ObjectId(id)})
    if resultado.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    return {"status": "Pedido apagado"}

# --- ROTA 7: EDITAR DADOS DO PERFUME (NOME, IMAGEM, INSPIRAÇÃO) ---
# O estoque continua controlado só pela ROTA 4, pra não ter dois jeitos de mexer no mesmo número.
@app.patch("/perfumes/{id}")
async def editar_perfume(id: str, dados: dict):
    dados.pop("estoque", None)
    resultado = await db.perfumes.update_one(
        {"_id": ObjectId(id)},
        {"$set": dados}
    )
    if resultado.matched_count == 0:
        raise HTTPException(status_code=404, detail="Perfume não encontrado")
    return {"status": "Perfume atualizado"}
