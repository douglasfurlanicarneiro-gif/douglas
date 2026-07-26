import { storage } from './utils/storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || '';
export const API = `${BASE}/api`;

const TOKEN_KEY = 'atelie-token-v1';

// Token do Ateliê guardado no armazenamento seguro (Keychain/EncryptedSharedPreferences),
// não em AsyncStorage puro — é uma credencial de acesso ao painel administrativo.
export async function saveToken(token: string) { await storage.secureSet(TOKEN_KEY, token); }
export async function getToken(): Promise<string | null> { return storage.secureGet(TOKEN_KEY, null); }
export async function clearToken() { await storage.secureRemove(TOKEN_KEY); }

async function request<T>(path: string, opts: RequestInit = {}, needsAuth = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers as any) };
  if (needsAuth) {
    const t = await getToken();
    if (t) headers['x-atelie-token'] = t;
  }
  const r = await fetch(`${API}${path}`, { ...opts, headers });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// Auth
export const login = (usuario: string, senha: string) =>
  request<{ ok: boolean; token?: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ usuario, senha }) });

// Perfumes
export const listPerfumes = () => request<any[]>('/perfumes');
export const createPerfume = (data: any) => request<any>('/perfumes', { method: 'POST', body: JSON.stringify(data) }, true);
export const updatePerfume = (id: string, data: any) => request<any>(`/perfumes/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true);
export const deletePerfume = (id: string) => request<any>(`/perfumes/${id}`, { method: 'DELETE' }, true);
export const bulkImport = (nomes: string[]) => request<{ adicionados: number }>('/perfumes/bulk-import', { method: 'POST', body: JSON.stringify({ nomes }) }, true);
export const padronizarTamanhos = () => request<{ atualizados: number }>('/perfumes/padronizar-tamanhos', { method: 'POST' }, true);

// Estoque
export const listMovimentos = () => request<any[]>('/movimentos', {}, true);
export const createMovimento = (data: any) => request<any>('/movimentos', { method: 'POST', body: JSON.stringify(data) }, true);
export const getEstoqueMap = () => request<Record<string, number>>('/estoque');

// Pedidos
export const listPedidos = () => request<any[]>('/pedidos', {}, true);
export const createPedido = (data: any) => request<any>('/pedidos', { method: 'POST', body: JSON.stringify(data) }, true);
export const updatePedido = (id: string, data: any) => request<any>(`/pedidos/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true);
export const deletePedido = (id: string) => request<any>(`/pedidos/${id}`, { method: 'DELETE' }, true);

// Opinioes
export const listOpinioes = () => request<any[]>('/opinioes');
export const createOpiniao = (data: any) => request<any>('/opinioes', { method: 'POST', body: JSON.stringify(data) });
export const deleteOpiniao = (id: string) => request<any>(`/opinioes/${id}`, { method: 'DELETE' }, true);

// Vitrine
export const getVitrine = () => request<{ atualizadoEm: string | null; itens: any[] }>('/vitrine');
export const publishVitrine = () => request<any>('/vitrine/publish', { method: 'POST' }, true);

// Sugestões
export const createSugestao = (data: any) => request<any>('/sugestoes', { method: 'POST', body: JSON.stringify(data) });
export const listSugestoes = () => request<any[]>('/sugestoes', {}, true);
export const deleteSugestao = (id: string) => request<any>(`/sugestoes/${id}`, { method: 'DELETE' }, true);

// Compras
export const createCompra = (data: any) => request<any>('/compras', { method: 'POST', body: JSON.stringify(data) });
export const listCompras = () => request<any[]>('/compras', {}, true);
export const deleteCompra = (id: string) => request<any>(`/compras/${id}`, { method: 'DELETE' }, true);
