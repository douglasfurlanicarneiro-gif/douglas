import type { Perfume } from '../types';
import catalogImages from '../data/catalogImages.json';

const images: Record<string, { source: string; path: string }> = catalogImages;
const PRODUCTION_ORIGIN = 'https://lessence-furlani-vitrine.onrender.com';

function imageOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return PRODUCTION_ORIGIN;
}

export function resolvePerfumeImageUrl(perfume: Perfume): string {
  const configuredImage = (perfume.imagemUrl || '').trim();
  const prepared = images[perfume.id];
  // Uma conversão só corresponde ao mesmo produto E à mesma foto de origem.
  // Qualquer nova seleção no painel tem prioridade, inclusive JPG e WebP.
  if (prepared && prepared.source === configuredImage) {
    return `${imageOrigin()}${prepared.path}`;
  }
  return configuredImage;
}

export function withOptimizedPerfumeImages(perfumes: Perfume[]): Perfume[] {
  return perfumes.map((perfume) => ({
    ...perfume,
    imagemUrl: resolvePerfumeImageUrl(perfume),
  }));
}
