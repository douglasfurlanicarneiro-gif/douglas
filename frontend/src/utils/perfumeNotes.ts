import type { Perfume } from '../types';

type Notes = Pick<Perfume, 'notasSaida' | 'notasCoracao' | 'notasFundo'>;

export function perfumeNotes(perfume: Notes) {
  const rows = [
    { label: 'TOPO', value: perfume.notasSaida?.trim() || '' },
    { label: 'CORAÇÃO', value: perfume.notasCoracao?.trim() || '' },
    { label: 'FUNDO', value: perfume.notasFundo?.trim() || '' },
  ].filter((row) => Boolean(row.value));
  return {
    title: rows.length > 1 ? 'PIRÂMIDE OLFATIVA' : 'NOTAS OLFATIVAS',
    rows: rows.length === 1 ? [{ ...rows[0], label: 'NOTAS' }] : rows,
  };
}
