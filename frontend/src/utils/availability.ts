import type { Perfume } from '../types';

export function tamanhoDisponivel(perfume: Perfume, ml: number): boolean {
  if (perfume.prontaEntrega !== true) return true;
  if (Array.isArray(perfume.tamanhosDisponiveisMl)) {
    return perfume.tamanhosDisponiveisMl.includes(ml);
  }
  // Compatibilidade durante o intervalo entre o deploy do frontend e da API.
  return perfume.disponivel !== false;
}
