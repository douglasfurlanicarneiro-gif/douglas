"""PDF de etiquetas internas de produção, gerado a partir do pedido."""

from io import BytesIO
from textwrap import wrap

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas


GOLD = HexColor("#B88935")
INK = HexColor("#241D16")
MUTED = HexColor("#766B5F")
BORDER = HexColor("#D8C19A")


def _linhas(texto: str, limite: int = 34, maximo: int = 2) -> list[str]:
    linhas = wrap(" ".join(str(texto).split()), width=limite, break_long_words=False)
    return (linhas or ["Perfume"])[0:maximo]


def gerar_etiquetas_producao(pedido: dict, nomes: dict[str, str]) -> bytes:
    """Gera A4 com 10 etiquetas internas (2 colunas x 5 linhas) por página."""
    unidades: list[dict] = []
    for item in pedido.get("itens") or []:
        quantidade = max(1, min(int(item.get("quantidade", 1) or 1), 100))
        for numero in range(1, quantidade + 1):
            unidades.append({**item, "unidade": numero, "totalUnidades": quantidade})
            if len(unidades) > 500:
                raise ValueError("O pedido excede o limite de 500 etiquetas por arquivo.")
    if not unidades:
        raise ValueError("O pedido não possui itens para etiquetar.")

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4, pageCompression=1)
    largura_pagina, altura_pagina = A4
    margem_x, margem_y = 8 * mm, 10 * mm
    gap = 3 * mm
    largura = (largura_pagina - 2 * margem_x - gap) / 2
    altura = (altura_pagina - 2 * margem_y - 4 * gap) / 5

    for indice, item in enumerate(unidades):
        posicao = indice % 10
        if posicao == 0 and indice:
            pdf.showPage()
        coluna, linha = posicao % 2, posicao // 2
        x = margem_x + coluna * (largura + gap)
        y = altura_pagina - margem_y - (linha + 1) * altura - linha * gap

        pdf.setStrokeColor(BORDER)
        pdf.setLineWidth(0.65)
        pdf.roundRect(x, y, largura, altura, 3 * mm, stroke=1, fill=0)
        pdf.setFillColor(GOLD)
        pdf.setFont("Helvetica-Bold", 7.5)
        pdf.drawString(x + 5 * mm, y + altura - 7 * mm, "L’ESSENCE FURLANI  ·  PRODUÇÃO")
        pdf.setFillColor(MUTED)
        pdf.setFont("Helvetica", 7)
        seq = int(pedido.get("seq", 0) or 0)
        pdf.drawRightString(x + largura - 5 * mm, y + altura - 7 * mm, f"PEDIDO Nº {seq:03d}")

        nome = nomes.get(str(item.get("perfumeId") or "")) or item.get("perfumeNome") or "Perfume"
        pdf.setFillColor(INK)
        pdf.setFont("Helvetica-Bold", 10)
        cursor_y = y + altura - 15 * mm
        for linha_nome in _linhas(nome):
            pdf.drawString(x + 5 * mm, cursor_y, linha_nome)
            cursor_y -= 4.5 * mm

        pdf.setFont("Helvetica-Bold", 9)
        pdf.setFillColor(GOLD)
        atendimento = "PRONTA ENTREGA" if item.get("tipoAtendimento") == "pronta_entrega" else "SOB ENCOMENDA"
        pdf.drawString(x + 5 * mm, y + 13 * mm, f"{int(item.get('ml', 0) or 0)} ML  ·  {atendimento}")
        pdf.setFillColor(MUTED)
        pdf.setFont("Helvetica", 7.5)
        cliente = " ".join(str(pedido.get("cliente") or "Cliente").split())[:48]
        pdf.drawString(x + 5 * mm, y + 7 * mm, cliente)
        pdf.drawRightString(
            x + largura - 5 * mm,
            y + 7 * mm,
            f"UN. {item['unidade']}/{item['totalUnidades']}",
        )

    pdf.save()
    return buffer.getvalue()
