from client_identity import anonymous_client_key, client_address


class RequestWithCloudflare:
    headers = {
        "cf-connecting-ip": "203.0.113.10",
        "x-forwarded-for": "198.51.100.1, 192.0.2.1",
    }
    client = None


class RequestWithProxy:
    headers = {"x-forwarded-for": "198.51.100.8, 192.0.2.5"}
    client = None


def test_cloudflare_tem_prioridade_e_forwarded_usa_primeiro_cliente():
    assert client_address(RequestWithCloudflare()) == "203.0.113.10"
    assert client_address(RequestWithProxy()) == "198.51.100.8"


def test_chave_anonima_e_estavel_sem_expor_ip():
    primeira = anonymous_client_key(RequestWithCloudflare(), "checkout")
    segunda = anonymous_client_key(RequestWithCloudflare(), "checkout")

    assert primeira == segunda
    assert len(primeira) == 32
    assert "203.0.113.10" not in primeira
