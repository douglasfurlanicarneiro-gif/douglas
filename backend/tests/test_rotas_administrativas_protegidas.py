from fastapi.routing import APIRoute

from rate_limit import login_rate_limit
from server import app

PUBLIC_ROUTES = {
    ("POST", "/api/auth/login"),
    ("GET", "/api/cep/{cep}"),
    ("GET", "/api/opinioes"),
    ("POST", "/api/opinioes"),
    ("POST", "/api/pagamentos/infinitepay/webhook"),
    ("POST", "/api/pagamentos/infinitepay/confirmar"),
    ("POST", "/api/sugestoes"),
    ("POST", "/api/compras"),
    ("POST", "/api/frete/cotar"),
    ("GET", "/api/integracoes/melhor-envio/callback"),
    ("GET", "/api/vitrine"),
    ("GET", "/api/acompanhamento/{codigo}"),
    ("POST", "/api/acompanhamento/{codigo}/cancelar"),
    ("POST", "/api/privacidade/solicitacoes"),
    ("GET", "/api/privacidade/solicitacoes/status/{protocolo}"),
    ("GET", "/api/admin/configuracoes/publicas"),
    ("GET", "/api/admin/pedidos/reset-version"),
}


def _rotas(routes):
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        elif type(route).__name__ == "_IncludedRouter":
            yield from _rotas(route.original_router.routes)


def _dependencias(route):
    nomes = set()
    fila = list(route.dependant.dependencies)
    while fila:
        dependencia = fila.pop()
        nomes.add(getattr(dependencia.call, "__name__", ""))
        fila.extend(dependencia.dependencies)
    return nomes


def test_toda_rota_nao_publica_exige_autenticacao_administrativa():
    desprotegidas = []
    for route in _rotas(app.routes):
        if not route.path.startswith("/api"):
            continue
        for method in route.methods or set():
            if (method, route.path) in PUBLIC_ROUTES:
                continue
            if "require_atelie_auth" not in _dependencias(route):
                desprotegidas.append(f"{method} {route.path}")

    assert desprotegidas == []


def test_login_possui_limite_global_por_origem():
    login = next(
        route
        for route in _rotas(app.routes)
        if route.path == "/api/auth/login" and "POST" in route.methods
    )
    assert any(
        dependencia.call is login_rate_limit
        for dependencia in login.dependant.dependencies
    )


def test_operacoes_destrutivas_exigem_reautenticacao_recente():
    rotas_criticas = {
        ("POST", "/api/admin/backup/restaurar"),
        ("POST", "/api/admin/dados/{recurso}/limpar"),
        ("POST", "/api/admin/pedidos/reset"),
    }
    encontradas = set()
    for route in _rotas(app.routes):
        for method in route.methods or set():
            chave = (method, route.path)
            if chave not in rotas_criticas:
                continue
            encontradas.add(chave)
            assert "require_step_up_auth" in _dependencias(route)
            assert "require_atelie_auth" in _dependencias(route)

    assert encontradas == rotas_criticas
