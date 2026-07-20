from fastapi import FastAPI, APIRouter, Header, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# --- Auth (fixed credentials) ---
ATELIE_USUARIO = "douglasfurlani"
ATELIE_SENHA = "Dfc160201"
ATELIE_TOKEN = "atelie-token-douglas-furlani-fixed"


def check_atelie(token: Optional[str]):
    if token != ATELIE_TOKEN:
        raise HTTPException(status_code=401, detail="Acesso negado")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return uuid.uuid4().hex[:12]


# --- Models ---
class LoginIn(BaseModel):
    usuario: str
    senha: str


class LoginOut(BaseModel):
    ok: bool
    token: Optional[str] = None


class Preco(BaseModel):
    ml: int
    preco: float


class PerfumeIn(BaseModel):
    nome: str
    inspiracao: str = ""
    familia: str = "Amadeirado"
    concentracao: str = "EDP"
    notasSaida: str = ""
    notasCoracao: str = ""
    notasFundo: str = ""
    precos: List[Preco] = Field(default_factory=list)
    estoqueMinimoMl: int = 100
    publicavel: bool = True


class Perfume(PerfumeIn):
    id: str
    seq: int
    criadoEm: str


class MovimentoIn(BaseModel):
    perfumeId: str
    tipo: str  # 'entrada' | 'saida'
    quantidadeMl: int
    motivo: str = ""
    origem: str = "manual"


class Movimento(MovimentoIn):
    id: str
    data: str


class PedidoItem(BaseModel):
    perfumeId: str
    ml: int
    quantidade: int


class PedidoIn(BaseModel):
    cliente: str
    contato: str = ""
    status: str = "pendente"
    observacoes: str = ""
    itens: List[PedidoItem]
    total: float = 0


class Pedido(PedidoIn):
    id: str
    seq: int
    criadoEm: str


class OpiniaoIn(BaseModel):
    perfumeId: str
    cliente: str = ""
    nota: int = 5
    comentario: str = ""


class Opiniao(OpiniaoIn):
    id: str
    data: str


class SugestaoIn(BaseModel):
    cliente: str = ""
    contato: str = ""
    mensagem: str


class Sugestao(SugestaoIn):
    id: str
    data: str
    lida: bool = False


class CompraIn(BaseModel):
    perfumeId: str
    perfumeNome: str
    ml: int
    preco: float
    cliente: str
    contato: str
    observacoes: str = ""


class Compra(CompraIn):
    id: str
    data: str
    status: str = "pendente"


# --- Auth ---
@api_router.post("/auth/login", response_model=LoginOut)
async def login(inp: LoginIn):
    if inp.usuario.strip() == ATELIE_USUARIO and inp.senha == ATELIE_SENHA:
        return LoginOut(ok=True, token=ATELIE_TOKEN)
    return LoginOut(ok=False)


# --- Perfumes ---
@api_router.get("/perfumes", response_model=List[Perfume])
async def list_perfumes():
    docs = await db.perfumes.find({}, {"_id": 0}).to_list(2000)
    return [Perfume(**d) for d in docs]


