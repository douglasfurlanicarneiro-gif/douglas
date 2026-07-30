try:
    from availability import INITIAL_READY_DELIVERY_NAMES, name_signature
except ModuleNotFoundError:
    from backend.availability import INITIAL_READY_DELIVERY_NAMES, name_signature


def test_initial_ready_delivery_list_has_22_unique_items():
    signatures = [name_signature(name) for name in INITIAL_READY_DELIVERY_NAMES]
    assert len(signatures) == 22
    assert len(set(signatures)) == 22


def test_name_signature_ignores_order_accents_and_audience_qualifiers():
    assert name_signature("Azzaro The Most Wanted") == name_signature(
        "The Most Wanted Azzaro Masculino"
    )
    assert name_signature("Althair Parfums de Marly") == name_signature(
        "Althaïr Parfums de Marly Masculino"
    )
    assert name_signature("Vanilla | 28 Kayali Fragrances") == name_signature(
        "Vanilla 28 Kayali Fragrances Compartilhável"
    )
