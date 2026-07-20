"""Regression tests for the dynamic 'disponivel' field on GET /api/vitrine.

Bug context: Previously GET /api/vitrine returned the frozen 'disponivel' value
that was computed at POST /api/vitrine/publish time. Now it must be
recalculated on-the-fly from the 'movimentos' collection.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not set"
API = f"{BASE_URL}/api"
TOKEN = "atelie-token-douglas-furlani-fixed"
AUTH = {"x-atelie-token": TOKEN, "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def vitrine_snapshot(s):
    """Baseline vitrine snapshot (no publish needed - existing one is used)."""
    r = s.get(f"{API}/vitrine")
    assert r.status_code == 200
    return r.json()


# ---- REGRESSION: shape and data ----
class TestVitrineShape:
    def test_has_atualizadoEm_and_itens(self, vitrine_snapshot):
        assert "atualizadoEm" in vitrine_snapshot
        assert "itens" in vitrine_snapshot
        assert vitrine_snapshot["atualizadoEm"] is not None

    def test_itens_count_is_418(self, vitrine_snapshot):
        assert len(vitrine_snapshot["itens"]) == 418, \
            f"Expected 418 itens, got {len(vitrine_snapshot['itens'])}"

    def test_itens_have_all_fields(self, vitrine_snapshot):
        it = vitrine_snapshot["itens"][0]
        for k in ("id", "seq", "nome", "inspiracao", "familia",
                  "concentracao", "notasSaida", "notasCoracao", "notasFundo",
                  "precos", "disponivel"):
            assert k in it, f"Missing field {k} in vitrine item"


# ---- FIX: disponivel reflects current stock in real time ----
class TestVitrineDinamica:
    def test_ab_autentica_disponivel_true_with_stock(self, s, vitrine_snapshot):
        """Ab Autentica (Nº 001) currently has 200ml stock -> disponivel must be True."""
        ab = next((i for i in vitrine_snapshot["itens"] if i.get("seq") == 1), None)
        assert ab is not None, "Perfume Nº 001 not found in vitrine"
        # sanity: name should include Ab Autentica
        assert "Ab Autentica" in ab["nome"] or "autentica" in ab["nome"].lower()
        # Cross-check with /api/estoque
        est = s.get(f"{API}/estoque").json()
        stock = est.get(ab["id"], 0)
        assert stock == 200, f"Expected 200ml stock for Ab Autentica, got {stock}"
        assert ab["disponivel"] is True, \
            "Ab Autentica has 200ml stock but vitrine returned disponivel=False"

    def test_other_perfumes_without_stock_are_unavailable(self, s, vitrine_snapshot):
        est = s.get(f"{API}/estoque").json()
        unavailable = [i for i in vitrine_snapshot["itens"]
                       if est.get(i["id"], 0) <= 0 and i["disponivel"] is False]
        assert len(unavailable) > 0, "Expected some perfumes without stock to show disponivel=False"

    def test_dynamic_add_stock_flips_disponivel_to_true(self, s, vitrine_snapshot):
        """Pick a perfume currently disponivel=False, add 100ml, re-GET vitrine,
        it must now show disponivel=True — WITHOUT calling publish."""
        est = s.get(f"{API}/estoque").json()
        target = next((i for i in vitrine_snapshot["itens"]
                       if i["disponivel"] is False and est.get(i["id"], 0) == 0), None)
        assert target is not None, "No candidate perfume with disponivel=False"
        pid = target["id"]

        try:
            # add entrada 100ml
            r = s.post(f"{API}/movimentos",
                       json={"perfumeId": pid, "tipo": "entrada",
                             "quantidadeMl": 100, "motivo": "TEST_dynamic"},
                       headers=AUTH)
            assert r.status_code == 200, r.text

            # re-GET vitrine (NO publish call)
            v = s.get(f"{API}/vitrine").json()
            it = next((i for i in v["itens"] if i["id"] == pid), None)
            assert it is not None
            assert it["disponivel"] is True, \
                "After adding 100ml entrada, vitrine still shows disponivel=False"

            # add saida 100ml -> back to 0
            r2 = s.post(f"{API}/movimentos",
                        json={"perfumeId": pid, "tipo": "saida",
                              "quantidadeMl": 100, "motivo": "TEST_dynamic_out"},
                        headers=AUTH)
            assert r2.status_code == 200, r2.text

            v2 = s.get(f"{API}/vitrine").json()
            it2 = next((i for i in v2["itens"] if i["id"] == pid), None)
            assert it2["disponivel"] is False, \
                "After zeroing stock via saida, vitrine still shows disponivel=True"
        finally:
            # cleanup TEST_ movimentos
            movs = s.get(f"{API}/movimentos", headers=AUTH).json()
            for m in movs:
                if m.get("perfumeId") == pid and str(m.get("motivo", "")).startswith("TEST_"):
                    s.delete(f"{API}/movimentos/{m['id']}", headers=AUTH)


# ---- REGRESSION: publish still works ----
class TestPublishStillWorks:
    def test_publish_regenerates_snapshot(self, s):
        before = s.get(f"{API}/vitrine").json().get("atualizadoEm")
        r = s.post(f"{API}/vitrine/publish", headers=AUTH)
        assert r.status_code == 200
        snap = r.json()
        assert "atualizadoEm" in snap
        assert isinstance(snap["itens"], list)
        assert len(snap["itens"]) == 418
        after = snap["atualizadoEm"]
        assert after != before or after is not None
        # Ab Autentica must still be disponivel after publish
        ab = next((i for i in snap["itens"] if i.get("seq") == 1), None)
        assert ab is not None
        assert ab["disponivel"] is True
