"""Inclusões idempotentes do catálogo oficial já aprovadas pela operação.

O código do fornecedor é a chave estável. A rotina só cria itens ausentes e
nunca sobrescreve um cadastro que já tenha sido revisado no painel.
"""

from datetime import datetime, timezone

from utils import next_seq


VITRINE_ORIGIN = "https://lessence-furlani-vitrine.onrender.com"
STANDARD_PRICES = [
    {"ml": 30, "preco": 50.0},
    {"ml": 50, "preco": 85.0},
    {"ml": 100, "preco": 160.0},
]


def _image(code: str) -> str:
    return f"{VITRINE_ORIGIN}/perfume-images/nova-{code}.avif"


CURRENT_NOVA_ESSENCIA_LAUNCHES = (
    {
        "nome": "Impadia BDK Parfums - Compartilhável",
        "imagemUrl": _image("400056"),
        "ocasioes": ["Dia", "Encontros", "Ocasiões especiais", "Primavera", "Verão"],
        "familias": ["Floral", "Frutado", "Amadeirado"],
        "concentracao": "Eau De Parfum",
        "notasSaida": "Pera, Bergamota, Mandarina",
        "notasCoracao": "Rosa Búlgara, Rosa Turca, Flor de Laranjeira Africana",
        "notasFundo": "Akigalawood, Absoluto de Baunilha, Sândalo",
        "custoEssenciaPorMl": 0.9,
        "fornecedorCodigo": "400056",
    },
    {
        "nome": "Symphony Louis Vuitton - Compartilhável",
        "imagemUrl": _image("400429"),
        "ocasioes": ["Dia", "Ocasiões especiais", "Uso diário", "Verão", "Viagem"],
        "familias": ["Cítrico", "Aromático"],
        "concentracao": "Eau De Parfum",
        "notasSaida": "Toranja, Bergamota, Gengibre",
        "notasCoracao": "",
        "notasFundo": "",
        "custoEssenciaPorMl": 0.906,
        "fornecedorCodigo": "400429",
    },
    {
        "nome": "Noir Extreme Tom Ford - Masculino",
        "imagemUrl": _image("400040"),
        "ocasioes": ["Encontros", "Festa", "Inverno", "Noite", "Ocasiões especiais"],
        "familias": ["Oriental", "Amadeirado", "Especiado Quente"],
        "concentracao": "Eau De Parfum",
        "notasSaida": "Cardamomo, Noz-moscada, Açafrão, Mandarina, Néroli",
        "notasCoracao": "Kulfi, Rosa, Lentisco, Flor de Laranjeira, Jasmim",
        "notasFundo": "Baunilha, Âmbar, Notas Amadeiradas, Sândalo",
        "custoEssenciaPorMl": 0.64,
        "fornecedorCodigo": "400040",
    },
    {
        "nome": "Spicebomb Extreme Viktor&Rolf - Masculino",
        "imagemUrl": _image("400246"),
        "ocasioes": ["Encontros", "Festa", "Inverno", "Noite", "Outono"],
        "familias": ["Oriental", "Especiado Quente"],
        "concentracao": "Eau De Parfum",
        "notasSaida": "Lavanda",
        "notasCoracao": "Notas Orientais, Cominho, Pimenta Preta",
        "notasFundo": "Tabaco, Baunilha",
        "custoEssenciaPorMl": 1.096,
        "fornecedorCodigo": "400246",
    },
    {
        "nome": "Journey Man Amouage - Masculino",
        "imagemUrl": _image("400241"),
        "ocasioes": ["Encontros", "Inverno", "Noite", "Ocasiões especiais", "Outono"],
        "familias": ["Amadeirado", "Especiado Quente", "Couro"],
        "concentracao": "Eau De Parfum",
        "notasSaida": "Pimenta de Szechuan, Cardamomo, Bergamota, Néroli",
        "notasCoracao": "Folha de Tabaco, Incenso, Bagas de Zimbro",
        "notasFundo": "Couro, Nagarmota, Fava Tonka, Almíscar",
        "custoEssenciaPorMl": 1.142,
        "fornecedorCodigo": "400241",
    },
    {
        "nome": "Perseus Parfums de Marly - Masculino",
        "imagemUrl": _image("400249"),
        "ocasioes": ["Dia", "Primavera", "Trabalho", "Uso diário", "Verão"],
        "familias": ["Amadeirado", "Aromático", "Cítrico"],
        "concentracao": "Eau De Parfum",
        "notasSaida": "Toranja, Bergamota, Groselha Preta",
        "notasCoracao": "Vetiver, Mandarina Verde, Gerânio",
        "notasFundo": "Madeira Seca, Madeira de Cashmere, Âmbar Cinzento, Abeto Balsâmico, Cedro, Fava Tonka",
        "custoEssenciaPorMl": 1.084,
        "fornecedorCodigo": "400249",
    },
    {
        "nome": "MYSLF Eau de Parfum Yves Saint Laurent - Masculino",
        "imagemUrl": _image("400374"),
        "ocasioes": ["Dia", "Encontros", "Meia-estação", "Trabalho", "Uso diário"],
        "familias": ["Aromático", "Cítrico", "Floral"],
        "concentracao": "Eau De Parfum",
        "notasSaida": "Bergamota da Calábria, Bergamota",
        "notasCoracao": "Flor de Laranjeira Tunisiana",
        "notasFundo": "Ambrofix, Patchouli",
        "custoEssenciaPorMl": 0.874,
        "fornecedorCodigo": "400374",
    },
    {
        "nome": "Chrome Azzaro - Masculino",
        "imagemUrl": _image("400078"),
        "ocasioes": ["Academia", "Casual", "Dia", "Trabalho", "Uso diário", "Verão"],
        "familias": ["Cítrico", "Aromático", "Aquático"],
        "concentracao": "Eau De Toilette",
        "notasSaida": "Limão, Alecrim, Bergamota, Néroli, Abacaxi",
        "notasCoracao": "Jasmim, Musgo de Carvalho, Cyclamen, Coentro",
        "notasFundo": "Almíscar, Musgo de Carvalho, Cedro, Sândalo, Cardamomo, Pau-Rosa, Fava Tonka",
        "custoEssenciaPorMl": 0.774,
        "fornecedorCodigo": "400078",
    },
    {
        "nome": "Libre L'Absolu Platine Yves Saint Laurent - Feminino",
        "imagemUrl": _image("400428"),
        "ocasioes": ["Dia", "Ocasiões especiais", "Primavera", "Trabalho", "Uso diário"],
        "familias": ["Aromático", "Floral", "Ambarado"],
        "concentracao": "Elixir",
        "notasSaida": "Aldeídos, Bergamota, Mandarina",
        "notasCoracao": "Lavanda, Lavanda Azul, Flor de Laranjeira",
        "notasFundo": "Baunilha, Âmbar",
        "custoEssenciaPorMl": 0.906,
        "fornecedorCodigo": "400428",
    },
    {
        "nome": "Viva La Juicy Juicy Couture - Feminino",
        "imagemUrl": _image("400426"),
        "ocasioes": ["Casual", "Encontros", "Festa", "Noite", "Primavera", "Verão"],
        "familias": ["Frutado", "Floral", "Oriental"],
        "concentracao": "Eau De Parfum",
        "notasSaida": "Frutas Silvestres, Mandarina",
        "notasCoracao": "Gardênia, Madressilva, Jasmim",
        "notasFundo": "Caramelo, Pralinê, Baunilha, Âmbar, Sândalo",
        "custoEssenciaPorMl": 0.918,
        "fornecedorCodigo": "400426",
    },
    {
        "nome": "Chance Eau Splendide Chanel - Feminino",
        "imagemUrl": _image("400408"),
        "ocasioes": ["Dia", "Encontros", "Primavera", "Trabalho", "Verão"],
        "familias": ["Floral", "Frutado", "Almiscarado"],
        "concentracao": "Eau De Parfum",
        "notasSaida": "Frutas Vermelhas, Framboesa, Rosa, Violeta, Pêssego",
        "notasCoracao": "Íris, Gerânio Rosa",
        "notasFundo": "Almíscar Branco, Cedro",
        "custoEssenciaPorMl": 0.784,
        "fornecedorCodigo": "400408",
    },
    {
        "nome": "Valaya Exclusif Parfums de Marly - Feminino",
        "imagemUrl": _image("400409"),
        "ocasioes": ["Dia", "Encontros", "Inverno", "Ocasiões especiais", "Outono", "Primavera"],
        "familias": ["Floral", "Almiscarado", "Amadeirado", "Ambarado"],
        "concentracao": "Eau De Parfum",
        "notasSaida": "Amêndoa, Bergamota, Mandarina",
        "notasCoracao": "Notas Atalcadas, Flor de Laranjeira, Lírio-do-Vale, Lótus",
        "notasFundo": "Ambroxan, Baunilha, Akigalawood, Sândalo, Almíscar Branco, Heliotrópio",
        "custoEssenciaPorMl": 0.738,
        "fornecedorCodigo": "400409",
    },
)


