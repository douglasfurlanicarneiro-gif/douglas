"""Backend API tests for Contratipos Ateliê (FastAPI + MongoDB)."""
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


# --- Auth ---
class TestAuth:
    def test_login_ok(self, s):
        r = s.post(f"{API}/auth/login", json={"usuario": "douglasfurlani", "senha": "Dfc160201"})
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d["token"] == GOOD_TOKEN

    def test_login_bad(self, s):
        r = s.post(f"{API}/auth/login", json={"usuario": "x", "senha": "y"})
        assert r.status_code == 200
        assert r.json()["ok"] is False


# --- Public endpoints ---
class TestPublic:
    def test_vitrine_initial(self, s):
        r = s.get(f"{API}/vitrine")
        assert r.status_code == 200
        d = r.json()
        assert "atualizadoEm" in d and "itens" in d
        assert isinstance(d["itens"], list)

    def test_perfumes_list_public(self, s):
        r = s.get(f"{API}/perfumes")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_estoque_public(self, s):
        r = s.get(f"{API}/estoque")
        assert r.status_code == 200
        assert isinstance(r.json(), dict)


# --- Auth guard ---
class TestAuthGuard:
    def test_create_perfume_no_token(self, s):
        r = s.post(f"{API}/perfumes", json={"nome": "TEST_noauth"})
        assert r.status_code == 401

    def test_bulk_import_no_token(self, s):
        r = s.post(f"{API}/perfumes/bulk-import", json={"nomes": ["TEST_x"]})
        assert r.status_code == 401

    def test_publish_no_token(self, s):
        r = s.post(f"{API}/vitrine/publish")
        assert r.status_code == 401


# --- Full flow: create → estoque → pedido → vitrine ---
class TestFullFlow:
    created = {}

    def test_create_perfume(self, s):
        payload = {
            "nome": "TEST_Contratipo_A",
            "inspiracao": "Teste",
            "familia": "Amadeirado",
            "concentracao": "EDP",
            "precos": [{"ml": 50, "preco": 120.0}],
            "publicavel": True,
        }
        r = s.post(f"{API}/perfumes", json=payload, headers=AUTH)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["nome"] == "TEST_Contratipo_A"
        assert "id" in d and "seq" in d
        TestFullFlow.created["perfume_id"] = d["id"]

        # verify persistence
        r2 = s.get(f"{API}/perfumes")
        assert any(p["id"] == d["id"] for p in r2.json())

    def test_bulk_import(self, s):
        r = s.post(f"{API}/perfumes/bulk-import",
                   json={"nomes": ["TEST_Bulk1", "TEST_Bulk2", "TEST_Bulk1"]}, headers=AUTH)
        assert r.status_code == 200
        d = r.json()
        assert "adicionados" in d
        assert d["adicionados"] >= 2

    def test_movimento_entrada(self, s):
        pid = TestFullFlow.created["perfume_id"]
        r = s.post(f"{API}/movimentos",
                   json={"perfumeId": pid, "tipo": "entrada", "quantidadeMl": 500, "motivo": "TEST"},
                   headers=AUTH)
        assert r.status_code == 200
        assert r.json()["quantidadeMl"] == 500

        # verify estoque map reflects
        est = s.get(f"{API}/estoque").json()
        assert est.get(pid, 0) >= 500

    def test_pedido_gera_saida(self, s):
        pid = TestFullFlow.created["perfume_id"]
        est_before = s.get(f"{API}/estoque").json().get(pid, 0)
        payload = {
            "cliente": "TEST_Cliente",
            "status": "pendente",
            "itens": [{"perfumeId": pid, "ml": 50, "quantidade": 2}],
            "total": 240.0,
        }
        r = s.post(f"{API}/pedidos", json=payload, headers=AUTH)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["cliente"] == "TEST_Cliente"
        TestFullFlow.created["pedido_id"] = d["id"]

        # estoque deve ter diminuído em 100 (2 * 50)
        est_after = s.get(f"{API}/estoque").json().get(pid, 0)
        assert est_after == est_before - 100

    def test_opiniao(self, s):
        pid = TestFullFlow.created["perfume_id"]
        r = s.post(f"{API}/opinioes",
                   json={"perfumeId": pid, "cliente": "TEST", "nota": 5, "comentario": "top"},
                   headers=AUTH)
        assert r.status_code == 200
        assert r.json()["nota"] == 5

    def test_sugestao_publica(self, s):
        r = s.post(f"{API}/sugestoes", json={"cliente": "TEST_Sug", "mensagem": "Quero X"})
        assert r.status_code == 200
        d = r.json()
        assert d["mensagem"] == "Quero X"
        assert d["lida"] is False

    def test_compra_publica(self, s):
        pid = TestFullFlow.created["perfume_id"]
        r = s.post(f"{API}/compras", json={
            "perfumeId": pid, "perfumeNome": "TEST_Contratipo_A",
            "ml": 50, "preco": 120.0, "cliente": "TEST_Buyer", "contato": "999"
        })
        assert r.status_code == 200
        assert r.json()["status"] == "pendente"

    def test_publish_vitrine(self, s):
        r = s.post(f"{API}/vitrine/publish", headers=AUTH)
        assert r.status_code == 200
        snap = r.json()
        assert "atualizadoEm" in snap
        assert isinstance(snap["itens"], list)
        pid = TestFullFlow.created["perfume_id"]
        item = next((i for i in snap["itens"] if i["id"] == pid), None)
        assert item is not None, "Perfume criado nao apareceu na vitrine publicada"
        assert "disponivel" in item

        # Re-GET
        r2 = s.get(f"{API}/vitrine").json()
        assert len(r2["itens"]) == len(snap["itens"])

    # --- cleanup ---
    def test_zzz_cleanup(self, s):
        # delete pedido
        pid_p = TestFullFlow.created.get("pedido_id")
        if pid_p:
            s.delete(f"{API}/pedidos/{pid_p}", headers=AUTH)
        # delete TEST_ perfumes
        perfumes = s.get(f"{API}/perfumes").json()
        for p in perfumes:
            if p["nome"].startswith("TEST_"):
                s.delete(f"{API}/perfumes/{p['id']}", headers=AUTH)
        # delete TEST_ sugestoes/compras
        for sug in s.get(f"{API}/sugestoes", headers=AUTH).json():
            if "TEST" in sug.get("cliente", "") or "TEST" in sug.get("mensagem", ""):
                s.delete(f"{API}/sugestoes/{sug['id']}", headers=AUTH)
        for c in s.get(f"{API}/compras", headers=AUTH).json():
            if "TEST" in c.get("cliente", "") or "TEST" in c.get("perfumeNome", ""):
                s.delete(f"{API}/compras/{c['id']}", headers=AUTH)
