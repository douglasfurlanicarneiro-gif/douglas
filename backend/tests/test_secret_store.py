import pytest

import secret_store


def test_credencial_e_criptografada_e_recuperada(monkeypatch):
    monkeypatch.setattr(
        secret_store,
        "BACKUP_ENCRYPTION_KEY",
        "chave-separada-de-teste-com-mais-de-trinta-e-dois-caracteres",
    )
    token = "token-secreto-melhor-envio"
    encrypted = secret_store.encrypt_secret(token, context="integracao-teste")

    assert encrypted.startswith("enc:v1:")
    assert token not in encrypted
    assert secret_store.decrypt_secret(encrypted, context="integracao-teste") == token


def test_contexto_diferente_nao_descriptografa(monkeypatch):
    monkeypatch.setattr(
        secret_store,
        "BACKUP_ENCRYPTION_KEY",
        "chave-separada-de-teste-com-mais-de-trinta-e-dois-caracteres",
    )
    encrypted = secret_store.encrypt_secret("segredo", context="acesso")

    with pytest.raises(secret_store.SecretProtectionError):
        secret_store.decrypt_secret(encrypted, context="refresh")


def test_valor_legado_continua_legivel_para_migracao(monkeypatch):
    monkeypatch.setattr(secret_store, "BACKUP_ENCRYPTION_KEY", "chave-de-teste")
    assert secret_store.decrypt_secret("token-legado", context="acesso") == "token-legado"
