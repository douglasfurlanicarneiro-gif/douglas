from utils import planejar_reparo_sequencias


def test_duplicado_mais_novo_recebe_proximo_numero_sem_renumerar_catalogo():
    documentos = [
        {"_id": "01-antigo", "seq": 2},
        {"_id": "02-outro", "seq": 37},
        {"_id": "03-novo-intensely", "seq": 2},
        {"_id": "04-ultimo", "seq": 418},
    ]

    reparos, maior = planejar_reparo_sequencias(documentos)

    assert reparos == [("03-novo-intensely", 419)]
    assert maior == 419


def test_sequencias_validas_nao_sao_alteradas():
    reparos, maior = planejar_reparo_sequencias([
        {"_id": "01", "seq": 1},
        {"_id": "02", "seq": 3},
    ])

    assert reparos == []
    assert maior == 3
