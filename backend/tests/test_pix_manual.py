import pytest

from payments import pix


def _read_tlv(payload: str):
    index = 0
    fields = {}
    while index < len(payload):
        tag = payload[index:index + 2]
        length = int(payload[index + 2:index + 4])
        value_start = index + 4
        value_end = value_start + length
        fields[tag] = payload[value_start:value_end]
        index = value_end
    return fields


def test_pix_manual_inclui_valor_chave_e_crc_valido():
    payload = pix.criar_pix_copia_e_cola(
        "pedido-123",
        80,
        pix_key="chave-pix-de-teste",
    )
    fields = _read_tlv(payload)
    merchant_fields = _read_tlv(fields["26"])

    assert fields["00"] == "01"
    assert fields["01"] == "11"
    assert fields["53"] == "986"
    assert fields["54"] == "80.00"
    assert merchant_fields["00"] == "BR.GOV.BCB.PIX"
    assert merchant_fields["01"] == "chave-pix-de-teste"
    assert fields["63"] == pix._crc16(payload[:-4])


def test_pix_manual_sem_chave_fica_desabilitado(monkeypatch):
    monkeypatch.setattr(pix, "PIX_KEY", "")

    with pytest.raises(RuntimeError, match="Cadastre uma chave no painel"):
        pix.criar_pix_copia_e_cola("pedido-sem-chave", 50)