@api_router.post("/perfumes", response_model=Perfume)
async def create_perfume(inp: PerfumeIn, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    last = await db.perfumes.find({}, {"_id": 0, "seq": 1}).sort("seq", -1).limit(1).to_list(1)
    seq = (last[0]["seq"] if last else 0) + 1
    p = Perfume(id=new_id(), seq=seq, criadoEm=now_iso(), **inp.model_dump())
    await db.perfumes.insert_one(p.model_dump())
    return p


@api_router.put("/perfumes/{pid}", response_model=Perfume)
async def update_perfume(pid: str, inp: PerfumeIn, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    existing = await db.perfumes.find_one({"id": pid}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Perfume não encontrado")
    updated = {**existing, **inp.model_dump()}
    await db.perfumes.update_one({"id": pid}, {"$set": inp.model_dump()})
    return Perfume(**updated)


@api_router.delete("/perfumes/{pid}")
async def delete_perfume(pid: str, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    await db.perfumes.delete_one({"id": pid})
    return {"ok": True}


class BulkImportIn(BaseModel):
    nomes: List[str]


@api_router.post("/perfumes/bulk-import")
async def bulk_import(inp: BulkImportIn, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    existentes = {d["nome"].lower() for d in await db.perfumes.find({}, {"_id": 0, "nome": 1}).to_list(5000)}
    last = await db.perfumes.find({}, {"_id": 0, "seq": 1}).sort("seq", -1).limit(1).to_list(1)
    seq = last[0]["seq"] if last else 0
    novos = []
    for nome in inp.nomes:
        if nome.lower() in existentes:
            continue
        seq += 1
        novos.append({
            "id": new_id(), "seq": seq, "nome": nome, "inspiracao": "",
            "familia": "Amadeirado", "concentracao": "EDP",
            "notasSaida": "", "notasCoracao": "", "notasFundo": "",
            "precos": [{"ml": 30, "preco": 0}, {"ml": 50, "preco": 0}, {"ml": 100, "preco": 0}],
            "estoqueMinimoMl": 100, "publicavel": True, "criadoEm": now_iso(),
        })
    if novos:
        await db.perfumes.insert_many(novos)
    return {"adicionados": len(novos)}


@api_router.post("/perfumes/padronizar-tamanhos")
async def padronizar_tamanhos(x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    precos = [{"ml": 30, "preco": 0}, {"ml": 50, "preco": 0}, {"ml": 100, "preco": 0}]
    r = await db.perfumes.update_many({}, {"$set": {"precos": precos}})
    return {"atualizados": r.modified_count}


# --- Movimentos ---
@api_router.get("/movimentos", response_model=List[Movimento])
async def list_movimentos(x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    docs = await db.movimentos.find({}, {"_id": 0}).to_list(5000)
    return [Movimento(**d) for d in docs]


@api_router.post("/movimentos", response_model=Movimento)
async def create_movimento(inp: MovimentoIn, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    m = Movimento(id=new_id(), data=now_iso(), **inp.model_dump())
    await db.movimentos.insert_one(m.model_dump())
    return m


@api_router.get("/estoque")
async def get_estoque_map():
    docs = await db.movimentos.find({}, {"_id": 0}).to_list(20000)
    m = {}
    for d in docs:
        delta = d["quantidadeMl"] if d["tipo"] == "entrada" else -d["quantidadeMl"]
        m[d["perfumeId"]] = m.get(d["perfumeId"], 0) + delta
    return m


# --- Pedidos ---
async def registrar_movs_pedido(pedido: dict, tipo: str, motivo_prefix: str):
    for it in pedido["itens"]:
        await db.movimentos.insert_one({
            "id": new_id(),
            "perfumeId": it["perfumeId"],
            "tipo": tipo,
            "quantidadeMl": it["ml"] * it["quantidade"],
            "motivo": f"{motivo_prefix} – {pedido['cliente']}",
            "origem": "pedido",
            "data": now_iso(),
        })


@api_router.get("/pedidos", response_model=List[Pedido])
async def list_pedidos(x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    docs = await db.pedidos.find({}, {"_id": 0}).to_list(2000)
    return [Pedido(**d) for d in docs]


@api_router.post("/pedidos", response_model=Pedido)
async def create_pedido(inp: PedidoIn, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    last = await db.pedidos.find({}, {"_id": 0, "seq": 1}).sort("seq", -1).limit(1).to_list(1)
    seq = (last[0]["seq"] if last else 0) + 1
    p = Pedido(id=new_id(), seq=seq, criadoEm=now_iso(), **inp.model_dump())
    await db.pedidos.insert_one(p.model_dump())
    if p.status != "cancelado":
        await registrar_movs_pedido(p.model_dump(), "saida", f"Pedido Nº{str(seq).zfill(3)}")
    return p


@api_router.put("/pedidos/{pid}", response_model=Pedido)
async def update_pedido(pid: str, inp: PedidoIn, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    old = await db.pedidos.find_one({"id": pid}, {"_id": 0})
    if not old:
        raise HTTPException(404, "Pedido não encontrado")
    if old["status"] != "cancelado":
        # Estorno das saídas
        for it in old["itens"]:
            await db.movimentos.insert_one({
                "id": new_id(), "perfumeId": it["perfumeId"], "tipo": "entrada",
                "quantidadeMl": it["ml"] * it["quantidade"],
                "motivo": f"Estorno – ajuste Pedido Nº{str(old['seq']).zfill(3)}",
                "origem": "estorno", "data": now_iso(),
            })
    novo = {**old, **inp.model_dump()}
    await db.pedidos.update_one({"id": pid}, {"$set": inp.model_dump()})
    if novo["status"] != "cancelado":
        await registrar_movs_pedido(novo, "saida", f"Pedido Nº{str(novo['seq']).zfill(3)}")
    return Pedido(**novo)


@api_router.delete("/pedidos/{pid}")
async def delete_pedido(pid: str, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    old = await db.pedidos.find_one({"id": pid}, {"_id": 0})
    if old and old["status"] != "cancelado":
        for it in old["itens"]:
            await db.movimentos.insert_one({
                "id": new_id(), "perfumeId": it["perfumeId"], "tipo": "entrada",
                "quantidadeMl": it["ml"] * it["quantidade"],
                "motivo": f"Estorno – exclusão Pedido Nº{str(old['seq']).zfill(3)}",
                "origem": "estorno", "data": now_iso(),
            })
    await db.pedidos.delete_one({"id": pid})
    return {"ok": True}


# --- Opinioes ---
@api_router.get("/opinioes", response_model=List[Opiniao])
async def list_opinioes():
    docs = await db.opinioes.find({}, {"_id": 0}).to_list(2000)
    return [Opiniao(**d) for d in docs]


@api_router.post("/opinioes", response_model=Opiniao)
async def create_opiniao(inp: OpiniaoIn, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    o = Opiniao(id=new_id(), data=now_iso(), **inp.model_dump())
    await db.opinioes.insert_one(o.model_dump())
    return o


@api_router.delete("/opinioes/{oid}")
async def delete_opiniao(oid: str, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    await db.opinioes.delete_one({"id": oid})
    return {"ok": True}


# --- Vitrine (pública) ---
@api_router.get("/vitrine")
async def get_vitrine():
    doc = await db.vitrine.find_one({"key": "snapshot"}, {"_id": 0, "key": 0})
    if not doc:
        return {"atualizadoEm": None, "itens": []}
    # Recalcula disponibilidade em tempo real (estoque atual)
    movs = await db.movimentos.find({}, {"_id": 0}).to_list(20000)
    estoque = {}
    for m in movs:
        delta = m["quantidadeMl"] if m["tipo"] == "entrada" else -m["quantidadeMl"]
        estoque[m["perfumeId"]] = estoque.get(m["perfumeId"], 0) + delta
    itens = []
    for it in doc.get("itens", []):
        itens.append({**it, "disponivel": estoque.get(it["id"], 0) > 0})
    return {"atualizadoEm": doc.get("atualizadoEm"), "itens": itens}


@api_router.post("/vitrine/publish")
async def publish_vitrine(x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    perfumes = await db.perfumes.find({}, {"_id": 0}).to_list(2000)
    movs = await db.movimentos.find({}, {"_id": 0}).to_list(20000)
    estoque = {}
    for m in movs:
        delta = m["quantidadeMl"] if m["tipo"] == "entrada" else -m["quantidadeMl"]
        estoque[m["perfumeId"]] = estoque.get(m["perfumeId"], 0) + delta
    itens = []
    for p in perfumes:
        if p.get("publicavel", True) is False:
            continue
        itens.append({
            "id": p["id"], "seq": p["seq"], "nome": p["nome"], "inspiracao": p["inspiracao"],
            "familia": p["familia"], "concentracao": p["concentracao"],
            "notasSaida": p["notasSaida"], "notasCoracao": p["notasCoracao"], "notasFundo": p["notasFundo"],
            "precos": p["precos"], "disponivel": estoque.get(p["id"], 0) > 0,
        })
    snapshot = {"atualizadoEm": now_iso(), "itens": itens}
    await db.vitrine.update_one({"key": "snapshot"}, {"$set": {**snapshot, "key": "snapshot"}}, upsert=True)
    return snapshot


# --- Sugestões ---
@api_router.post("/sugestoes", response_model=Sugestao)
async def create_sugestao(inp: SugestaoIn):
    s = Sugestao(id=new_id(), data=now_iso(), **inp.model_dump())
    await db.sugestoes.insert_one(s.model_dump())
    return s


@api_router.get("/sugestoes", response_model=List[Sugestao])
async def list_sugestoes(x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    docs = await db.sugestoes.find({}, {"_id": 0}).to_list(2000)
    return [Sugestao(**d) for d in docs]


@api_router.delete("/sugestoes/{sid}")
async def delete_sugestao(sid: str, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    await db.sugestoes.delete_one({"id": sid})
    return {"ok": True}


# --- Compras (pedidos de compra da vitrine) ---
@api_router.post("/compras", response_model=Compra)
async def create_compra(inp: CompraIn):
    c = Compra(id=new_id(), data=now_iso(), **inp.model_dump())
    await db.compras.insert_one(c.model_dump())
    return c


@api_router.get("/compras", response_model=List[Compra])
async def list_compras(x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    docs = await db.compras.find({}, {"_id": 0}).to_list(2000)
    return [Compra(**d) for d in docs]


@api_router.delete("/compras/{cid}")
async def delete_compra(cid: str, x_atelie_token: Optional[str] = Header(None)):
    check_atelie(x_atelie_token)
    await db.compras.delete_one({"id": cid})
    return {"ok": True}


@api_router.get("/")
async def root():
    return {"app": "Contratipos Ateliê API", "ok": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
