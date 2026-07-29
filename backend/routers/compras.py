from datetime import datetime, timezone
import secrets
from typing import Literal, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field, model_validator

from database import get_db
from locks import stock_lock
from payments.service import iniciar_pagamento
from routers.pedidos import (
    ItemPedido,
    _aplicar_saida_estoque,
    _reverter_movimentos_do_pedido,
)
from security import require_atelie_auth
from shipping.melhor_envio import MelhorEnvioError, cotar_frete
from utils import next_seq, serialize

router = APIRouter(prefix="/api/compras", tags=["compras"])


class EnderecoIn(BaseModel):
    cep: str = Field(min_length=8, max_length=9)
    endereco: str = Field(min_length=2, max_length=160)
    numero: str = Field(min_length=1, max_length=20)
    complemento: str = ""
    bairro: str = Field(min_length=2, max_length=100)
    cidade: str = Field(min_length=2, max_length=100)
    estado: str = Field(min_length=2, max_length=2)


class ItemCompraIn(BaseModel):
    perfumeId: str
    ml: int = Field(gt=0, le=1000)
    quantidade: int = Field(gt=0, le=20)


class FreteEscolhidoIn(BaseModel):
    serviceId: int = Field(gt=0)


class CompraIn(BaseModel):
    # Campos legados continuam aceitos para não quebrar versões antigas do app.
    perfumeId: Optional[str] = None
    perfumeNome: Optional[str] = None
    ml: Optional[int] = None
    preco: Optional[float] = None
    itens: list[ItemCompraIn] = Field(default_factory=list, max_length=50)
    cliente: str = Field(min_length=2, max_length=120)
    contato: str = Field(min_length=5, max_length=160)
    observacoes: str = Field(default="", max_length=1000)
    nomeCompleto: Optional[str] = None
    telefone: Optional[str] = None
    whatsapp: Optional[str] = None
    email: Optional[EmailStr] = None
    endereco: Optional[EnderecoIn] = None
    formaPagamento: Optional[Literal["pix", "cartao"]] = None
    freteEscolhido: Optional[FreteEscolhidoIn] = None

    @model_validator(mode="after")
    def validar_formato(self):
        if not self.itens and not (self.perfumeId and self.ml):
            raise ValueError("Adicione ao menos um item ao pedido.")
        if self.itens:
            obrigatorios = (
                self.nomeCompleto,
                self.whatsapp,
                self.email,
                self.endereco,
                self.formaPagamento,
            )
            if not all(obrigatorios):
                raise ValueError("Complete o cadastro e escolha a forma de pagamento.")
        return self


@router.get("")
async def listar_compras(_: str = Depends(require_atelie_auth)):
    db = get_db()
    compras = await db.compras.find().sort("data", -1).to_list(2000)
    return [serialize(c) for c in compras]


@router.post("")
async def criar_compra(payload: CompraIn):
    # Saldo e saídas são tratados como uma única operação no processo atual.
    # Assim dois checkouts simultâneos não consomem o mesmo mililitro.
    async with stock_lock:
        return await _criar_compra(payload)