async def ensure_current_nova_essencia_launches(db) -> dict[str, int]:
    """Cria somente os lançamentos ainda ausentes, preservando revisões manuais."""
    added = 0
    skipped = 0
    now = datetime.now(timezone.utc)
    supplier = await db.fornecedores.find_one({
        "nome": {"$regex": "^Nova Ess[eê]ncia$", "$options": "i"},
        "arquivadoEm": None,
    })
    supplier_id = str(supplier["_id"]) if supplier else ""
    for item in CURRENT_NOVA_ESSENCIA_LAUNCHES:
        exists = await db.perfumes.find_one({
            "$or": [
                {"fornecedorCodigo": item["fornecedorCodigo"]},
                {"nome": item["nome"], "arquivadoEm": None},
            ]
        })
        if exists:
            skipped += 1
            continue
        families = list(item["familias"])
        await db.perfumes.insert_one({
            **item,
            "seq": await next_seq(db, "perfumes"),
            "inspiracao": "",
            "familia": families[0],
            "familias": families,
            "precos": [dict(price) for price in STANDARD_PRICES],
            "estoqueMinimoMl": 0,
            "publicavel": True,
            "prontaEntrega": False,
            "concentracaoPercentual": 25,
            "fornecedorId": supplier_id,
            "arquivadoEm": None,
            "criadoEm": now,
            "atualizadoEm": now,
        })
        added += 1
    return {"adicionados": added, "jaExistentes": skipped}
