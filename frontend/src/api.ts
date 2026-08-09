import { storage } from './utils/storage';
import type {
  CheckoutPayload,
  Compra,
  Acompanhamento,
  Metricas,
  Movimento,
  Opiniao,
  Pedido,
  Perfume,
  OpcaoFrete,
  ConfiguracaoFrete,
  ConfiguracoesLoja,
  ConfiguracoesLojaPublicas,
  CatalogoEstoqueResumo,
  Sugestao,
  ConfirmacaoInfinitePay,
  CustosConfig,
  RentabilidadeItem,
  Fornecedor,
  CotacaoFornecedor,
  Insumo,
  PlanoProducao,
} from './types';

const previewHostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLocalWebPreview = previewHostname === 'localhost'
  || previewHostname === '127.0.0.1'
  || previewHostname.endsWith('.exp.direct');
const BASE = isLocalWebPreview ? '' : (process.env.EXPO_PUBLIC_BACKEND_URL || '');
export const API = `${BASE}/api`;

const TOKEN_KEY = 'atelie-token-v1';
const REQUEST_TIMEOUT_MS = 15000;
const READ_REQUEST_TIMEOUT_MS = 65000;
const COLD_START_TIMEOUT_MS = 65000;
let sessionExpiredHandler: (() => void) | null = null;

type VitrineResponse = {
  atualizadoEm: string | null;
  itens: Perfume[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function apiErrorMessage(body: unknown): string {
  if (!body || typeof body !== 'object' || !('detail' in body)) return '';
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;

  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const error = item as { loc?: unknown; msg?: unknown };
      const location = Array.isArray(error.loc) ? error.loc.map(String) : [];
      if (location.includes('email')) return ['Informe um e-mail válido.'];
      if (typeof error.msg !== 'string') return [];
      return [error.msg.replace(/^Value error,\s*/i, '')];
    });
    return [...new Set(messages)].join(' ');
  }

  if (detail && typeof detail === 'object' && 'message' in detail) {
    const message = (detail as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }
  return '';
}

