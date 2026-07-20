"""Tests for opinioes endpoints — POST is now public, DELETE requires token."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://contratipo-app.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
GOOD_TOKEN = "atelie-token-douglas-furlani-fixed"
AUTH = {"x-atelie-token": GOOD_TOKEN}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def perfume_id(s):
    """Pick any existing perfume from the catalog."""
    r = s.get(f"{API}/perfumes")
    assert r.status_code == 200
    perfumes = r.json()
    assert len(perfumes) > 0, "Need at least one perfume in DB"
    return perfumes[0]["id"]


class TestOpiniaoPublic:
    created_ids = []

    def test_post_opiniao_no_token_ok(self, s, perfume_id):
        payload = {"perfumeId": perfume_id, "cliente": "TEST_public_client",
                   "nota": 4, "comentario": "TEST_Otimo!"}
        r = s.post(f"{API}/opinioes", json=payload)  # NO auth header
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["nota"] == 4
        assert d["comentario"] == "TEST_Otimo!"
        assert d["cliente"] == "TEST_public_client"
        assert d["perfumeId"] == perfume_id
        assert "id" in d and "data" in d
        TestOpiniaoPublic.created_ids.append(d["id"])

    def test_post_opiniao_persisted(self, s):
        # Verify GET returns the created opinion
        r = s.get(f"{API}/opinioes")
        assert r.status_code == 200
        ids = [o["id"] for o in r.json()]
        assert TestOpiniaoPublic.created_ids[0] in ids

    def test_post_opiniao_empty_cliente_allowed(self, s, perfume_id):
        # Anonymous — 'cliente' should still work as empty/optional-ish
        payload = {"perfumeId": perfume_id, "cliente": "",
                   "nota": 5, "comentario": "TEST_anon"}
        r = s.post(f"{API}/opinioes", json=payload)
        assert r.status_code == 200, r.text
        TestOpiniaoPublic.created_ids.append(r.json()["id"])

    def test_delete_opiniao_no_token_forbidden(self, s):
        oid = TestOpiniaoPublic.created_ids[0]
        r = s.delete(f"{API}/opinioes/{oid}")  # NO auth
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    def test_delete_opiniao_with_token_ok(self, s):
        for oid in TestOpiniaoPublic.created_ids:
            r = s.delete(f"{API}/opinioes/{oid}", headers=AUTH)
            assert r.status_code == 200
        # confirm gone
        r = s.get(f"{API}/opinioes")
        ids = [o["id"] for o in r.json()]
        for oid in TestOpiniaoPublic.created_ids:
            assert oid not in ids


class TestRegression:
    """Make sure other endpoints still behave the same."""

    def test_auth_login_ok(self, s):
        r = s.post(f"{API}/auth/login", json={"usuario": "douglasfurlani", "senha": "Dfc160201"})
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_vitrine_public(self, s):
        r = s.get(f"{API}/vitrine")
        assert r.status_code == 200
        assert "itens" in r.json()

    def test_perfumes_public(self, s):
        r = s.get(f"{API}/perfumes")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_pedidos_requires_token(self, s):
        r = s.post(f"{API}/pedidos", json={"cliente": "X", "itens": [], "total": 0})
        assert r.status_code == 401

    def test_sugestoes_public_post(self, s):
        r = s.post(f"{API}/sugestoes", json={"cliente": "TEST_reg", "mensagem": "TEST_msg"})
        assert r.status_code == 200
        # cleanup
        sid = r.json()["id"]
        s.delete(f"{API}/sugestoes/{sid}", headers=AUTH)

    def test_compras_public_post(self, s):
        r = s.get(f"{API}/perfumes")
        pid = r.json()[0]["id"]
        r2 = s.post(f"{API}/compras", json={
            "perfumeId": pid, "perfumeNome": "TEST_x", "ml": 50, "preco": 100.0,
            "cliente": "TEST_reg", "contato": "999"
        })
        assert r2.status_code == 200
        cid = r2.json()["id"]
        s.delete(f"{API}/compras/{cid}", headers=AUTH)
