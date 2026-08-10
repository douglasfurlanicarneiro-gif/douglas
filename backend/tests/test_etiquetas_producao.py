from label_service import gerar_etiquetas_producao


def test_pdf_de_etiquetas_contem_uma_pagina_para_ate_dez_unidades():
    pdf = gerar_etiquetas_producao({
        "seq": 26,
        "cliente": "Douglas Furlani",
        "itens": [{
            "perfumeId": "p1", "ml": 50, "quantidade": 2,
            "tipoAtendimento": "pronta_entrega",
        }],
    }, {"p1": "212 VIP Black Carolina Herrera Masculino"})

    assert pdf.startswith(b"%PDF-")
    assert pdf.count(b"/Type /Page") == 2  # uma Page e o nó Pages


def test_pdf_cria_segunda_pagina_quando_passar_de_dez_unidades():
    pdf = gerar_etiquetas_producao({
        "seq": 27,
        "cliente": "Cliente",
        "itens": [{"perfumeId": "p1", "ml": 30, "quantidade": 11}],
    }, {"p1": "Perfume de teste"})

    assert pdf.count(b"/Type /Page") == 3  # duas Page e o nó Pages