// Token do Ateliê guardado no armazenamento seguro (Keychain/EncryptedSharedPreferences),
// não em AsyncStorage puro — é uma credencial de acesso ao painel administrativo.
export async function saveToken(token: string) { await storage.secureSet(TOKEN_KEY, token); }
export async function getToken(): Promise<string | null> { return storage.secureGet(TOKEN_KEY, null); }
export async function clearToken() { await storage.secureRemove(TOKEN_KEY); }
export function setSessionExpiredHandler(handler: (() => void) | null) {
  sessionExpiredHandler = handler;
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
  needsAuth = false,
  timeoutMs?: number,
): Promise<T> {
  const headers = new Headers(opts.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (needsAuth) {
    const t = await getToken();
    if (!t) throw new ApiError('Sua sessão expirou. Entre novamente.', 401);
    headers.set('x-atelie-token', t);
  }
  const controller = new AbortController();
  const effectiveTimeout = timeoutMs
    ?? ((!opts.method || opts.method === 'GET') ? READ_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const response = await fetch(`${API}${path}`, { ...opts, headers, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (needsAuth && response.status === 401) {
        await clearToken();
        sessionExpiredHandler?.();
      }
      const detail = apiErrorMessage(body);
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
export const listPerfumes = () => request<Perfume[]>('/perfumes', {}, true);
export const createPerfume = (data: Omit<Perfume, 'id' | 'seq'>) => request<Perfume>('/perfumes', { method: 'POST', body: JSON.stringify(data) }, true);
export const updatePerfume = (id: string, data: Partial<Perfume>) => request<Perfume>(`/perfumes/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true);
export const deletePerfume = (id: string) => request<{ status: string }>(`/perfumes/${id}`, { method: 'DELETE' }, true);
export const bulkImport = (nomes: string[]) => request<{ adicionados: number }>('/perfumes/bulk-import', { method: 'POST', body: JSON.stringify({ nomes }) }, true);
export const definirProntaEntrega = (nomes: string[]) => request<{
  prontaEntrega: number;
  sobEncomenda: number;
  encontrados: string[];
  naoEncontrados: string[];
  ambiguos: string[];
}>('/perfumes/pronta-entrega', {
  method: 'POST',
  body: JSON.stringify({ nomes }),
}, true);
export const padronizarTamanhos = () => request<{
  atualizados: number;
  precosPadrao: { ml: number; preco: number }[];
}>('/perfumes/padronizar-tamanhos', { method: 'POST' }, true);
export const aplicarPrecos = (data: {
  precos: { ml: number; preco: number }[];
  tamanhos: number[];
}) => request<{
  atualizados: number;
  tamanhos: number[];
  itensPublicados: number;
  atualizadoEm: string;
}>('/perfumes/aplicar-precos', {
  method: 'POST',
  body: JSON.stringify(data),
}, true);

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
export const getEstoqueMap = () => request<Record<string, number>>('/estoque', {}, true);
export const getEstoqueResumo = () =>
  request<import('./types').EstoqueResumo>('/estoque/resumo', {}, true);
export const conferirEstoque = (data: {
  perfumeId: string;
  quantidadeFisicaMl: number;
  saldoEsperadoMl: number;
  motivo: string;
}) => request<{
  alterado: boolean;
  saldoAnteriorMl: number;
  saldoAtualMl: number;
  diferencaMl: number;
  movimento: Movimento | null;
}>('/estoque/conferir', {
  method: 'POST',
  body: JSON.stringify(data),
}, true);
export const getCatalogoEstoqueResumo = () =>
  request<CatalogoEstoqueResumo>('/admin/catalogo-estoque/resumo', {}, true);
export const atualizarDisponibilidadeCatalogo = (ids: string[]) => request<{
  prontaEntrega: number;
  sobEncomenda: number;
  encontrados: string[];
  naoEncontrados: string[];
}>('/admin/catalogo-estoque/disponibilidade', {
  method: 'PUT',
  body: JSON.stringify({ ids }),
}, true);
export const zerarEstoqueSobEncomenda = () => request<{
  perfumesConsiderados: number;
  perfumesAtualizados: number;
  quantidadeRetiradaMl: number;
}>('/admin/catalogo-estoque/zerar-sob-encomenda', { method: 'POST' }, true);
export const completarEstoqueProntaEntrega = (quantidadeMl = 1000) => request<{
  perfumesConsiderados: number;
  perfumesAtualizados: number;
  quantidadeAdicionadaMl: number;
  estoqueAlvoMl: number;
}>('/admin/catalogo-estoque/completar-pronta-entrega', {
  method: 'POST',
  body: JSON.stringify({ quantidadeMl }),
}, true);
export const buscarCep = (cep: string) => request<{
  cep: string;
  endereco: string;
  bairro: string;
  cidade: string;
  estado: string;
}>(`/cep/${cep}`);
export const cotarFrete = (data: {
  cepDestino: string;
  itens: { perfumeId: string; ml: number; quantidade: number }[];
}) => request<{ opcoes: OpcaoFrete[] }>('/frete/cotar', {
  method: 'POST',
  body: JSON.stringify(data),
});
export const getConfiguracaoFrete = () =>
  request<ConfiguracaoFrete>('/frete/configuracao', {}, true);
export const updateConfiguracaoFrete = (data: Pick<
  ConfiguracaoFrete,
  | 'taxaEmbalagem'
  | 'cepOrigem'
  | 'freteGratisAcima'
  | 'ajustePadraoTipo'
  | 'ajustePadraoValor'
  | 'prazoPadraoDias'
  | 'ajustePrioritarioTipo'
  | 'ajustePrioritarioValor'
  | 'prazoPrioritarioDias'
  | 'diferencaMinimaPrioritario'
>) =>
  request<ConfiguracaoFrete>('/frete/configuracao', {
    method: 'PUT',
    body: JSON.stringify(data),
  }, true);
export const autorizarMelhorEnvio = () =>
  request<{ url: string }>('/integracoes/melhor-envio/autorizar', { method: 'POST' }, true);

// Pedidos
export const getClientePorContato = (contato: string) => request<{
  contato: string;
  nomeCompleto?: string;
  endereco?: {
    cep: string;
    endereco: string;
    numero: string;
    complemento?: string;
    bairro: string;
    cidade: string;
    estado: string;
  };
}>(`/clientes/por-contato/${encodeURIComponent(contato)}`, {}, true);

export const listPedidos = () => request<Pedido[]>('/pedidos', {}, true);
export const createPedido = (data: Omit<Pedido, 'id' | 'seq' | 'criadoEm'>) => request<Pedido>('/pedidos', { method: 'POST', body: JSON.stringify(data) }, true);
export const updatePedido = (id: string, data: Partial<Pedido>) => request<Pedido>(`/pedidos/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true);
export const deletePedido = (id: string) => request<{ status: string }>(`/pedidos/${id}`, { method: 'DELETE' }, true);

// Opinioes
export const listOpinioes = () => request<Opiniao[]>('/opinioes');
export const createOpiniao = (data: Omit<Opiniao, 'id' | 'data'>) => request<Opiniao>('/opinioes', { method: 'POST', body: JSON.stringify(data) });
export const deleteOpiniao = (id: string) => request<{ status: string }>(`/opinioes/${id}`, { method: 'DELETE' }, true);

// Vitrine
export async function getVitrine(atualizar = false): Promise<VitrineResponse> {
  const path = atualizar ? '/vitrine?atualizar=true' : '/vitrine';
  try {
    return await request<VitrineResponse>(path, {}, false, COLD_START_TIMEOUT_MS);
  } catch (error) {
    if (!(error instanceof ApiError) || ![0, 408, 502, 503, 504].includes(error.status)) {
      throw error;
    }
    // O plano gratuito do Render pode estar terminando de acordar. Uma segunda
    // tentativa curta evita obrigar o cliente a fechar e abrir o aplicativo.
    return request<VitrineResponse>(path, {}, false, 20000);
  }
}
export const publishVitrine = () => request<{ atualizadoEm: string; itensPublicados: number }>('/vitrine/publish', { method: 'POST' }, true);

// Sugestões
export const createSugestao = (data: Pick<Sugestao, 'cliente' | 'contato' | 'mensagem'>) => request<Sugestao>('/sugestoes', { method: 'POST', body: JSON.stringify(data) });
export const listSugestoes = () => request<Sugestao[]>('/sugestoes', {}, true);
export const deleteSugestao = (id: string) => request<{ status: string }>(`/sugestoes/${id}`, { method: 'DELETE' }, true);

// Compras
export const createCompra = (data: CheckoutPayload, idempotencyKey: string) => request<Compra>('/compras', {
  method: 'POST',
  headers: { 'Idempotency-Key': idempotencyKey },
  body: JSON.stringify(data),
});
export const confirmarPagamentoInfinitePay = (data: {
  orderNsu: string;
  transactionNsu: string;
  slug: string;
}) => request<ConfirmacaoInfinitePay>('/pagamentos/infinitepay/confirmar', {
  method: 'POST',
  body: JSON.stringify(data),
});
export const listCompras = () => request<Compra[]>('/compras', {}, true);
export const deleteCompra = (id: string) => request<{ status: string }>(`/compras/${id}`, { method: 'DELETE' }, true);

// Experiência e operação
export const acompanharPedido = (codigo: string) =>
  request<Acompanhamento>(`/acompanhamento/${encodeURIComponent(codigo)}`);
export const cancelarPedidoCliente = (codigo: string) =>
  request<Acompanhamento>(`/acompanhamento/${encodeURIComponent(codigo)}/cancelar`, {
    method: 'POST',
  });
export const getMetricas = (periodo: '7d' | '30d' | 'mes' | 'todos' = '30d') => request<Metricas>(`/admin/metricas?periodo=${periodo}`, {}, true);
export const getOrdersResetVersion = () =>
  request<{ version: number }>('/admin/pedidos/reset-version');
export const resetAllOrders = () => request<{
  status: string;
  pedidosApagados: number;
  comprasLegadasApagadas: number;
  movimentosEstornados: number;
  resetVersion: number;
}>('/admin/pedidos/reset', { method: 'POST' }, true);
export const getConfiguracoesLoja = () =>
  request<ConfiguracoesLoja>('/admin/configuracoes', {}, true);
export const getConfiguracoesPublicas = () =>
  request<ConfiguracoesLojaPublicas>('/admin/configuracoes/publicas');
export const updateConfiguracoesLoja = (data: ConfiguracoesLoja) =>
  request<ConfiguracoesLoja>('/admin/configuracoes', {
    method: 'PUT',
    body: JSON.stringify(data),
  }, true);
export const limparDados = (recurso: 'opinioes' | 'estoque' | 'catalogo') =>
  request<{ status: string; removidos: number }>(`/admin/dados/${recurso}/limpar`, {
    method: 'POST',
  }, true);

// Custos e rentabilidade
export const getCustosConfig = () => request<CustosConfig>('/admin/custos', {}, true);
export const updateCustosConfig = (data: CustosConfig) => request<CustosConfig>('/admin/custos', {
  method: 'PUT', body: JSON.stringify(data),
}, true);
export const getRentabilidade = () => request<{ config: CustosConfig; itens: RentabilidadeItem[] }>('/admin/custos/rentabilidade', {}, true);

// Fornecedores e cotações
export const listFornecedores = () => request<Fornecedor[]>('/admin/fornecedores', {}, true);
export const createFornecedor = (data: Omit<Fornecedor, 'id' | 'cotacoes' | 'criadoEm' | 'atualizadoEm'>) => request<Fornecedor>('/admin/fornecedores', { method: 'POST', body: JSON.stringify(data) }, true);
export const updateFornecedor = (id: string, data: Omit<Fornecedor, 'id' | 'cotacoes' | 'criadoEm' | 'atualizadoEm'>) => request<Fornecedor>(`/admin/fornecedores/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true);
export const archiveFornecedor = (id: string) => request<{ status: string }>(`/admin/fornecedores/${id}`, { method: 'DELETE' }, true);
export const listCotacoes = (fornecedorId: string) => request<CotacaoFornecedor[]>(`/admin/fornecedores/${fornecedorId}/cotacoes`, {}, true);
export const compareFornecedores = (perfumeId: string) => request<CotacaoFornecedor[]>(`/admin/fornecedores/comparativo/${perfumeId}`, {}, true);
export const createCotacao = (fornecedorId: string, data: {
  perfumeId?: string; produto: string; codigo: string; quantidade: number; unidade: 'ml' | 'g' | 'kg' | 'un'; precoTotal: number; frete: number; link: string; observacoes: string; aplicarAoPerfume: boolean;
}) => request<CotacaoFornecedor>(`/admin/fornecedores/${fornecedorId}/cotacoes`, { method: 'POST', body: JSON.stringify(data) }, true);

// Matérias-primas e produção
export const listInsumos = () => request<Insumo[]>('/admin/insumos', {}, true);
export const createInsumo = (data: {
  nome: string; categoria: Insumo['categoria']; unidade: Insumo['unidade']; custoUnitario: number; estoqueMinimo: number; estoqueInicial: number; fornecedorId?: string | null; perfumeId?: string | null; tamanhoMl?: number | null; observacoes: string; ativo: boolean;
}) => request<Insumo>('/admin/insumos', { method: 'POST', body: JSON.stringify(data) }, true);
export const updateInsumo = (
  id: string,
  data: Omit<Insumo, 'id' | 'saldoAtual' | 'valorEstoque' | 'criadoEm' | 'atualizadoEm'>,
) => request<Insumo>(`/admin/insumos/${id}`, { method: 'PUT', body: JSON.stringify(data) }, true);
export const archiveInsumo = (id: string) => request<{ status: string }>(
  `/admin/insumos/${id}`,
  { method: 'DELETE' },
  true,
);
export const moveInsumo = (id: string, data: { tipo: 'entrada' | 'saida'; quantidade: number; motivo: string }) => request(`/admin/insumos/${id}/movimentos`, { method: 'POST', body: JSON.stringify(data) }, true);
export const simulateProducao = (data: { perfumeId: string; ml: number; quantidade: number }) => request<PlanoProducao>('/admin/insumos/producao/simular', { method: 'POST', body: JSON.stringify(data) }, true);
export const registerProducao = (data: { perfumeId: string; ml: number; quantidade: number }) => request<PlanoProducao>('/admin/insumos/producao/registrar', { method: 'POST', body: JSON.stringify(data) }, true);

export async function downloadBackup(): Promise<void> {
  const token = await getToken();
  if (!token) throw new ApiError('Sua sessão expirou. Entre novamente.', 401);
  const response = await fetch(`${API}/admin/backup`, {
    headers: { 'x-atelie-token': token },
  });
  if (!response.ok) throw new ApiError('Não foi possível gerar o backup.', response.status);
  const blob = await response.blob();
  if (typeof document === 'undefined') {
    throw new ApiError('Abra o painel no navegador para baixar o arquivo.', 400);
  }
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = match?.[1] || 'lessence-furlani-backup.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}
