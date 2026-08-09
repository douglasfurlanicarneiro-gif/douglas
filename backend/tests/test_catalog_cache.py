import catalog_cache


def setup_function():
    catalog_cache.invalidate_catalog_cache()


def test_cache_retorna_payload_enquanto_valido(monkeypatch):
    relogio = {"agora": 100.0}
    monkeypatch.setattr(catalog_cache.time, "monotonic", lambda: relogio["agora"])
    geracao = catalog_cache.generation()
    payload = {"atualizadoEm": "2026-08-09T00:00:00+00:00", "itens": [{"id": "1"}]}

    assert catalog_cache.set_cached_catalog(payload, geracao) is True
    assert catalog_cache.get_cached_catalog() is payload

    relogio["agora"] += catalog_cache.CATALOG_CACHE_TTL_SECONDS + 0.1
    assert catalog_cache.get_cached_catalog() is None


def test_invalidacao_impede_publicar_construcao_obsoleta():
    geracao_anterior = catalog_cache.generation()
    catalog_cache.invalidate_catalog_cache()

    assert catalog_cache.set_cached_catalog({"itens": []}, geracao_anterior) is False
    assert catalog_cache.get_cached_catalog() is None
