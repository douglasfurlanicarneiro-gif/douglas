import type { ConfiguracoesLoja, ConfiguracoesLojaPublicas } from './types';

export const DEFAULT_STORE_CONFIG: ConfiguracoesLojaPublicas = {
  nomeLoja: 'L’Essence Furlani',
  logoUrl: '',
  whatsapp: '',
  instagram: '',
  email: '',
  pix: '',
};

export function publicStoreConfig(
  config?: Partial<ConfiguracoesLoja> | Partial<ConfiguracoesLojaPublicas> | null,
): ConfiguracoesLojaPublicas {
  return {
    nomeLoja: config?.nomeLoja?.trim() || DEFAULT_STORE_CONFIG.nomeLoja,
    logoUrl: config?.logoUrl?.trim() || '',
    whatsapp: config?.whatsapp?.trim() || '',
    instagram: config?.instagram?.trim() || '',
    email: config?.email?.trim() || '',
    pix: config?.pix?.trim() || '',
  };
}

export function storeNameParts(value?: string) {
  const name = value?.trim() || DEFAULT_STORE_CONFIG.nomeLoja;
  const words = name.split(/\s+/);
  if (words.length === 1) {
    return { eyebrow: '', title: words[0], full: name };
  }
  return {
    eyebrow: words.slice(0, -1).join(' ').toUpperCase(),
    title: words[words.length - 1].toUpperCase(),
    full: name,
  };
}

export function whatsappNumber(value?: string) {
  const digits = (value || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function instagramLink(value?: string) {
  const instagram = (value || '').trim();
  if (!instagram) return '';
  if (/^https?:\/\//i.test(instagram)) return instagram;
  return `https://instagram.com/${instagram.replace(/^@/, '')}`;
}
