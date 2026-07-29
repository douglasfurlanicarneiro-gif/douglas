from payments.pix import _crc16, criar_pix_copia_e_cola


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
    payload = criar_pix_copia_e_cola("pedido-123", 80)
    fields = _read_tlv(payload)
    merchant_fields = _read_tlv(fields["26"])

    assert fields["00"] == "01"
    assert fields["01"] == "11"
    assert fields["53"] == "986"
    assert fields["54"] == "80.00"
    assert merchant_fields["00"] == "BR.GOV.BCB.PIX"
    assert merchant_fields["01"] == "douglasfurlanicarneiro@gmail.com"
    assert fields["63"] == _crc16(payload[:-4])