async def _criar_compra(payload: CompraIn):
    db = get_db()
    itens_entrada = payload.itens or [
        ItemCompraIn(perfumeId=payload.perfumeId or "", ml=payload.ml or 0, quantidade=1)
    ]

    ids: list[ObjectId] = []
    try:
        ids = [ObjectId(item.perfumeId) for item in itens_entrada]
    except InvalidId:
        raise HTTPException(status_code=400, detail="Um dos produtos possui id inválido.")

    perfumes = await db.perfumes.find({"_id": {"$in": ids}}).to_list(len(ids))
    perfumes_por_id = {str(p["_id"]): p for p in perfumes}
    itens_doc = []
    total = 0.0
    for item in itens_entrada:
        perfume = perfumes_por_id.get(item.perfumeId)
        if not perfume or perfume.get("publicavel") is False:
            raise HTTPException(status_code=404, detail="Produto não encontrado na vitrine.")
        opcao = next((p for p in perfume.get("precos", []) if p.get("ml") == item.ml), None)
        if not opcao or float(opcao.get("preco", 0)) <= 0:
            raise HTTPException(status_code=400, detail=f"Tamanho indisponível para {perfume['nome']}.")
        subtotal = round(float(opcao["preco"]) * item.quantidade, 2)
        total += subtotal
        itens_doc.append({
            "perfumeId": item.perfumeId,
            "perfumeNome": perfume["nome"],
            "ml": item.ml,
            "quantidade": item.quantidade,
            "precoUnitario": float(opcao["preco"]),
            "subtotal": subtotal,
        })

    doc = payload.model_dump(
        exclude={
            "perfumeId",
            "perfumeNome",
            "ml",
            "preco",
            "itens",
            "freteEscolhido",
        }
    )
    doc["itens"] = itens_doc
    doc["subtotal"] = round(total, 2)
    doc["frete"] = 0.0
    doc["entrega"] = None
    if payload.freteEscolhido:
        if not payload.endereco:
            raise HTTPException(status_code=400, detail="Informe o endereço de entrega.")
        try:
            opcoes_frete = await cotar_frete(
                db,
                cep_destino=payload.endereco.cep,
                itens=itens_doc,
            )
        except MelhorEnvioError as exc:
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        escolha = next(
            (
                opcao
                for opcao in opcoes_frete
                if opcao["serviceId"] == payload.freteEscolhido.serviceId
            ),
            None,
        )
        if not escolha:
            raise HTTPException(
                status_code=400,
                detail="A opção de entrega escolhida não está mais disponível. Calcule novamente.",
            )
        doc["frete"] = escolha["preco"]
        doc["entrega"] = escolha
    doc["total"] = round(total + doc["frete"], 2)
    agora = datetime.now(timezone.utc).isoformat()
    doc["data"] = agora
    doc["criadoEm"] = agora
    doc["status"] = "pendente"
    doc["origem"] = "vitrine"
    doc["seq"] = await next_seq(db, "pedidos")
    doc["codigoAcompanhamento"] = secrets.token_urlsafe(12)
    doc["historicoStatus"] = [{"status": "pendente", "data": agora}]

    # Salva/atualiza o cadastro do cliente por telefone/whatsapp, pra próxima
    # compra vir com os campos pré-preenchidos (o app consulta isso por
    # GET /api/clientes/por-contato/{contato} antes de abrir o formulário).
    identificador = payload.whatsapp or payload.contato
    if payload.nomeCompleto and identificador:
        await db.clientes.update_one(
            {"contato": identificador},
            {"$set": {
                "contato": identificador,
                "nomeCompleto": payload.nomeCompleto,
                "telefone": payload.telefone or payload.whatsapp,
                "whatsapp": payload.whatsapp,
                "email": payload.email,
                "endereco": payload.endereco.model_dump() if payload.endereco else None,
                "atualizadoEm": agora,
            }},
            upsert=True,
        )

    # Uma compra feita na vitrine é um pedido de verdade. Ela entra diretamente
    # na coleção `pedidos`, usada pela aba Pedidos e pelo dashboard. A coleção
    # `compras` permanece somente para registros legados criados por versões
    # anteriores do aplicativo.
    resultado = await db.pedidos.insert_one(doc)
    pedido_id = str(resultado.inserted_id)

    # O pedido pendente reserva a quantidade no resumo, sem alterar o saldo
    # físico. A saída será lançada quando o status mudar para "preparando".

    if payload.formaPagamento:
        pagamento = await iniciar_pagamento(payload.formaPagamento, pedido_id, doc["total"])
        await db.pedidos.update_one({"_id": resultado.inserted_id}, {"$set": {"pagamento": pagamento}})

    nova = await db.pedidos.find_one({"_id": resultado.inserted_id})
    return serialize(nova)


class CompraStatusIn(BaseModel):
    status: Literal[
        "pendente",
        "pagamento_confirmado",
        "preparando",
        "pronto",
        "enviado",
        "entregue",
        "cancelado",
    ]


@router.patch("/{compra_id}")
async def atualizar_status_compra(compra_id: str, payload: CompraStatusIn, _: str = Depends(require_atelie_auth)):
    async with stock_lock:
        db = get_db()
        try:
            oid = ObjectId(compra_id)
        except InvalidId:
            raise HTTPException(status_code=400, detail="Id de compra inválido.")

        legado = await db.compras.find_one({"_id": oid})
        if legado:
            await db.compras.update_one(
                {"_id": oid},
                {"$set": {"status": payload.status}},
            )
            return serialize(await db.compras.find_one({"_id": oid}))

        pedido = await db.pedidos.find_one({"_id": oid, "origem": "vitrine"})
        if not pedido:
            raise HTTPException(
                status_code=404,
                detail="Pedido de compra não encontrado.",
            )
        itens = [
            ItemPedido(
                perfumeId=item["perfumeId"],
                ml=item["ml"],
                quantidade=item.get("quantidade", 1),
            )
            for item in pedido.get("itens", [])
        ]
        await _reverter_movimentos_do_pedido(db, compra_id)
        await _aplicar_saida_estoque(db, compra_id, itens, payload.status)

        atualizacao = {"status": payload.status}
        if payload.status != pedido.get("status"):
            historico = pedido.get("historicoStatus", [])
            historico.append({
                "status": payload.status,
                "data": datetime.now(timezone.utc).isoformat(),
            })
            atualizacao["historicoStatus"] = historico
        await db.pedidos.update_one({"_id": oid}, {"$set": atualizacao})
        return serialize(await db.pedidos.find_one({"_id": oid}))


@router.delete("/{compra_id}")
async def apagar_compra(compra_id: str, _: str = Depends(require_atelie_auth)):
    db = get_db()
    try:
        oid = ObjectId(compra_id)
    except InvalidId:
        raise HTTPException(status_code=400, detail="Id de compra inválido.")
    resultado = await db.compras.delete_one({"_id": oid})
    if resultado.deleted_count == 0:
        pedido = await db.pedidos.find_one({"_id": oid, "origem": "vitrine"})
        if not pedido:
            raise HTTPException(status_code=404, detail="Pedido de compra não encontrado.")
        await db.movimentos.delete_many({"origem": f"pedido:{compra_id}"})
        await db.pedidos.delete_one({"_id": oid})
    return {"status": "Pedido de compra apagado."}
