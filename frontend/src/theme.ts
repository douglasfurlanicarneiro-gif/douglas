import type { OrderStatus } from './types';
import { Platform } from 'react-native';

export const COLORS = {
  ink: '#15130F',
  background: '#D8CBB9',
  surface: '#F3ECE2',
  surfaceRaised: '#EADFCF',
  border: '#C5AF8F',
  gold: '#C7A25C',
  wine: '#8C3A4A',
  favorite: '#B63F4B',
  bone: '#251F18',
  muted: '#746858',
  sage: '#8FA07A',
  rust: '#C1552F',
  topNote: '#C9A227',
  heartNote: '#C06E7E',
  baseNote: '#8A6438',
  inverse: '#FFF9F0',
  white: '#FFFFFF',
};

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const RADIUS = { sm: 6, md: 12, lg: 20, pill: 999 };

export const FONTS = {
  regular: 'DMSans_400Regular',
  italic: 'DMSans_400Regular_Italic',
  medium: 'DMSans_500Medium',
  semiBold: 'DMSans_600SemiBold',
  bold: 'DMSans_700Bold',
  editorial: Platform.select({ ios: 'Georgia', android: 'serif', web: 'Georgia, serif', default: 'serif' }),
} as const;

export const FONT_SIZES = {
  micro: 8,
  compact: 10,
  caption: 11,
  label: 12,
  bodySmall: 13,
  body: 14,
  bodyLarge: 15,
  subtitle: 16,
  heading: 18,
  title: 20,
  titleLarge: 22,
  display: 26,
  hero: 36,
} as const;

export const TYPOGRAPHY = {
  display: { fontSize: FONT_SIZES.display, lineHeight: 32, fontWeight: '700' as const },
  title: { fontSize: FONT_SIZES.title, lineHeight: 26, fontWeight: '700' as const },
  subtitle: { fontSize: FONT_SIZES.subtitle, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: FONT_SIZES.body, lineHeight: 20, fontWeight: '400' as const },
  bodySmall: { fontSize: FONT_SIZES.bodySmall, lineHeight: 18, fontWeight: '400' as const },
  bodyLarge: { fontSize: FONT_SIZES.bodyLarge, lineHeight: 21, fontWeight: '500' as const },
  label: { fontSize: FONT_SIZES.label, lineHeight: 17, fontWeight: '600' as const },
  caption: { fontSize: FONT_SIZES.caption, lineHeight: 15, fontWeight: '400' as const },
  eyebrow: { fontSize: FONT_SIZES.caption, lineHeight: 15, fontWeight: '600' as const, letterSpacing: 1.4 },
  heading: { fontSize: FONT_SIZES.heading, lineHeight: 24, fontWeight: '600' as const },
  titleLarge: { fontSize: FONT_SIZES.titleLarge, lineHeight: 28, fontWeight: '700' as const },
} as const;

export const STATUS = [
  { id: 'pendente', label: 'Aguardando pagamento', color: '#C7A25C' },
  { id: 'pagamento_confirmado', label: 'Pagamento confirmado', color: '#A98A56' },
  { id: 'preparando', label: 'Preparando', color: '#8C3A4A' },
  { id: 'pronto', label: 'Pronto', color: '#9A7554' },
  { id: 'enviado', label: 'Enviado', color: '#6E8FA0' },
  { id: 'entregue', label: 'Entregue', color: '#8FA07A' },
  { id: 'cancelado', label: 'Cancelado', color: '#C1552F' },
] as const;

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pendente: ['pagamento_confirmado', 'cancelado'],
  pagamento_confirmado: ['preparando', 'cancelado'],
  preparando: ['pronto', 'cancelado'],
  pronto: ['enviado', 'entregue', 'cancelado'],
  enviado: ['entregue'],
  entregue: [],
  cancelado: [],
};

export const statusPermitidosNoPainel = (
  atual?: OrderStatus,
): OrderStatus[] => {
  if (!atual) return ['pendente'];
  return [
    atual,
    ...ORDER_STATUS_TRANSITIONS[atual].filter((status) => status !== 'cancelado'),
  ];
};

export const FAMILIAS = [
  'Almiscarado',
  'Amadeirado',
  'Ambarado',
  'Animálico',
  'Aquático',
  'Aromático',
  'Balsâmico',
  'Cítrico',
  'Couro',
  'Especiado Quente',
  'Floral',
  'Frutado',
  'Oriental',
  'Verde',
];

export const CONCENTRACOES = ['Eau De Parfum', 'Eau De Toilette', 'Elixir'];

export const OCASIOES = [
  'Academia',
  'Casual',
  'Dia',
  'Encontros',
  'Festa',
  'Inverno',
  'Meia-estação',
  'Noite',
  'Ocasiões especiais',
  'Outono',
  'Primavera',
  'Trabalho',
  'Uso diário',
  'Verão',
  'Viagem',
];

export const familiasDoPerfume = (perfume: { familia?: string; familias?: string[] }) => {
  const familias = Array.isArray(perfume.familias) ? perfume.familias.filter(Boolean) : [];
  return familias.length ? familias : (perfume.familia ? [perfume.familia] : []);
};

export const nomeConcentracao = (concentracao?: string) => ({
  EDP: 'Eau De Parfum',
  EDT: 'Eau De Toilette',
  EDC: 'Eau De Toilette',
  Extrait: 'Elixir',
}[concentracao || ''] || concentracao || '');

export const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtDate = (iso?: string | null) => { if (!iso) return ''; try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return ''; } };
export const padSeq = (n: number) => String(n || 0).padStart(3, '0');
