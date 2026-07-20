export const COLORS = {
  ink: '#15130F',
  surface: '#1F1B14',
  surfaceRaised: '#29241B',
  border: '#3A3327',
  gold: '#C7A25C',
  wine: '#8C3A4A',
  bone: '#EDE7D8',
  muted: '#A79C87',
  sage: '#8FA07A',
  rust: '#C1552F',
  topNote: '#C9A227',
  heartNote: '#C06E7E',
  baseNote: '#8A6438',
};

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const RADIUS = { sm: 6, md: 12, lg: 20, pill: 999 };

export const STATUS = [
  { id: 'pendente', label: 'Pendente', color: '#C7A25C' },
  { id: 'preparando', label: 'Preparando', color: '#8C3A4A' },
  { id: 'enviado', label: 'Enviado', color: '#6E8FA0' },
  { id: 'entregue', label: 'Entregue', color: '#8FA07A' },
  { id: 'cancelado', label: 'Cancelado', color: '#C1552F' },
];

export const FAMILIAS = ['Amadeirado', 'Floral', 'Oriental', 'Cítrico', 'Aromático', 'Chipre', 'Gourmand', 'Aquático'];
export const CONCENTRACOES = ['Extrait', 'EDP', 'EDT', 'EDC'];

export const brl = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const fmtDate = (iso?: string | null) => { if (!iso) return ''; try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return ''; } };
export const padSeq = (n: number) => String(n || 0).padStart(3, '0');
