import { Linking, Platform } from 'react-native';

export function isInfinitePayCheckoutUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && (
      host === 'infinitepay.com.br'
      || host.endsWith('.infinitepay.com.br')
      || host === 'infinitepay.io'
      || host.endsWith('.infinitepay.io')
    );
  } catch {
    return false;
  }
}

export async function openInfinitePayCheckout(value: string): Promise<void> {
  if (!isInfinitePayCheckoutUrl(value)) {
    throw new Error('Endereço de pagamento inválido.');
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.location.assign(value);
    return;
  }

  await Linking.openURL(value);
}
