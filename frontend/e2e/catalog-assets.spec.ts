/// <reference types="node" />
import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import catalogImages from '../src/data/catalogImages.json';
import { resolvePerfumeImageUrl, withOptimizedPerfumeImages } from '../src/utils/perfumeImages';
import { perfumeNotes } from '../src/utils/perfumeNotes';
import type { Perfume } from '../src/types';

const [id, prepared] = Object.entries(catalogImages)[0];
const perfume: Perfume = {
  id, seq: 1, nome: 'Perfume de teste', inspiracao: '', imagemUrl: prepared.source,
  ocasioes: ['Dia'], familia: 'Cítrico', concentracao: 'EDP',
  notasSaida: 'Bergamota, Toranja, Gengibre', notasCoracao: '', notasFundo: '',
  precos: [{ ml: 30, preco: 50 }], estoqueMinimoMl: 0, publicavel: true,
  estoqueAtualMl: 120, custoEssenciaPorMl: 1.25,
};

test('todos os ativos do catálogo existem e correspondem ao hash publicado', () => {
  expect(Object.keys(catalogImages).length).toBeGreaterThan(0);
  for (const image of Object.values(catalogImages)) {
    expect(image.source).toMatch(/^https:\/\//);
    expect(image.path).toMatch(/^\/perfume-images\/catalog-[a-f0-9]{24}\.avif$/);
    const data = readFileSync(path.join(process.cwd(), 'public', image.path));
    expect(data.subarray(4, 8).toString()).toBe('ftyp');
    expect(data.subarray(8, 32).toString()).toContain('avif');
    expect(image.path).toContain(createHash('sha256').update(data).digest('hex').slice(0, 24));
  }
});

test('a mesma origem e produto resolvem para a foto hospedada sem mudar os dados', () => {
  const before = JSON.stringify(perfume);
  const [optimized] = withOptimizedPerfumeImages([perfume]);
  expect(optimized.imagemUrl).toBe(`https://lessence-furlani-vitrine.onrender.com${prepared.path}`);
  expect({ ...optimized, imagemUrl: perfume.imagemUrl }).toEqual(perfume);
  expect(JSON.stringify(perfume)).toBe(before);
  expect(withOptimizedPerfumeImages([optimized])).toEqual([optimized]);
});

test('qualquer nova foto escolhida tem prioridade e outro produto não herda a antiga', () => {
  for (const extension of ['jpg', 'webp', 'avif']) {
    const imagemUrl = `https://example.com/nova-foto.${extension}?v=2`;
    expect(resolvePerfumeImageUrl({ ...perfume, imagemUrl })).toBe(imagemUrl);
  }
  expect(resolvePerfumeImageUrl({ ...perfume, id: 'outro-id-mesma-sequencia' })).toBe(perfume.imagemUrl);
  expect(resolvePerfumeImageUrl({ ...perfume, imagemUrl: '' })).toBe('');
});

test('lista única de notas não inventa fases ausentes da fragrância', () => {
  expect(perfumeNotes(perfume)).toEqual({
    title: 'NOTAS OLFATIVAS',
    rows: [{ label: 'NOTAS', value: 'Bergamota, Toranja, Gengibre' }],
  });
  expect(perfumeNotes({ ...perfume, notasSaida: '  ' }).rows).toEqual([]);
});

test('pirâmide completa mantém topo, coração e fundo', () => {
  expect(perfumeNotes({ ...perfume, notasCoracao: 'Rosa', notasFundo: 'Âmbar' })).toEqual({
    title: 'PIRÂMIDE OLFATIVA',
    rows: [
      { label: 'TOPO', value: perfume.notasSaida },
      { label: 'CORAÇÃO', value: 'Rosa' },
      { label: 'FUNDO', value: 'Âmbar' },
    ],
  });
});
