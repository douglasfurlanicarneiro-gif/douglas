const PIX_KEY = process.env.EXPO_PUBLIC_PIX_KEY || 'douglasfurlanicarneiro@gmail.com';
const RECEIVER_NAME = process.env.EXPO_PUBLIC_PIX_RECEIVER_NAME || 'L ESSENCE FURLANI';
const RECEIVER_CITY = process.env.EXPO_PUBLIC_PIX_RECEIVER_CITY || 'SAO PAULO';

const tlv = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, '0')}${value}`;

const pixText = (value: string, maximum: number) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maximum);

const crc16 = (payload: string) => {
  let crc = 0xFFFF;
  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

export function createManualPixPayload(reference: string, value: number) {
  const txid = reference.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 25) || '***';
  const merchantAccount = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', PIX_KEY);
  const payload = [
    tlv('00', '01'),
    tlv('01', '11'),
    tlv('26', merchantAccount),
    tlv('52', '0000'),
    tlv('53', '986'),
    tlv('54', Number(value || 0).toFixed(2)),
    tlv('58', 'BR'),
    tlv('59', pixText(RECEIVER_NAME, 25)),
    tlv('60', pixText(RECEIVER_CITY, 15)),
    tlv('62', tlv('05', txid)),
  ].join('');
  const payloadWithCrcTag = `${payload}6304`;
  return `${payloadWithCrcTag}${crc16(payloadWithCrcTag)}`;
}
