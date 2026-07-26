import { storage } from './utils/storage';
import type {
  CheckoutPayload,
  Compra,
  Movimento,
  Opiniao,
  Pedido,
  Perfume,
  Sugestao,
} from './types';

const previewHostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLocalWebPreview = previewHostname === 'localhost'
  || previewHostname === '127.0.0.1'
  || previewHostname.endsWith('.exp.direct');
const BASE = isLocalWebPreview ? '' : (process.env.EXPO_PUBLIC_BACKEND_URL || '');
export const API = `${BASE}/api`;

const TOKEN_KEY = 'atelie-token-v1';
const REQUEST_TIMEOUT_MS = 15000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Token do Ateliê guardado no armazenamento seguro (Keychain/EncryptedSharedPreferences),
// não em AsyncStorage puro — é uma credencial de acesso ao painel administrativo.
export async function saveToken(token: string) { await storage.secureSet(TOKEN_KEY, token); }
export async function getToken(): Promise<string | null> { return storage.secureGet(TOKEN_KEY, null); }
export async function clearToken() { await storage.secureRemove(TOKEN_KEY); }

async function request<T>(path: string, opts: RequestInit = {}, needsAuth = false): Promise<T> {
  const headers = new Headers(opts.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (needsAuth) {
    const t = await getToken();
    if (!t) throw new ApiError('Sua sessão expirou. Entre novamente.', 401);
    headers.set('x-atelie-token', t);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API}${path}`, { ...opts, headers, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = body && typeof body === 'object' && 'detail' in body ? String(body.detail) : '';
      throw new ApiError(detail || 'Não foi possível concluir a solicitação.', response.status);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError('A conexão demorou demais. Tente novamente.', 408);
    }
    throw new ApiError('Não foi possível conectar ao servidor.', 0);
  } finally {
    clearTimeout(timeout);
  }
}

// Auth
export const login = (usuario: string, senha: string) =>
  request<{ ok: boolean; token?: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ usuario, senha }) });

// Perfumes
export const listPerfumes = () => request<Perfume[]>('/perfumes');
export const createPerfume = (data: Omit<Perfume, 'id' | 'seq'>) => request<Perfume>('/perfumes', { method: 'POST', body: JSON.stringify(data) }, true);
export const updatePerfume = (id: string, data: Partial<Perfume>) => request<Perfume>(`/perfumes/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true);
export const deletePerfume = (id: string) => request<{ status: string }>(`/perfumes/${id}`, { method: 'DELETE' }, true);
export const bulkImport = (nomes: string[]) => request<{ adicionados: number }>('/perfumes/bulk-import', { method: 'POST', body: JSON.stringify({ nomes }) }, true);
export const padronizarTamanhos = () => request<{ atualizados: number }>('/perfumes/padronizar-tamanhos', { method: 'POST' }, true);

// Estoque
export const listMovimentos = () => request<Movimento[]>('/movimentos', {}, true);
export const createMovimento = (data: Omit<Movimento, 'id' | 'origem' | 'data'>) => request<Movimento>('/movimentos', { method: 'POST', body: JSON.stringify(data) }, true);
export const completarEstoque = (quantidadeMl = 1000) => request<{
  perfumesConsiderados: number;
  perfumesAtualizados: number;
  estoqueAlvoMl: number;
}>('/movimentos/completar-estoque', {
  method: 'POST',
  body: JSON.stringify({ quantidadeMl, somentePublicaveis: true }),
}, true);
export const getEstoqueMap = () => request<Record<string, number>>('/estoque');

// Pedidos
export const listPedidos = () => request<Pedido[]>('/pedidos', {}, true);
export const createPedido = (data: Omit<Pedido, 'id' | 'seq' | 'criadoEm'>) => request<Pedido>('/pedidos', { method: 'POST', body: JSON.stringify(data) }, true);
export const updatePedido = (id: string, data: Partial<Pedido>) => request<Pedido>(`/pedidos/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true);
export const deletePedido = (id: string) => request<{ status: string }>(`/pedidos/${id}`, { method: 'DELETE' }, true);

// Opinioes
export const listOpinioes = () => request<Opiniao[]>('/opinioes');
export const createOpiniao = (data: Omit<Opiniao, 'id' | 'data'>) => request<Opiniao>('/opinioes', { method: 'POST', body: JSON.stringify(data) });
export const deleteOpiniao = (id: string) => request<{ status: string }>(`/opinioes/${id}`, { method: 'DELETE' }, true);

// Vitrine
export const getVitrine = () => request<{ atualizadoEm: string | null; itens: Perfume[] }>('/vitrine');
export const publishVitrine = () => request<{ atualizadoEm: string; itensPublicados: number }>('/vitrine/publish', { method: 'POST' }, true);

// Sugestões
export const createSugestao = (data: Pick<Sugestao, 'cliente' | 'contato' | 'mensagem'>) => request<Sugestao>('/sugestoes', { method: 'POST', body: JSON.stringify(data) });
export const listSugestoes = () => request<Sugestao[]>('/sugestoes', {}, true);
export const deleteSugestao = (id: string) => request<{ status: string }>(`/sugestoes/${id}`, { method: 'DELETE' }, true);

// Compras
export const createCompra = (data: CheckoutPayload) => request<Compra>('/compras', { method: 'POST', body: JSON.stringify(data) });
export const listCompras = () => request<Compra[]>('/compras', {}, true);
export const deleteCompra = (id: string) => request<{ status: string }>(`/compras/${id}`, { method: 'DELETE' }, true);
