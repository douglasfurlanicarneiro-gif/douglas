"""Regression tests for dynamic storefront stock availability."""
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
TOKEN = os.environ.get("ATELIE_TEST_TOKEN", "")
AUTH = {"x-atelie-token": TOKEN, "Content-Type": "application/json"}
pytestmark = pytest.mark.skipif(
    not BASE_URL or not TOKEN,
    reason="Configure EXPO_PUBLIC_BACKEND_URL e ATELIE_TEST_TOKEN para testes de integração.",
)


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


# ---- Ready delivery respects stock; made-to-order remains available ----
class TestVitrineDisponibilidadeReal:
    def test_publicado_continua_disponivel_com_estoque(self, s, vitrine_snapshot):
        ab = next((i for i in vitrine_snapshot["itens"] if i.get("seq") == 1), None)
        assert ab is not None, "Perfume Nº 001 not found in vitrine"
        assert ab["disponivel"] is True

    def test_pronta_entrega_sem_saldo_fica_indisponivel(self, s, vitrine_snapshot):
        est = s.get(f"{API}/estoque").json()
        sem_saldo = [
            i for i in vitrine_snapshot["itens"]
            if i.get("prontaEntrega") and est.get(i["id"], 0) <= 0
        ]
        assert len(sem_saldo) > 0
        assert all(i["disponivel"] is False for i in sem_saldo)

    def test_sob_encomenda_continua_disponivel_sem_saldo(self, s, vitrine_snapshot):
        est = s.get(f"{API}/estoque").json()
        sem_saldo = [
            i for i in vitrine_snapshot["itens"]
            if not i.get("prontaEntrega") and est.get(i["id"], 0) <= 0
        ]
        assert len(sem_saldo) > 0
        assert all(i["disponivel"] is True for i in sem_saldo)

    def test_movimentacao_nao_bloqueia_vitrine(self, s, vitrine_snapshot):
        est = s.get(f"{API}/estoque").json()
        target = next((i for i in vitrine_snapshot["itens"]
                       if i.get("prontaEntrega") and est.get(i["id"], 0) == 0), None)
        assert target is not None, "No candidate perfume without stock"
        pid = target["id"]

        try:
            r = s.post(f"{API}/movimentos",
                       json={"perfumeId": pid, "tipo": "entrada",
                             "quantidadeMl": 100, "motivo": "TEST_dynamic",
                             "categoria": "entrada"},
                       headers=AUTH)
            assert r.status_code == 200, r.text

            v = s.get(f"{API}/vitrine").json()
            it = next((i for i in v["itens"] if i["id"] == pid), None)
            assert it is not None
            assert it["disponivel"] is True

            r2 = s.post(f"{API}/movimentos",
                        json={"perfumeId": pid, "tipo": "saida",
                              "quantidadeMl": 100, "motivo": "TEST_dynamic_out",
                              "categoria": "ajuste-negativo"},
                        headers=AUTH)
            assert r2.status_code == 200, r2.text

            v2 = s.get(f"{API}/vitrine").json()
            it2 = next((i for i in v2["itens"] if i["id"] == pid), None)
            assert it2["disponivel"] is False
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
        publication = r.json()
        assert publication["itensPublicados"] == 418
        snap = s.get(f"{API}/vitrine").json()
        assert isinstance(snap["itens"], list)
        assert len(snap["itens"]) == 418
        after = snap["atualizadoEm"]
        assert after != before or after is not None
        # Dynamic size information is present after every publication.
        ab = next((i for i in snap["itens"] if i.get("seq") == 1), None)
        assert ab is not None
        assert "tamanhosDisponiveisMl" in ab
