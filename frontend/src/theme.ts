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
};

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const RADIUS = { sm: 6, md: 12, lg: 20, pill: 999 };

export const STATUS = [
  { id: 'pendente', label: 'Aguardando pagamento', color: '#C7A25C' },
  { id: 'pagamento_confirmado', label: 'Pagamento confirmado', color: '#A98A56' },
  { id: 'preparando', label: 'Preparando', color: '#8C3A4A' },
  { id: 'pronto', label: 'Pronto', color: '#9A7554' },
  { id: 'enviado', label: 'Enviado', color: '#6E8FA0' },
  { id: 'entregue', label: 'Entregue', color: '#8FA07A' },
  { id: 'cancelado', label: 'Cancelado', color: '#C1552F' },
] as const;

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
