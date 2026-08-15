import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, useWindowDimensions, Linking, Platform, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import {
  COLORS, SPACING, RADIUS, STATUS, FONT_SIZES,
  fmtDate, padSeq,
} from '../theme';
import { BottomSheet } from './BottomSheet';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import { AppText as Text } from './Typography';
import { Field, TInput, PrimaryButton, SecondaryButton, EmptyState, Stars } from './atoms';
import {
  listPerfumes, createPerfume, updatePerfume, deletePerfume, bulkImport, padronizarTamanhos,
  listMovimentos, createMovimento, getEstoqueMap, getEstoqueResumo, conferirEstoque,
  atualizarDisponibilidadeCatalogo,
  getCatalogoEstoqueResumo, completarEstoqueProntaEntrega, zerarEstoqueSobEncomenda,
  listPedidos, createPedido, updatePedido, deletePedido, registerPaymentOperation,
  listOpinioesAdmin, moderateOpiniao, deleteOpiniao,
  listSugestoes, deleteSugestao, listCompras, deleteCompra,
  downloadBackup, downloadOrderLabels, auditCatalog, validateBackup, restoreBackup, getOperationalSummary, retryFailedPayments, getMetricas, resetAllOrders,
  getConfiguracaoFrete, updateConfiguracaoFrete, autorizarMelhorEnvio,
  aplicarPrecos, ApiError, getConfiguracoesLoja, updateConfiguracoesLoja, limparDados,
  listArquivados, restoreArquivado,
  listSolicitacoesPrivacidade, updateSolicitacaoPrivacidade,
} from '../api';
import type { OperationalSummary, RegistroArquivado, SolicitacaoPrivacidade } from '../api';
import { PRESET_FORNECEDOR } from '../data/preset-fornecedor';
import type { CatalogoEstoqueResumo, Compra, ConfiguracaoFrete, ConfiguracoesLoja, EstoqueResumo, Metricas, Movimento, Opiniao, OrderStatus, PaymentOperation, Pedido, Perfume, Sugestao } from '../types';
import { publicStoreConfig, storeNameParts, whatsappNumber } from '../storeConfig';
import { CustosView, FornecedoresView, InsumosView } from './GestaoOperacional';
import { useWebPullToRefresh } from '../hooks/use-web-pull-to-refresh';
import { useReducedMotion } from '../hooks/use-reduced-motion';
import {
  ConfirmSheetContent,
  SystemAction,
  SystemCard,
  type ConfirmSheet,
} from './AdminSystemComponents';
import { AdminAvailabilityManager } from './AdminAvailabilityManager';
import {
  type AdminPedido as PedidoPainel,
} from './AdminOrderCards';
import {
  MovimentoForm,
  PerfumeForm,
  StockCountForm,
  type MovimentoDraft,
  type PerfumeSaveData,
} from './AdminInventoryForms';
import {
  PAYMENT_STATUS_LABELS,
  PaymentOperationForm,
  PedidoForm,
  type PedidoSaveData,
} from './AdminOrderForms';
import {
  AdminCatalog,
  AdminDashboard,
  type MetricPeriod,
} from './AdminDashboardCatalog';
import { AdminStockView } from './AdminStockView';
import {
  AdminOrdersView,
  type AdminOrdersLayout,
} from './AdminOrdersView';

type SheetType = null | { type: 'perfume'; data?: Perfume } | { type: 'movimento' } | { type: 'stock-count'; data?: Perfume } | { type: 'pedido'; data?: Pedido }
  | { type: 'payment-operation'; data: Pedido }
  | { type: 'availability' }
  | ConfirmSheet
  | { type: 'whatsapp'; phone: string; message: string; statusLabel: string }
  | { type: 'info'; label: string };

const TABS = [
  { id: 'dashboard', label: 'Início', icon: 'home' as const },
  { id: 'catalogo', label: 'Catálogo', icon: 'droplet' as const },
  { id: 'estoque', label: 'Estoque', icon: 'package' as const },
  { id: 'pedidos', label: 'Pedidos', icon: 'clipboard' as const },
  { id: 'opinioes', label: 'Opiniões', icon: 'star' as const },
  { id: 'sistema', label: 'Sistema', icon: 'settings' as const },
];

const WHATSAPP_NOTIFICATION_STATUSES: OrderStatus[] = [
  'pagamento_confirmado',
  'preparando',
  'pronto',
  'enviado',
  'entregue',
];

function statusWhatsAppMessage(pedido: Pedido, storeName: string, storefrontUrl: string) {
  const updates: Partial<Record<OrderStatus, string>> = {
    pagamento_confirmado: 'Recebemos a confirmação do seu pagamento.',
    preparando: 'Seu pedido entrou em produção.',
    pronto: pedido.entrega?.tipo === 'retirada'
      ? 'Seu pedido está pronto para retirada. Vamos combinar o melhor horário.'
      : 'Seu pedido está pronto e será enviado em breve.',
    enviado: 'Seu pedido foi enviado.',
    entregue: 'Seu pedido foi marcado como entregue. Esperamos que você aproveite seus perfumes!',
  };
  const lines = [
    `Olá, ${pedido.cliente}!`,
    `Seu pedido nº ${padSeq(pedido.seq)} da ${storeName} foi atualizado:`,
    `*${updates[pedido.status] || 'Status atualizado.'}*`,
  ];
  if (pedido.codigoAcompanhamento) {
    lines.push(`Código de acompanhamento: ${pedido.codigoAcompanhamento}.`);
    lines.push('Para consultar, abra a vitrine e toque em “Pedidos”.');
  }
  lines.push(storefrontUrl);
  return lines.join('\n');
}

function currentCatalogPrices(perfumes: Perfume[]) {
  const result = { 30: '50,00', 50: '80,00', 100: '120,00' };
  for (const ml of [30, 50, 100] as const) {
    const frequency = new Map<number, number>();
    for (const perfume of perfumes) {
      const price = perfume.precos?.find((item) => Number(item.ml) === ml)?.preco;
      if (price == null || !Number.isFinite(Number(price))) continue;
      const normalized = Math.round(Number(price) * 100) / 100;
      frequency.set(normalized, (frequency.get(normalized) || 0) + 1);
    }
    const mostCommon = [...frequency.entries()].sort((first, second) => second[1] - first[1])[0]?.[0];
    if (mostCommon != null) result[ml] = mostCommon.toFixed(2).replace('.', ',');
  }
  return result;
}

export function Atelie({
  onSair,
  onStoreConfigChange,
}: {
  onSair: () => void;
  onStoreConfigChange?: (config: ConfiguracoesLoja) => void;
}) {
  const { width } = useWindowDimensions();
  const desktopViewport = width >= 1200;
  const reducedMotion = useReducedMotion();
  const contentTransition = React.useRef(new Animated.Value(1)).current;
  const [tab, setTab] = useState('dashboard');
  const [systemView, setSystemView] = useState<'main' | 'historico' | 'arquivados' | 'privacidade' | 'backup' | 'fornecedores' | 'custos' | 'insumos'>('main');

  useEffect(() => {
    if (reducedMotion) {
      contentTransition.setValue(1);
      return;
    }
    contentTransition.setValue(0);
    Animated.timing(contentTransition, {
      toValue: 1,
      duration: 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [contentTransition, reducedMotion, systemView, tab]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [perfumes, setPerfumes] = useState<Perfume[]>([]);
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [opinioes, setOpinioes] = useState<Opiniao[]>([]);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [estoqueResumo, setEstoqueResumo] = useState<EstoqueResumo>({});
  const [catalogoEstoque, setCatalogoEstoque] = useState<CatalogoEstoqueResumo | null>(null);
  const [arquivados, setArquivados] = useState<RegistroArquivado[]>([]);
  const [loadingArquivados, setLoadingArquivados] = useState(false);
  const [solicitacoesPrivacidade, setSolicitacoesPrivacidade] = useState<SolicitacaoPrivacidade[]>([]);
  const [loadingPrivacidade, setLoadingPrivacidade] = useState(false);
  const [operationalSummary, setOperationalSummary] = useState<OperationalSummary | null>(null);
  const [loadingOperation, setLoadingOperation] = useState(false);
  const [sheet, setSheet] = useState<SheetType>(null);
  const [search, setSearch] = useState('');
  const [stockSearch, setStockSearch] = useState('');
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [metricPeriod, setMetricPeriod] = useState<MetricPeriod>('30d');
  const [freteConfig, setFreteConfig] = useState<ConfiguracaoFrete | null>(null);
  const [freteFeeInput, setFreteFeeInput] = useState('0,00');
  const [freteCepInput, setFreteCepInput] = useState('');
  const [freteGratisInput, setFreteGratisInput] = useState('0,00');
  const [fretePadraoTipo, setFretePadraoTipo] = useState<'valor' | 'percentual'>('valor');
  const [fretePadraoInput, setFretePadraoInput] = useState('0,00');
  const [fretePadraoPrazoInput, setFretePadraoPrazoInput] = useState('0');
  const [fretePrioritarioTipo, setFretePrioritarioTipo] = useState<'valor' | 'percentual'>('valor');
  const [fretePrioritarioInput, setFretePrioritarioInput] = useState('0,00');
  const [fretePrioritarioPrazoInput, setFretePrioritarioPrazoInput] = useState('0');
  const [fretePrioritarioDiferencaInput, setFretePrioritarioDiferencaInput] = useState('3,00');
  const [savingFrete, setSavingFrete] = useState(false);
  const [priceInputs, setPriceInputs] = useState({ 30: '50,00', 50: '80,00', 100: '120,00' });
  const [savingPrices, setSavingPrices] = useState(false);
  const [savingStore, setSavingStore] = useState(false);
  const [storeConfig, setStoreConfig] = useState<ConfiguracoesLoja>({
    nomeLoja: 'L’Essence Furlani',
    logoUrl: '',
    whatsapp: '',
    instagram: '',
    email: '',
    pix: '',
    infinitePayHandle: '',
    cnpj: '',
    margemLucro: 0,
  });
  const [orderView, setOrderView] = useState<AdminOrdersLayout>('kanban');
  const [orderSearch, setOrderSearch] = useState('');
  const [movingOrderId, setMovingOrderId] = useState<string | null>(null);
  const kanbanColumnWidth = Math.min(310, Math.max(260, width - 56));
  const storePreview = publicStoreConfig(storeConfig);
  const storePreviewName = storeNameParts(storePreview.nomeLoja);
  const storeInitials = storePreview.nomeLoja
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(-2)
    .join('')
    .toUpperCase();

  const load = useCallback(async () => {
    const optional = async <T,>(label: string, promise: Promise<T>): Promise<T | null> => {
      try {
        return await promise;
      } catch (error) {
        console.error(`[painel] Falha ao carregar ${label}`, error);
        return null;
      }
    };

    try {
      const estoque = getEstoqueResumo().catch(async () => {
          const mapa = await getEstoqueMap();
          return Object.fromEntries(Object.entries(mapa).map(([id, saldoAtualMl]) => [
            id,
            { saldoAtualMl, reservadoMl: 0, disponivelMl: saldoAtualMl },
          ]));
        });
      const [p, m, pe, o, s, c, e, metrics, shipping, store, catalogStock, operation] = await Promise.all([
        optional('catálogo', listPerfumes()),
        optional('movimentos', listMovimentos()),
        optional('pedidos', listPedidos()),
        optional('opiniões', listOpinioesAdmin()),
        optional('sugestões', listSugestoes()),
        optional('compras', listCompras()),
        optional('estoque', estoque),
        optional('métricas', getMetricas('30d')),
        optional('frete', getConfiguracaoFrete()),
        optional('configurações', getConfiguracoesLoja()),
        optional('resumo do catálogo', getCatalogoEstoqueResumo()),
        optional('saúde operacional', getOperationalSummary()),
      ]);
      if (p) {
        setPerfumes(p);
        setPriceInputs(currentCatalogPrices(p));
      }
      if (m) setMovimentos(m);
      if (pe) setPedidos(pe);
      if (o) setOpinioes(o);
      if (s) setSugestoes(s);
      if (c) setCompras(c);
      if (e) setEstoqueResumo(e);
      if (metrics) setMetricas(metrics);
      if (shipping) setFreteConfig(shipping);
      if (catalogStock) setCatalogoEstoque(catalogStock);
      if (operation) setOperationalSummary(operation);
      if (store) setStoreConfig(store);
      if (shipping) {
        setFreteFeeInput(shipping.taxaEmbalagem.toFixed(2).replace('.', ','));
        setFreteCepInput(shipping.cepOrigem);
        setFreteGratisInput(shipping.freteGratisAcima.toFixed(2).replace('.', ','));
        setFretePadraoTipo(shipping.ajustePadraoTipo || 'valor');
        setFretePadraoInput(Number(shipping.ajustePadraoValor || 0).toFixed(2).replace('.', ','));
        setFretePadraoPrazoInput(String(shipping.prazoPadraoDias || 0));
        setFretePrioritarioTipo(shipping.ajustePrioritarioTipo || 'valor');
        setFretePrioritarioInput(Number(shipping.ajustePrioritarioValor || 0).toFixed(2).replace('.', ','));
        setFretePrioritarioPrazoInput(String(shipping.prazoPrioritarioDias || 0));
        setFretePrioritarioDiferencaInput(Number(shipping.diferencaMinimaPrioritario ?? 3).toFixed(2).replace('.', ','));
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refreshPanel = useCallback(async () => {
    setRefreshing(true);
    await load();
  }, [load]);
  const pullToRefresh = useWebPullToRefresh(refreshing, refreshPanel);

  const openArquivados = async () => {
    setSystemView('arquivados');
    setLoadingArquivados(true);
    try {
      setArquivados(await listArquivados());
    } catch (error) {
      setSheet({
        type: 'info',
        label: error instanceof ApiError ? error.message : 'Não foi possível abrir os itens arquivados.',
      });
    } finally {
      setLoadingArquivados(false);
    }
  };

  const requestRestoreArquivado = (item: RegistroArquivado) => {
    setSheet({
      type: 'confirm',
      label: `Restaurar “${item.titulo}” ao painel?`,
      confirmLabel: 'Restaurar',
      onConfirm: async () => {
        await restoreArquivado(item.recurso, item.id);
        setSheet(null);
        setArquivados(await listArquivados());
        await load();
      },
    });
  };

  const openPrivacidade = async () => {
    setSystemView('privacidade');
    setLoadingPrivacidade(true);
    try {
      setSolicitacoesPrivacidade(await listSolicitacoesPrivacidade());
    } catch (error) {
      setSheet({
        type: 'info',
        label: error instanceof ApiError ? error.message : 'Não foi possível abrir a Central de Privacidade.',
      });
    } finally {
      setLoadingPrivacidade(false);
    }
  };

  const changePrivacyStatus = async (
    item: SolicitacaoPrivacidade,
    status: SolicitacaoPrivacidade['status'],
  ) => {
    await updateSolicitacaoPrivacidade(item.id, status);
    setSolicitacoesPrivacidade(await listSolicitacoesPrivacidade());
    await load();
  };

  const changeMetricPeriod = async (period: '7d' | '30d' | 'mes' | 'todos') => {
    setMetricPeriod(period);
    try {
      setMetricas(await getMetricas(period));
    } catch (error) {
      setSheet({ type: 'info', label: error instanceof ApiError ? error.message : 'Não foi possível atualizar o período do dashboard.' });
    }
  };

  const saveFreteConfig = async () => {
    const fee = Number(freteFeeInput.replace(',', '.'));
    const freeAbove = Number(freteGratisInput.replace(',', '.'));
    const padraoValue = Number(fretePadraoInput.replace(',', '.'));
    const padraoDeadline = Number(fretePadraoPrazoInput);
    const priorityValue = Number(fretePrioritarioInput.replace(',', '.'));
    const priorityDeadline = Number(fretePrioritarioPrazoInput);
    const priorityDifference = Number(fretePrioritarioDiferencaInput.replace(',', '.'));
    const cep = freteCepInput.replace(/\D/g, '');
    const invalidNumbers = [fee, freeAbove, padraoValue, padraoDeadline, priorityValue, priorityDeadline, priorityDifference]
      .some((value) => !Number.isFinite(value) || value < 0);
    if (invalidNumbers || !Number.isInteger(padraoDeadline) || !Number.isInteger(priorityDeadline) || cep.length !== 8) {
      setSheet({ type: 'info', label: 'Informe um CEP válido e valores de frete iguais ou maiores que zero.' });
      return;
    }
    if (padraoDeadline > 0 && priorityDeadline > padraoDeadline) {
      setSheet({ type: 'info', label: 'O prazo da Entrega Prioritária deve ser igual ou menor que o prazo da Entrega Padrão.' });
      return;
    }
    setSavingFrete(true);
    try {
      const updated = await updateConfiguracaoFrete({
        taxaEmbalagem: fee,
        cepOrigem: cep,
        freteGratisAcima: freeAbove,
        ajustePadraoTipo: fretePadraoTipo,
        ajustePadraoValor: padraoValue,
        prazoPadraoDias: padraoDeadline,
        ajustePrioritarioTipo: fretePrioritarioTipo,
        ajustePrioritarioValor: priorityValue,
        prazoPrioritarioDias: priorityDeadline,
        diferencaMinimaPrioritario: priorityDifference,
      });
      setFreteConfig(updated);
      setFreteFeeInput(updated.taxaEmbalagem.toFixed(2).replace('.', ','));
      setFreteCepInput(updated.cepOrigem);
      setFreteGratisInput(updated.freteGratisAcima.toFixed(2).replace('.', ','));
      setFretePadraoTipo(updated.ajustePadraoTipo);
      setFretePadraoInput(updated.ajustePadraoValor.toFixed(2).replace('.', ','));
      setFretePadraoPrazoInput(String(updated.prazoPadraoDias));
      setFretePrioritarioTipo(updated.ajustePrioritarioTipo);
      setFretePrioritarioInput(updated.ajustePrioritarioValor.toFixed(2).replace('.', ','));
      setFretePrioritarioPrazoInput(String(updated.prazoPrioritarioDias));
      setFretePrioritarioDiferencaInput(updated.diferencaMinimaPrioritario.toFixed(2).replace('.', ','));
      setSheet({ type: 'info', label: 'Configuração de entrega salva. As próximas cotações já usarão esses valores.' });
    } catch {
      setSheet({ type: 'info', label: 'Não foi possível salvar a configuração de entrega.' });
    } finally {
      setSavingFrete(false);
    }
  };

  const applyPriceSizes = async (sizes: number[]) => {
    const prices = ([30, 50, 100] as const).map((ml) => ({
      ml,
      preco: Number(priceInputs[ml].replace(',', '.')),
    }));
    if (prices.some((item) => !Number.isFinite(item.preco) || item.preco < 0)) {
      setSheet({ type: 'info', label: 'Revise os preços informados.' });
      return;
    }
    setSavingPrices(true);
    try {
      const result = await aplicarPrecos({ precos: prices, tamanhos: sizes });
      setSheet({
        type: 'info',
        label: `Preços atualizados em ${result.atualizados} perfume(s) e publicados na vitrine.`,
      });
      await load();
    } catch (error) {
      setSheet({
        type: 'info',
        label: error instanceof ApiError
          ? `Não foi possível aplicar os preços: ${error.message}`
          : 'Não foi possível aplicar os preços. Tente novamente.',
      });
    } finally {
      setSavingPrices(false);
    }
  };

  const saveStoreConfig = async () => {
    setSavingStore(true);
    try {
      const updated = await updateConfiguracoesLoja(storeConfig);
      setStoreConfig(updated);
      onStoreConfigChange?.(updated);
      setSheet({ type: 'info', label: 'Configurações salvas. A vitrine e os próximos pagamentos já usarão os novos dados.' });
    } catch {
      setSheet({ type: 'info', label: 'Não foi possível salvar as configurações da loja.' });
    } finally {
      setSavingStore(false);
    }
  };

  const clearSystemData = async (resource: 'opinioes' | 'estoque' | 'catalogo') => {
    try {
      const result = await limparDados(resource);
      setSheet({ type: 'info', label: `${result.status} ${result.removidos} registro(s) removido(s).` });
      await load();
    } catch {
      setSheet({ type: 'info', label: 'Não foi possível concluir a limpeza. Verifique se existem pedidos ativos.' });
    }
  };

  const connectMelhorEnvio = async () => {
    try {
      const { url } = await autorizarMelhorEnvio();
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.location.assign(url);
        return;
      }
      await Linking.openURL(url);
    } catch {
      setSheet({ type: 'info', label: 'O aplicativo do Melhor Envio ainda precisa ser configurado no servidor.' });
    }
  };

  const pedidosUnificados = useMemo<PedidoPainel[]>(() => {
    const statusValido = (status: string): OrderStatus =>
      STATUS.some((item) => item.id === status) ? status as OrderStatus : 'pendente';

    const atuais: PedidoPainel[] = pedidos.map((pedido) => ({
      ...pedido,
      cliente: pedido.cliente || 'Cliente não informado',
      contato: pedido.contato || '',
      status: statusValido(pedido.status),
      observacoes: pedido.observacoes || '',
      itens: Array.isArray(pedido.itens) ? pedido.itens : [],
      total: pedido.total || 0,
      criadoEm: pedido.criadoEm || '',
      fonte: 'pedidos',
    }));
    const legados: PedidoPainel[] = compras.map((compra) => ({
      id: `compra-${compra.id}`,
      seq: compra.seq || 0,
      cliente: compra.cliente,
      contato: compra.contato || '',
      status: statusValido(compra.status),
      observacoes: compra.observacoes || '',
      itens: compra.itens?.map((item) => ({
        perfumeId: item.perfumeId,
        ml: item.ml,
        quantidade: item.quantidade,
      })) || (compra.perfumeId && compra.ml ? [{
        perfumeId: compra.perfumeId,
        ml: compra.ml,
        quantidade: 1,
      }] : []),
      total: compra.total ?? compra.preco ?? 0,
      criadoEm: compra.criadoEm || compra.data,
      fonte: 'compras-legadas',
      compraLegada: compra,
    }));
    return [...atuais, ...legados];
  }, [compras, pedidos]);

  const resumoDe = (id: string) => estoqueResumo[id] || {
    saldoAtualMl: 0,
    reservadoMl: 0,
    disponivelMl: 0,
  };
  const disponivelDe = (id: string) => resumoDe(id).disponivelMl;
  const estoqueBaixo = perfumes.filter((p) => disponivelDe(p.id) <= (p.estoqueMinimoMl || 0)).length;
  const pendentes = pedidosUnificados.filter((p) => p.status === 'pendente').length;
  const opinioesAprovadas = opinioes.filter((opiniao) => opiniao.aprovada === true);
  const notaMedia = opinioesAprovadas.length
    ? (opinioesAprovadas.reduce((s, o) => s + o.nota, 0) / opinioesAprovadas.length).toFixed(1)
    : '–';

  const doSavePerfume = async (data: PerfumeSaveData) => {
    if (data.id) await updatePerfume(data.id, data);
    else await createPerfume(data);
    setSheet(null); load();
  };
  const doDeletePerfume = async (id: string) => { await deletePerfume(id); setSheet(null); load(); };
  const doImport = async () => {
    const r = await bulkImport(PRESET_FORNECEDOR);
    setSheet({ type: 'info', label: `${r.adicionados} contratipo(s) importado(s). Sem estoque e sem preços — edite para ajustar.` });
    load();
  };
  const doPadronizar = async () => {
    const r = await padronizarTamanhos();
    setSheet({
      type: 'info',
      label: `Preços padrão aplicados a ${r.atualizados} perfume(s). A vitrine será atualizada automaticamente: 30ml por R$ 50, 50ml por R$ 80 e 100ml por R$ 120.`,
    });
    load();
  };
  const doMov = async (data: MovimentoDraft) => { await createMovimento(data); setSheet(null); load(); };
  const doStockCount = async (data: { perfumeId: string; quantidadeFisicaMl: number; saldoEsperadoMl: number; motivo: string }) => {
    try {
      const result = await conferirEstoque(data);
      const perfume = perfumes.find((item) => item.id === data.perfumeId);
      setSheet({
        type: 'info',
        label: result.alterado
          ? `${perfume?.nome || 'Estoque'} conferido: ${result.saldoAnteriorMl}ml → ${result.saldoAtualMl}ml. Ajuste de ${result.diferencaMl > 0 ? '+' : ''}${result.diferencaMl}ml registrado no histórico.`
          : `${perfume?.nome || 'Estoque'} conferido. O saldo de ${result.saldoAtualMl}ml já estava correto e nenhum lançamento foi criado.`,
      });
      await load();
    } catch (error) {
      setSheet({
        type: 'info',
        label: error instanceof ApiError ? error.message : 'Não foi possível concluir a conferência do estoque.',
      });
    }
  };
  const doCompletarProntaEntrega = async () => {
    try {
      const result = await completarEstoqueProntaEntrega(1000);
      setSheet({
        type: 'info',
        label: (
          `${result.perfumesAtualizados} perfume(s) de pronta entrega atualizados. `
          + `${result.quantidadeAdicionadaMl.toLocaleString('pt-BR')}ml adicionados no total.`
        ),
      });
      await load();
    } catch {
      setSheet({ type: 'info', label: 'Não foi possível atualizar o estoque de pronta entrega.' });
    }
  };
  const doZerarSobEncomenda = async () => {
    try {
      const result = await zerarEstoqueSobEncomenda();
      setSheet({
        type: 'info',
        label: (
          `${result.perfumesAtualizados} perfume(s) sob encomenda ajustados. `
          + `${result.quantidadeRetiradaMl.toLocaleString('pt-BR')}ml retirados do saldo.`
        ),
      });
      await load();
    } catch {
      setSheet({ type: 'info', label: 'Não foi possível zerar o estoque dos itens sob encomenda.' });
    }
  };
  const requestSaveAvailability = (ids: string[]) => {
    setSheet({
      type: 'confirm',
      label: (
        `Confirmar ${ids.length} perfume(s) em pronta entrega e `
        + `${Math.max(0, perfumes.length - ids.length)} sob encomenda?`
      ),
      onConfirm: async () => {
        try {
          const result = await atualizarDisponibilidadeCatalogo(ids);
          setSheet({
            type: 'info',
            label: (
              `Disponibilidade salva: ${result.prontaEntrega} em pronta entrega e `
              + `${result.sobEncomenda} sob encomenda. A vitrine será atualizada automaticamente.`
            ),
          });
          await load();
        } catch {
          setSheet({ type: 'info', label: 'Não foi possível atualizar a disponibilidade do catálogo.' });
        }
      },
      confirmLabel: 'Salvar disponibilidade',
    });
  };
  const pedidoPayload = (data: PedidoSaveData | Pedido): Omit<Pedido, 'id' | 'seq' | 'criadoEm'> => ({
    cliente: data.cliente,
    contato: data.contato || '',
    status: data.status,
    observacoes: data.observacoes || '',
    endereco: data.endereco ? {
      cep: String(data.endereco.cep || '').replace(/\D/g, ''),
      endereco: String(data.endereco.endereco || '').trim(),
      numero: String(data.endereco.numero || '').trim(),
      complemento: String(data.endereco.complemento || '').trim(),
      bairro: String(data.endereco.bairro || '').trim(),
      cidade: String(data.endereco.cidade || '').trim(),
      estado: String(data.endereco.estado || '').trim().toUpperCase(),
    } : undefined,
    itens: data.itens.map((item) => ({
      perfumeId: item.perfumeId,
      ml: Number(item.ml),
      quantidade: Number(item.quantidade) || 1,
      precoUnitario: item.precoUnitario == null ? undefined : Number(item.precoUnitario),
      subtotal: item.subtotal == null ? undefined : Number(item.subtotal),
    })),
    subtotalTabela: data.subtotalTabela == null ? undefined : Number(data.subtotalTabela),
    ajusteManual: Number(data.ajusteManual) || 0,
    total: Number(data.total) || 0,
  });
  const offerWhatsAppStatusUpdate = (pedido: Pedido, previousStatus?: OrderStatus) => {
    const phone = whatsappNumber(pedido.contato);
    const shouldOffer = Boolean(
      previousStatus
      && previousStatus !== pedido.status
      && WHATSAPP_NOTIFICATION_STATUSES.includes(pedido.status)
    );
    if (!shouldOffer) return false;

    const statusLabel = STATUS.find((item) => item.id === pedido.status)?.label || 'Status atualizado';
    const storefrontUrl = Platform.OS === 'web' && typeof window !== 'undefined'
      ? `${window.location.origin}/`
      : 'https://lessence-furlani-vitrine.onrender.com/';
    setSheet({
      type: 'whatsapp',
      phone,
      statusLabel,
      message: statusWhatsAppMessage(pedido, storePreview.nomeLoja, storefrontUrl),
    });
    return true;
  };
  const openStatusWhatsApp = (data: Extract<NonNullable<SheetType>, { type: 'whatsapp' }>) => {
    if (data.phone.length < 12) {
      setSheet({ type: 'info', label: 'O status foi atualizado, mas este pedido não possui um WhatsApp válido. Abra o pedido e confira o campo Contato.' });
      return;
    }
    const encodedMessage = encodeURIComponent(data.message);
    const webUrl = `https://wa.me/${data.phone}?text=${encodedMessage}`;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.assign(webUrl);
      return;
    }
    Linking.openURL(webUrl)
      .catch(() => setSheet({ type: 'info', label: 'Não foi possível abrir o WhatsApp.' }));
  };
  const persistPedido = async (data: PedidoSaveData, previous?: Pedido | null) => {
    const saved = data.id
      ? await updatePedido(data.id, pedidoPayload(data))
      : await createPedido(pedidoPayload(data));
    await load();
    if (!offerWhatsAppStatusUpdate(saved, previous?.status)) setSheet(null);
  };
  const doSavePedido = async (data: PedidoSaveData) => {
    const anterior = data.id ? pedidos.find((pedido) => pedido.id === data.id) : null;
    if (anterior && anterior.status !== 'cancelado' && data.status === 'cancelado') {
      setSheet({
        type: 'confirm',
        label: `Cancelar o pedido Nº ${padSeq(data.seq || 0)} de ${data.cliente}? A reserva ou a baixa automática do estoque será liberada.`,
        onConfirm: () => persistPedido(data, anterior),
        confirmLabel: 'Cancelar pedido',
        danger: true,
        safetyText: 'O pedido sairá do fluxo ativo e a reserva ou baixa automática será liberada. O histórico continuará disponível.',
      });
      return;
    }
    await persistPedido(data, anterior);
  };
  const doPaymentOperation = async (
    pedido: Pedido,
    operacao: PaymentOperation,
    motivo: string,
    referencia: string,
  ) => {
    try {
      const atualizado = await registerPaymentOperation(pedido.id, { operacao, motivo, referencia });
      await load();
      const status = atualizado.pagamento?.status || 'atualizado';
      const complemento = status === 'estornado' || status === 'chargeback_confirmado'
        ? ' Agora o pedido pode ser cancelado sem manter receita indevida.'
        : '';
      setSheet({ type: 'info', label: `Situação financeira registrada: ${PAYMENT_STATUS_LABELS[status] || status}.${complemento}` });
    } catch (error) {
      setSheet({
        type: 'info',
        label: error instanceof ApiError ? error.message : 'Não foi possível registrar a operação financeira.',
      });
    }
  };
  const doDelPedido = async (id: string) => { await deletePedido(id); setSheet(null); load(); };
  const requestDeletePedido = (pedido: Pedido) => {
    setSheet({
      type: 'confirm',
      label: `Arquivar o pedido Nº ${padSeq(pedido.seq)} de ${pedido.cliente}?`,
      onConfirm: () => doDelPedido(pedido.id),
      confirmLabel: 'Arquivar pedido',
      safetyText: 'O pedido sairá do fluxo ativo, mas o histórico, o acompanhamento e os dados financeiros serão preservados.',
    });
  };
  const doDelOpiniao = async (id: string) => { await deleteOpiniao(id); setSheet(null); load(); };
  const doModerateOpiniao = async (id: string, aprovada: boolean) => {
    await moderateOpiniao(id, aprovada);
    await load();
  };
  const doDelSugestao = async (id: string) => { await deleteSugestao(id); load(); };
  const doDelCompra = async (id: string) => { await deleteCompra(id); setSheet(null); load(); };
  const abrirPedido = (pedido: PedidoPainel) => {
    if (pedido.fonte === 'pedidos') {
      setSheet({ type: 'pedido', data: pedido });
      return;
    }
    setSheet({
      type: 'info',
      label: `Pedido recebido pela vitrine de ${pedido.cliente}. Contato: ${pedido.contato || 'não informado'}. ${pedido.observacoes || ''}`.trim(),
    });
  };
  const moverPedido = async (pedido: PedidoPainel, status: OrderStatus) => {
    if (pedido.fonte !== 'pedidos' || pedido.status === status || movingOrderId) return;
    setMovingOrderId(pedido.id);
    try {
      const saved = await updatePedido(pedido.id, pedidoPayload({ ...pedido, status }));
      await load();
      offerWhatsAppStatusUpdate(saved, pedido.status);
    } catch (error) {
      setSheet({
        type: 'info',
        label: error instanceof ApiError
          ? error.message
          : 'Não foi possível mover o pedido. Verifique a conexão e tente novamente.',
      });
    } finally {
      setMovingOrderId(null);
    }
  };
  const doBackup = async () => {
    try {
      await downloadBackup();
      await refreshOperationalSummary();
      setSheet({ type: 'info', label: 'Backup criptografado gerado com sucesso. Guarde o arquivo .lfe em um local seguro; ele não pode ser lido como um JSON comum.' });
    } catch {
      setSheet({ type: 'info', label: 'Não foi possível baixar o backup. Abra o painel no navegador e tente novamente.' });
    }
  };
  const doGenerateLabels = async (pedido: Pedido) => {
    try {
      await downloadOrderLabels(pedido.id, pedido.seq);
    } catch (error) {
      setSheet({ type: 'info', label: error instanceof ApiError ? error.message : 'Não foi possível gerar as etiquetas.' });
    }
  };
  const doAuditCatalog = async () => {
    try {
      const audit = await auditCatalog();
      if (!audit.comProblemas) {
        setSheet({ type: 'info', label: `Catálogo conferido: ${audit.total} perfumes, sem imagens ou preços pendentes.` });
        return;
      }
      const lista = audit.itens.slice(0, 12)
        .map((item) => `Nº ${padSeq(item.seq || 0)} ${item.nome}: ${item.problemas.join(', ')}`)
        .join('\n');
      const restante = audit.comProblemas > 12 ? `\nE mais ${audit.comProblemas - 12} item(ns).` : '';
      setSheet({ type: 'info', label: `${audit.comProblemas} de ${audit.total} item(ns) precisam de revisão:\n\n${lista}${restante}` });
    } catch (error) {
      setSheet({ type: 'info', label: error instanceof ApiError ? error.message : 'Não foi possível auditar o catálogo.' });
    }
  };
  const refreshOperationalSummary = async (showResult = false) => {
    setLoadingOperation(true);
    try {
      const result = await getOperationalSummary();
      setOperationalSummary(result);
      if (showResult) {
        const pagamentosComAtencao = result.pagamentosFalhos + result.pagamentosRevisaoManual;
        setSheet({
          type: 'info',
          label: pagamentosComAtencao
            ? `Atenção: existem ${result.pagamentosFalhos} confirmação(ões) com falha e ${result.pagamentosRevisaoManual} em revisão manual. Consulte os pedidos exibidos na Saúde operacional.`
            : `Operação saudável. Há ${result.pagamentosEmEspera} confirmação(ões) aguardando nova tentativa e ${result.pagamentosProcessando} em processamento.`,
        });
      }
    } catch (error) {
      if (showResult) {
        setSheet({
          type: 'info',
          label: error instanceof ApiError ? error.message : 'Não foi possível atualizar a saúde operacional.',
        });
      }
    } finally {
      setLoadingOperation(false);
    }
  };
  const reprocessFailedPayments = async () => {
    setLoadingOperation(true);
    try {
      const result = await retryFailedPayments();
      await refreshOperationalSummary();
      setSheet({
        type: 'info',
        label: result.reprocessados
          ? `${result.reprocessados} confirmação(ões) voltaram para a fila automática. O sistema continuará tentando em segundo plano.`
          : 'Não há confirmações com falha para reprocessar.',
      });
    } catch (error) {
      setSheet({
        type: 'info',
        label: error instanceof ApiError ? error.message : 'Não foi possível reprocessar as confirmações.',
      });
    } finally {
      setLoadingOperation(false);
    }
  };
  const chooseAndRestoreBackup = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setSheet({ type: 'info', label: 'Abra o painel em um navegador para selecionar e restaurar o arquivo .lfe.' });
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.lfe,application/x-lessence-backup,application/octet-stream';
    input.onchange = async () => {
      const file = input.files?.item(0);
      if (!file) return;
      try {
        const validation = await validateBackup(file);
        const generatedAt = validation.geradoEm
          ? new Date(validation.geradoEm).toLocaleString('pt-BR')
          : 'data não informada';
        setSheet({
          type: 'confirm',
          title: 'Restaurar backup',
          label: `Backup válido, gerado em ${generatedAt}, com ${validation.totalRegistros} registro(s). Deseja substituir os dados atuais por esse conteúdo?`,
          confirmLabel: 'Restaurar agora',
          danger: true,
          requiresReauth: true,
          safetyText: 'A restauração é transacional: ou todas as coleções são substituídas, ou nenhuma alteração será aplicada. Exporte um backup atual antes de continuar.',
          onConfirm: async () => {
            try {
              const result = await restoreBackup(file);
              await load();
              await refreshOperationalSummary();
              setSheet({
                type: 'info',
                label: `Backup restaurado com segurança: ${result.totalRegistros} registro(s) aplicados.`,
              });
            } catch (error) {
              setSheet({
                type: 'info',
                label: error instanceof ApiError ? error.message : 'Não foi possível restaurar o backup.',
              });
            }
          },
        });
      } catch (error) {
        setSheet({
          type: 'info',
          label: error instanceof ApiError ? error.message : 'O arquivo de backup não pôde ser validado.',
        });
      }
    };
    input.click();
  };
  const doResetPedidos = async () => {
    try {
      const result = await resetAllOrders();
      setSheet({
        type: 'info',
        label: `Base zerada com segurança: ${result.pedidosApagados + result.comprasLegadasApagadas} pedido(s) removido(s) e ${result.movimentosEstornados} baixa(s) automática(s) de estoque estornada(s). Os históricos antigos serão removidos dos aparelhos quando o aplicativo for aberto.`,
      });
      load();
    } catch {
      setSheet({ type: 'info', label: 'Não foi possível zerar os pedidos. Tente novamente.' });
    }
  };

  const sheetTitle = !sheet ? '' :
    sheet.type === 'perfume' ? (sheet.data ? 'Editar contratipo' : 'Novo contratipo') :
    sheet.type === 'movimento' ? 'Lançar estoque' :
    sheet.type === 'stock-count' ? 'Conferir estoque físico' :
    sheet.type === 'pedido' ? (sheet.data ? 'Editar pedido' : 'Novo pedido') :
    sheet.type === 'payment-operation' ? 'Conciliação do pagamento' :
    sheet.type === 'availability' ? 'Gerenciar pronta entrega' :
    sheet.type === 'whatsapp' ? 'Avisar cliente' :
    sheet.type === 'confirm' ? (sheet.title || (sheet.danger ? 'Confirmar exclusão' : 'Confirmar')) : 'Aviso';

  const openCreate = () => {
    if (tab === 'catalogo') { setSheet({ type: 'perfume' }); return; }
    if (perfumes.length === 0) { setSheet({ type: 'info', label: 'Cadastre um contratipo no Catálogo antes.' }); return; }
    if (tab === 'estoque') setSheet({ type: 'movimento' });
    else if (tab === 'pedidos') setSheet({ type: 'pedido' });
  };

  const renderContent = () => {
    if (loading) return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={COLORS.gold} accessibilityLabel="Carregando painel de controle" /></View>;

    if (tab === 'dashboard') {
      return (
        <AdminDashboard
          perfumeCount={perfumes.length}
          estoqueBaixo={estoqueBaixo}
          pendentes={pendentes}
          notaMedia={notaMedia}
          metricas={metricas}
          metricPeriod={metricPeriod}
          onMetricPeriodChange={changeMetricPeriod}
          pedidos={pedidosUnificados}
          onOpenPedido={abrirPedido}
        />
      );
    }

    if (tab === 'catalogo') {
      return (
        <AdminCatalog
          perfumes={perfumes}
          search={search}
          onSearchChange={setSearch}
          estoqueDe={resumoDe}
          onEdit={(perfume) => setSheet({ type: 'perfume', data: perfume })}
          onArchive={(perfume) => setSheet({
            type: 'confirm',
            label: `Arquivar "${perfume.nome}"? Ele sairá da vitrine, mas o histórico será preservado.`,
            onConfirm: () => doDeletePerfume(perfume.id),
            danger: true,
            confirmLabel: 'Arquivar perfume',
            safetyText: 'O perfume poderá ser restaurado e seus pedidos e movimentos de estoque não serão apagados.',
          })}
        />
      );
    }
    if (tab === 'estoque') {
      return (
        <AdminStockView
          perfumes={perfumes}
          movimentos={movimentos}
          estoqueResumo={estoqueResumo}
          search={stockSearch}
          onSearchChange={setStockSearch}
          onCountStock={(perfume) => setSheet({ type: 'stock-count', data: perfume })}
        />
      );
    }
    if (tab === 'pedidos') {
      return (
        <AdminOrdersView
          pedidos={pedidosUnificados}
          perfumes={perfumes}
          search={orderSearch}
          onSearchChange={setOrderSearch}
          layout={orderView}
          onLayoutChange={setOrderView}
          columnWidth={kanbanColumnWidth}
          movingOrderId={movingOrderId}
          onOpen={abrirPedido}
          onMove={moverPedido}
          onArchive={(pedido) => setSheet({
            type: 'confirm',
            label: `Arquivar pedido de ${pedido.cliente}? O histórico será preservado.`,
            onConfirm: () => pedido.compraLegada ? doDelCompra(pedido.compraLegada.id) : doDelPedido(pedido.id),
            confirmLabel: 'Arquivar pedido',
          })}
        />
      );
    }
    if (tab === 'opinioes') {
      return (
        <View style={{ padding: SPACING.lg }}>
          {opinioes.length === 0 && <EmptyState text="Nenhuma opinião ainda." />}
          {[...opinioes].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()).map((o) => {
            const p = perfumes.find((pf) => pf.id === o.perfumeId);
            return (
              <View key={o.id} style={styles.rowCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1, paddingRight: SPACING.sm }}>
                    <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodyLarge, fontWeight: '500' }}>{p?.nome || 'Perfume removido'}</Text>
                    <Text style={{ color: o.aprovada ? COLORS.sage : COLORS.gold, fontSize: FONT_SIZES.caption, marginTop: 2 }}>
                      {o.aprovada ? 'PUBLICADA NA VITRINE' : 'AGUARDANDO ANÁLISE'}
                    </Text>
                  </View>
                  <Pressable onPress={() => setSheet({ type: 'confirm', label: 'Arquivar esta avaliação? Ela deixará de aparecer, mas o registro será preservado.', onConfirm: () => doDelOpiniao(o.id), confirmLabel: 'Arquivar avaliação' })} hitSlop={8} accessibilityLabel={`Arquivar avaliação de ${o.cliente || 'cliente anônimo'}`}>
                    <Feather name="archive" size={14} color={COLORS.muted} />
                  </Pressable>
                </View>
                <View style={{ marginTop: 4 }}><Stars value={o.nota} size={14} /></View>
                {!!o.cliente && <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.label, marginTop: 4 }}>{o.cliente}</Text>}
                {!!o.comentario && <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, marginTop: 4 }}>{o.comentario}</Text>}
                <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
                  {!o.aprovada ? (
                    <Pressable
                      onPress={() => doModerateOpiniao(o.id, true)}
                      style={[styles.systemInlineButton, { flex: 1, justifyContent: 'center' }]}
                      accessibilityLabel={`Aprovar avaliação de ${o.cliente || 'cliente anônimo'}`}
                    >
                      <Feather name="check" size={14} color={COLORS.sage} />
                      <Text style={[styles.systemInlineButtonText, { color: COLORS.sage }]}>Aprovar</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => doModerateOpiniao(o.id, false)}
                      style={[styles.systemInlineButton, { flex: 1, justifyContent: 'center' }]}
                      accessibilityLabel={`Ocultar avaliação de ${o.cliente || 'cliente anônimo'}`}
                    >
                      <Feather name="eye-off" size={14} color={COLORS.gold} />
                      <Text style={styles.systemInlineButtonText}>Ocultar da vitrine</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
          <Text style={[styles.sectionLabel, { marginTop: SPACING.lg }]}>SUGESTÕES RECEBIDAS</Text>
          {sugestoes.length === 0 && <EmptyState text="Nenhuma sugestão recebida." />}
          {[...sugestoes].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()).map((s) => (
            <View key={s.id} style={styles.rowCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.body, fontWeight: '500' }}>{s.cliente || 'Anônimo'}</Text>
                <Pressable
                  onPress={() => setSheet({
                    type: 'confirm',
                    label: 'Arquivar esta sugestão? O registro continuará no histórico.',
                    onConfirm: () => doDelSugestao(s.id),
                    confirmLabel: 'Arquivar sugestão',
                  })}
                  hitSlop={8}
                  accessibilityLabel={`Arquivar sugestão de ${s.cliente || 'cliente anônimo'}`}
                >
                  <Feather name="archive" size={14} color={COLORS.muted} />
                </Pressable>
              </View>
              {!!s.contato && <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.label, marginTop: 2 }}>{s.contato}</Text>}
              <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, marginTop: 4 }}>{s.mensagem}</Text>
              <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 4 }}>{fmtDate(s.data)}</Text>
            </View>
          ))}
        </View>
      );
    }

    if (tab === 'sistema') {
      const setStoreField = <K extends keyof ConfiguracoesLoja,>(key: K, value: ConfiguracoesLoja[K]) => {
        setStoreConfig((current) => ({ ...current, [key]: value }));
      };
      const prontaEntrega = perfumes.filter((perfume) => perfume.prontaEntrega);
      const sobEncomenda = perfumes.filter((perfume) => !perfume.prontaEntrega);
      const prontaParaCompletar = prontaEntrega.filter((perfume) => resumoDe(perfume.id).saldoAtualMl < 1000);
      const quantidadeParaCompletar = prontaParaCompletar.reduce(
        (total, perfume) => total + Math.max(0, 1000 - resumoDe(perfume.id).saldoAtualMl),
        0,
      );
      const sobComSaldo = sobEncomenda.filter((perfume) => resumoDe(perfume.id).saldoAtualMl > 0);
      const quantidadeSobEncomenda = sobComSaldo.reduce(
        (total, perfume) => total + Math.max(0, resumoDe(perfume.id).saldoAtualMl),
        0,
      );

      if (systemView === 'historico') {
        return (
          <View style={styles.systemPage}>
            <Pressable onPress={() => setSystemView('main')} style={styles.systemBackButton}>
              <Feather name="arrow-left" size={16} color={COLORS.gold} />
              <Text style={styles.systemBackText}>Voltar ao Sistema</Text>
            </Pressable>
            <SystemCard icon="clock" title="Histórico de operações" subtitle="Publicações e ajustes registrados pelo sistema.">
              {!catalogoEstoque?.historico.length && (
                <Text style={styles.catalogHistoryEmpty}>Nenhuma operação manual registrada ainda.</Text>
              )}
              {catalogoEstoque?.historico.map((operacao) => (
                <View key={operacao.id} style={styles.catalogHistoryRow}>
                  <View style={styles.catalogHistoryIcon}>
                    <Feather
                      name={operacao.quantidadeMl > 0 ? 'activity' : 'check-circle'}
                      size={13}
                      color={COLORS.gold}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.catalogHistoryTitle}>{operacao.titulo}</Text>
                    <Text style={styles.catalogHistoryDetails}>{operacao.detalhes}</Text>
                    <Text style={styles.catalogHistoryDate}>{fmtDate(operacao.data)}</Text>
                  </View>
                </View>
              ))}
            </SystemCard>
          </View>
        );
      }

      if (systemView === 'arquivados') {
        return (
          <View style={styles.systemPage}>
            <Pressable onPress={() => setSystemView('main')} style={styles.systemBackButton}>
              <Feather name="arrow-left" size={16} color={COLORS.gold} />
              <Text style={styles.systemBackText}>Voltar ao Sistema</Text>
            </Pressable>
            <SystemCard icon="archive" title="Itens arquivados" subtitle="Registros preservados fora das telas operacionais.">
              {loadingArquivados && <ActivityIndicator color={COLORS.gold} style={{ marginVertical: SPACING.xl }} accessibilityLabel="Carregando pedidos arquivados" />}
              {!loadingArquivados && arquivados.length === 0 && (
                <Text style={styles.catalogHistoryEmpty}>Nenhum registro arquivado.</Text>
              )}
              {!loadingArquivados && arquivados.map((item) => (
                <View key={`${item.recurso}-${item.id}`} style={styles.catalogHistoryRow}>
                  <View style={styles.catalogHistoryIcon}>
                    <Feather name="archive" size={13} color={COLORS.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.catalogHistoryTitle}>{item.titulo}</Text>
                    <Text style={styles.catalogHistoryDetails}>{item.detalhes}</Text>
                    <Text style={styles.catalogHistoryDate}>{fmtDate(item.arquivadoEm)}</Text>
                  </View>
                  <Pressable
                    onPress={() => requestRestoreArquivado(item)}
                    style={styles.systemInlineButton}
                    accessibilityRole="button"
                    accessibilityLabel={`Restaurar ${item.titulo}`}
                  >
                    <Feather name="rotate-ccw" size={14} color={COLORS.gold} />
                    <Text style={styles.systemInlineButtonText}>Restaurar</Text>
                  </Pressable>
                </View>
              ))}
            </SystemCard>
          </View>
        );
      }

      if (systemView === 'privacidade') {
        const privacyLabels = {
          acesso: 'Acesso aos dados',
          correcao: 'Correção de dados',
          exclusao: 'Exclusão de dados',
          revogacao: 'Revogação de consentimento',
        };
        return (
          <View style={styles.systemPage}>
            <Pressable onPress={() => setSystemView('main')} style={styles.systemBackButton}>
              <Feather name="arrow-left" size={16} color={COLORS.gold} />
              <Text style={styles.systemBackText}>Voltar ao Sistema</Text>
            </Pressable>
            <SystemCard icon="shield" title="Central de Privacidade" subtitle="Solicitações feitas pelos clientes na vitrine.">
              {loadingPrivacidade && <ActivityIndicator color={COLORS.gold} style={{ marginVertical: SPACING.xl }} accessibilityLabel="Carregando solicitações de privacidade" />}
              {!loadingPrivacidade && solicitacoesPrivacidade.length === 0 && (
                <Text style={styles.catalogHistoryEmpty}>Nenhuma solicitação de privacidade recebida.</Text>
              )}
              {!loadingPrivacidade && solicitacoesPrivacidade.map((item) => (
                <View key={item.id} style={styles.privacyAdminCard}>
                  <View style={styles.privacyAdminHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.catalogHistoryTitle}>{privacyLabels[item.tipo]}</Text>
                      <Text style={styles.catalogHistoryDetails}>{item.protocolo} · {item.nome}</Text>
                    </View>
                    <Text style={styles.systemSuccessBadge}>{item.status.replace('_', ' ').toUpperCase()}</Text>
                  </View>
                  <Text style={styles.catalogHistoryDetails}>{item.contato}{item.email ? ` · ${item.email}` : ''}</Text>
                  {!!item.mensagem && <Text style={styles.privacyAdminMessage}>{item.mensagem}</Text>}
                  <Text style={styles.catalogHistoryDate}>{fmtDate(item.criadoEm)}</Text>
                  {item.status === 'recebida' && (
                    <Pressable onPress={() => void changePrivacyStatus(item, 'em_analise')} style={styles.systemInlineButton}>
                      <Feather name="eye" size={14} color={COLORS.gold} />
                      <Text style={styles.systemInlineButtonText}>Iniciar análise</Text>
                    </Pressable>
                  )}
                  {item.status === 'em_analise' && (
                    <Pressable onPress={() => void changePrivacyStatus(item, 'concluida')} style={styles.systemInlineButton}>
                      <Feather name="check" size={14} color={COLORS.gold} />
                      <Text style={styles.systemInlineButtonText}>Marcar concluída</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </SystemCard>
          </View>
        );
      }

      if (systemView === 'backup') {
        return (
          <View style={styles.systemPage}>
            <Pressable onPress={() => setSystemView('main')} style={styles.systemBackButton}>
              <Feather name="arrow-left" size={16} color={COLORS.gold} />
              <Text style={styles.systemBackText}>Voltar ao Sistema</Text>
            </Pressable>
            <SystemCard
              icon="database"
              title="Backup e restauração"
              subtitle="Proteja os dados da loja e recupere uma cópia anterior com segurança."
            >
              <View style={styles.operationHealthGrid}>
                <View style={styles.operationHealthItem}>
                  <Text style={styles.backupStatusValue}>
                    {operationalSummary?.ultimoBackupEm ? fmtDate(operationalSummary.ultimoBackupEm) : 'Não realizado'}
                  </Text>
                  <Text style={styles.operationHealthLabel}>Último backup</Text>
                </View>
                <View style={styles.operationHealthItem}>
                  <Text style={styles.backupStatusValue}>
                    {operationalSummary?.ultimaRestauracaoEm ? fmtDate(operationalSummary.ultimaRestauracaoEm) : 'Nunca restaurado'}
                  </Text>
                  <Text style={styles.operationHealthLabel}>Última restauração</Text>
                </View>
              </View>
              <View style={styles.backupGuidance}>
                <Feather name="shield" size={16} color={COLORS.gold} />
                <Text style={styles.backupGuidanceText}>
                  Exporte uma cópia antes de alterações importantes. O arquivo é criptografado e deve ser guardado fora do aparelho usado no painel.
                </Text>
              </View>
              <SystemAction
                icon="download"
                title="Baixar backup agora"
                subtitle="Gera uma cópia criptografada .lfe com os dados atuais."
                onPress={() => void doBackup()}
              />
              <SystemAction
                icon="upload"
                title="Restaurar um backup"
                subtitle="Primeiro valida o arquivo; só depois, com sua senha, substitui os dados."
                onPress={chooseAndRestoreBackup}
                danger
              />
              <Text style={styles.operationHealthHint}>
                A restauração é transacional: se alguma etapa falhar, nenhuma coleção será parcialmente substituída.
              </Text>
            </SystemCard>
          </View>
        );
      }

      if (systemView === 'custos') {
        return (
          <View style={styles.systemPage}>
            <Pressable onPress={() => setSystemView('main')} style={styles.systemBackButton}><Feather name="arrow-left" size={16} color={COLORS.gold} /><Text style={styles.systemBackText}>Voltar ao Sistema</Text></Pressable>
            <CustosView onChanged={() => void load()} />
          </View>
        );
      }

      if (systemView === 'insumos') {
        return (
          <View style={styles.systemPage}>
            <Pressable onPress={() => setSystemView('main')} style={styles.systemBackButton}><Feather name="arrow-left" size={16} color={COLORS.gold} /><Text style={styles.systemBackText}>Voltar ao Sistema</Text></Pressable>
            <InsumosView perfumes={perfumes} onChanged={() => void load()} />
          </View>
        );
      }

      if (systemView === 'fornecedores') {
        return (
          <View style={styles.systemPage}>
            <Pressable onPress={() => setSystemView('main')} style={styles.systemBackButton}><Feather name="arrow-left" size={16} color={COLORS.gold} /><Text style={styles.systemBackText}>Voltar ao Sistema</Text></Pressable>
            <FornecedoresView perfumes={perfumes} onChanged={() => void load()} />
          </View>
        );
      }
      return (
        <View style={styles.systemPage}>
          <View style={styles.systemHero}>
            <View style={styles.systemHeroIcon}><Feather name="settings" size={22} color={COLORS.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.systemEyebrow}>CENTRAL ADMINISTRATIVA</Text>
              <Text style={styles.systemTitle}>Sistema</Text>
              <Text style={styles.systemIntro}>Configurações globais, integrações e manutenção da {storePreview.nomeLoja}.</Text>
            </View>
          </View>

          <SystemCard icon="layers" title="Catálogo e Estoque" subtitle="Disponibilidade, ajustes em massa, publicação e histórico.">
            <View style={styles.catalogStatsGrid}>
              <View style={styles.catalogStat}>
                <Text style={styles.catalogStatValue}>
                  {catalogoEstoque?.prontaEntrega ?? prontaEntrega.length}
                </Text>
                <Text style={styles.catalogStatLabel}>Pronta entrega</Text>
                <Text style={styles.catalogStatMeta}>
                  {(catalogoEstoque?.estoqueProntaEntregaMl ?? prontaEntrega.reduce(
                    (total, perfume) => total + Math.max(0, resumoDe(perfume.id).saldoAtualMl),
                    0,
                  )).toLocaleString('pt-BR')}ml
                </Text>
              </View>
              <View style={styles.catalogStat}>
                <Text style={styles.catalogStatValue}>
                  {catalogoEstoque?.sobEncomenda ?? sobEncomenda.length}
                </Text>
                <Text style={styles.catalogStatLabel}>Sob encomenda</Text>
                <Text style={styles.catalogStatMeta}>
                  {(catalogoEstoque?.estoqueSobEncomendaMl ?? quantidadeSobEncomenda).toLocaleString('pt-BR')}ml
                </Text>
              </View>
            </View>
            <View style={styles.alphabeticalStatus}>
              <View style={styles.alphabeticalIcon}>
                <Feather name="check" size={13} color={COLORS.sage} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.alphabeticalTitle}>Ordem alfabética automática</Text>
                <Text style={styles.alphabeticalHint}>A vitrine permanece organizada de A a Z em todas as publicações.</Text>
              </View>
              <Text style={styles.systemSuccessBadge}>ATIVO</Text>
            </View>
            <SystemAction
              icon="check-square"
              title="Gerenciar pronta entrega"
              subtitle="Escolha quais perfumes estão disponíveis imediatamente."
              onPress={() => setSheet({ type: 'availability' })}
            />
            <SystemAction
              icon="arrow-up-circle"
              title="Completar pronta entrega até 1.000ml"
              subtitle={prontaParaCompletar.length
                ? `${prontaParaCompletar.length} item(ns) receberão ${quantidadeParaCompletar.toLocaleString('pt-BR')}ml.`
                : 'Todos os itens de pronta entrega já possuem pelo menos 1.000ml.'}
              disabled={prontaParaCompletar.length === 0}
              badge={prontaParaCompletar.length === 0 ? 'EM DIA' : undefined}
              onPress={() => setSheet({
                type: 'confirm',
                label: (
                  `Adicionar ${quantidadeParaCompletar.toLocaleString('pt-BR')}ml em `
                  + `${prontaParaCompletar.length} perfume(s) de pronta entrega? `
                  + 'Nenhum item sob encomenda será alterado.'
                ),
                onConfirm: doCompletarProntaEntrega,
                confirmLabel: 'Completar estoque',
              })}
            />
            <SystemAction
              icon="arrow-down-circle"
              title="Zerar estoque sob encomenda"
              subtitle={sobComSaldo.length
                ? `${sobComSaldo.length} item(ns) terão ${quantidadeSobEncomenda.toLocaleString('pt-BR')}ml retirados.`
                : 'Todos os itens sob encomenda já estão com saldo zero.'}
              danger={sobComSaldo.length > 0}
              disabled={sobComSaldo.length === 0}
              badge={sobComSaldo.length === 0 ? 'ZERADO' : undefined}
              onPress={() => setSheet({
                type: 'confirm',
                label: (
                  `Retirar ${quantidadeSobEncomenda.toLocaleString('pt-BR')}ml e zerar `
                  + `${sobComSaldo.length} perfume(s) sob encomenda?`
                ),
                onConfirm: doZerarSobEncomenda,
                confirmLabel: 'Zerar sob encomenda',
                danger: true,
                safetyText: 'O histórico das movimentações será preservado e esta retirada ficará registrada no Sistema.',
              })}
            />
            <SystemAction
              icon="refresh-cw"
              title="Sincronização automática da vitrine"
              subtitle="Alterações feitas em sequência são agrupadas e publicadas automaticamente."
              onPress={() => setSheet({
                type: 'info',
                label: 'A publicação manual não é mais necessária. Depois da última alteração, o sistema aguarda alguns segundos e atualiza a vitrine automaticamente.',
              })}
            />
            <SystemAction
              icon="clock"
              title="Abrir histórico de operações"
              subtitle="Consulte publicações e ajustes em uma página separada."
              badge={catalogoEstoque?.historico.length ? String(catalogoEstoque.historico.length) : undefined}
              onPress={() => setSystemView('historico')}
            />
          </SystemCard>

          <SystemCard icon="dollar-sign" title="Preços" subtitle="Defina os valores e aplique em todo o catálogo.">
            <Text style={styles.systemPriceHint}>
              Os campos abaixo carregam os preços mais usados atualmente no catálogo. Digitar um valor não altera a vitrine até você tocar em aplicar.
            </Text>
            <View style={styles.systemFieldGrid}>
              {([30, 50, 100] as const).map((ml) => (
                <View key={ml} style={styles.systemPriceField}>
                  <Text style={styles.systemFieldLabel}>{ml} ML</Text>
                  <TInput
                    keyboardType="decimal-pad"
                    value={priceInputs[ml]}
                    onChangeText={(value) => setPriceInputs((current) => ({ ...current, [ml]: value }))}
                    placeholder="0,00"
                  />
                </View>
              ))}
            </View>
            <Field label="Margem de lucro de referência (%)">
              <TInput
                keyboardType="decimal-pad"
                value={String(storeConfig.margemLucro).replace('.', ',')}
                onChangeText={(value) => setStoreField('margemLucro', Number(value.replace(',', '.')) || 0)}
                placeholder="0"
              />
            </Field>
            <Pressable
              disabled={savingPrices}
              onPress={() => setSheet({
                type: 'confirm',
                label: 'Aplicar os três preços informados em todos os perfumes e republicar a vitrine?',
                onConfirm: () => applyPriceSizes([30, 50, 100]),
                confirmLabel: 'Aplicar preços',
              })}
              style={styles.systemPrimaryButton}
              testID="system-apply-all-prices"
            >
              <Feather name="refresh-cw" size={15} color={COLORS.ink} />
              <Text style={styles.systemPrimaryText}>{savingPrices ? 'Aplicando…' : 'Aplicar para todos os perfumes'}</Text>
            </Pressable>
            <View style={styles.systemMiniActions}>
              {([30, 50, 100] as const).map((ml) => (
                <Pressable key={ml} onPress={() => applyPriceSizes([ml])} style={styles.systemMiniButton}>
                  <Text style={styles.systemMiniText}>Somente {ml} ml</Text>
                </Pressable>
              ))}
            </View>
          </SystemCard>

          <SystemCard icon="truck" title="Frete" subtitle="Valores exibidos ao cliente durante o pagamento.">
            <View style={styles.shippingHeader}>
              <Text style={styles.shippingTitle}>Melhor Envio</Text>
              <View style={[styles.shippingStatus, freteConfig?.integrado && { borderColor: COLORS.sage }]}>
                <View style={[styles.shippingStatusDot, { backgroundColor: freteConfig?.integrado ? COLORS.sage : COLORS.rust }]} />
                <Text style={{ color: freteConfig?.integrado ? COLORS.sage : COLORS.muted, fontSize: FONT_SIZES.caption }}>
                  {freteConfig?.integrado
                    ? `Conectado · ${freteConfig.ambiente === 'producao' ? 'Produção' : 'Sandbox'}`
                    : 'Aguardando conexão'}
                </Text>
              </View>
            </View>
            <View style={styles.systemFieldGrid}>
              <View style={{ flex: 1 }}>
                <Text style={styles.systemFieldLabel}>CEP DE ORIGEM</Text>
                <TInput keyboardType="numeric" maxLength={9} value={freteCepInput} onChangeText={setFreteCepInput} placeholder="00000-000" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.systemFieldLabel}>EMBALAGEM</Text>
                <TInput keyboardType="decimal-pad" value={freteFeeInput} onChangeText={setFreteFeeInput} placeholder="0,00" />
              </View>
            </View>
            <Field label="Frete grátis acima de (R$) · zero desativa">
              <TInput keyboardType="decimal-pad" value={freteGratisInput} onChangeText={setFreteGratisInput} placeholder="0,00" />
            </Field>
            <View style={styles.shippingRuleCard}>
              <Text style={styles.shippingRuleTitle}>Entrega Padrão</Text>
              <Text style={styles.shippingRuleHint}>Defina um acréscimo sobre o valor da transportadora e o prazo mostrado ao cliente.</Text>
              <View style={styles.shippingTypeRow}>
                <Pressable onPress={() => setFretePadraoTipo('valor')} style={[styles.shippingTypeButton, fretePadraoTipo === 'valor' && styles.shippingTypeButtonActive]}>
                  <Text style={[styles.shippingTypeText, fretePadraoTipo === 'valor' && styles.shippingTypeTextActive]}>Valor (R$)</Text>
                </Pressable>
                <Pressable onPress={() => setFretePadraoTipo('percentual')} style={[styles.shippingTypeButton, fretePadraoTipo === 'percentual' && styles.shippingTypeButtonActive]}>
                  <Text style={[styles.shippingTypeText, fretePadraoTipo === 'percentual' && styles.shippingTypeTextActive]}>Percentual (%)</Text>
                </Pressable>
              </View>
              <View style={styles.systemFieldGrid}>
                <View style={{ flex: 1 }}><Field label="Acréscimo"><TInput keyboardType="decimal-pad" value={fretePadraoInput} onChangeText={setFretePadraoInput} placeholder="0,00" /></Field></View>
                <View style={{ flex: 1 }}><Field label="Prazo exibido · 0 usa transportadora"><TInput keyboardType="numeric" value={fretePadraoPrazoInput} onChangeText={setFretePadraoPrazoInput} placeholder="0" /></Field></View>
              </View>
            </View>
            <View style={styles.shippingRuleCard}>
              <Text style={styles.shippingRuleTitle}>Entrega Prioritária</Text>
              <Text style={styles.shippingRuleHint}>A opção mais rápida recebe suas próprias regras de preço e prazo.</Text>
              <View style={styles.shippingTypeRow}>
                <Pressable onPress={() => setFretePrioritarioTipo('valor')} style={[styles.shippingTypeButton, fretePrioritarioTipo === 'valor' && styles.shippingTypeButtonActive]}>
                  <Text style={[styles.shippingTypeText, fretePrioritarioTipo === 'valor' && styles.shippingTypeTextActive]}>Valor (R$)</Text>
                </Pressable>
                <Pressable onPress={() => setFretePrioritarioTipo('percentual')} style={[styles.shippingTypeButton, fretePrioritarioTipo === 'percentual' && styles.shippingTypeButtonActive]}>
                  <Text style={[styles.shippingTypeText, fretePrioritarioTipo === 'percentual' && styles.shippingTypeTextActive]}>Percentual (%)</Text>
                </Pressable>
              </View>
              <View style={styles.systemFieldGrid}>
                <View style={{ flex: 1 }}><Field label="Acréscimo"><TInput keyboardType="decimal-pad" value={fretePrioritarioInput} onChangeText={setFretePrioritarioInput} placeholder="0,00" /></Field></View>
                <View style={{ flex: 1 }}><Field label="Prazo exibido · 0 usa transportadora"><TInput keyboardType="numeric" value={fretePrioritarioPrazoInput} onChangeText={setFretePrioritarioPrazoInput} placeholder="0" /></Field></View>
              </View>
              <Field label="Diferença mínima acima da Entrega Padrão (R$)">
                <TInput keyboardType="decimal-pad" value={fretePrioritarioDiferencaInput} onChangeText={setFretePrioritarioDiferencaInput} placeholder="3,00" />
              </Field>
              <Text style={styles.shippingRuleHint}>Se necessário, o sistema elevará automaticamente a Prioritária para manter essa diferença.</Text>
            </View>
            <Pressable onPress={saveFreteConfig} disabled={savingFrete} style={styles.systemPrimaryButton}>
              <Feather name="save" size={15} color={COLORS.ink} />
              <Text style={styles.systemPrimaryText}>{savingFrete ? 'Salvando…' : 'Salvar frete'}</Text>
            </Pressable>
            {!freteConfig?.integrado && (
              <SystemAction icon="external-link" title="Conectar Melhor Envio" subtitle="Autorize a conta responsável pelas cotações." onPress={connectMelhorEnvio} />
            )}
          </SystemCard>

          <SystemCard icon="dollar-sign" title="Custos & Rentabilidade" subtitle="Custo real por frasco, lucro estimado e margem por perfume.">
            <SystemAction icon="trending-up" title="Abrir custos" subtitle="Configure base, frascos, embalagem e acompanhe rentabilidade." onPress={() => setSystemView('custos')} badge="NOVO" />
          </SystemCard>

          <SystemCard icon="package" title="Matérias-primas & Produção" subtitle="Essências, base, frascos e baixa automática por ordem de produção.">
            <SystemAction icon="tool" title="Abrir produção" subtitle="Cadastre insumos, simule lotes e atualize o estoque acabado." onPress={() => setSystemView('insumos')} badge="NOVO" />
          </SystemCard>

          <SystemCard icon="archive" title="Fornecedores" subtitle="Contatos, condições comerciais e histórico de cotações.">
            <SystemAction
              icon="briefcase"
              title="Abrir fornecedores"
              subtitle="Cadastre fornecedores, preços e vincule cotações aos perfumes."
              onPress={() => setSystemView('fornecedores')}
              badge="NOVO"
            />
          </SystemCard>

          <SystemCard
            icon="activity"
            title="Saúde operacional"
            subtitle="Conciliação de pagamentos e recuperação dos dados."
          >
            <View style={styles.operationHealthGrid}>
              <View style={styles.operationHealthItem}>
                <Text style={[styles.operationHealthValue, operationalSummary?.pagamentosFalhos ? { color: COLORS.rust } : null]}>
                  {operationalSummary?.pagamentosFalhos ?? '—'}
                </Text>
                <Text style={styles.operationHealthLabel}>Falhas</Text>
              </View>
              <View style={styles.operationHealthItem}>
                <Text style={[styles.operationHealthValue, operationalSummary?.pagamentosRevisaoManual ? { color: COLORS.rust } : null]}>
                  {operationalSummary?.pagamentosRevisaoManual ?? '—'}
                </Text>
                <Text style={styles.operationHealthLabel}>Revisão manual</Text>
              </View>
              <View style={styles.operationHealthItem}>
                <Text style={styles.operationHealthValue}>{operationalSummary?.pagamentosEmEspera ?? '—'}</Text>
                <Text style={styles.operationHealthLabel}>Em espera</Text>
              </View>
              <View style={styles.operationHealthItem}>
                <Text style={styles.operationHealthValue}>{operationalSummary?.pagamentosProcessando ?? '—'}</Text>
                <Text style={styles.operationHealthLabel}>Processando</Text>
              </View>
              <View style={styles.operationHealthItem}>
                <Text style={[styles.operationHealthValue, operationalSummary?.errosFrontend24h ? { color: COLORS.rust } : null]}>
                  {operationalSummary?.errosFrontend24h ?? '—'}
                </Text>
                <Text style={styles.operationHealthLabel}>Falhas no app · 24h</Text>
              </View>
            </View>
            <Text style={styles.operationHealthHint}>
              Último backup exportado: {operationalSummary?.ultimoBackupEm ? fmtDate(operationalSummary.ultimoBackupEm) : 'ainda não registrado'}
            </Text>
            {operationalSummary?.integracoes && !operationalSummary.integracoes.infinitePayWebhookSecretDedicado && (
              <View style={styles.operationWarning}>
                <Feather name="shield" size={15} color={COLORS.rust} />
                <Text style={styles.operationWarningText}>
                  Configure INFINITEPAY_WEBHOOK_SECRET no Render com uma chave exclusiva para separar a proteção dos pagamentos da sessão administrativa.
                </Text>
              </View>
            )}
            {operationalSummary?.integracoes?.melhorEnvioAmbiente === 'sandbox' && (
              <View style={styles.operationWarning}>
                <Feather name="truck" size={15} color={COLORS.rust} />
                <Text style={styles.operationWarningText}>
                  O Melhor Envio está em Sandbox. Troque a URL e as credenciais para produção antes de operar entregas reais.
                </Text>
              </View>
            )}
            {!!operationalSummary?.falhasRecentes[0] && (
              <View style={styles.operationWarning}>
                <Feather name="alert-triangle" size={15} color={COLORS.rust} />
                <Text style={styles.operationWarningText}>
                  Pedido {operationalSummary.falhasRecentes[0].orderNsu || 'não identificado'} · {operationalSummary.falhasRecentes[0].tentativas} tentativa(s)
                </Text>
              </View>
            )}
            {!!operationalSummary?.pagamentosRevisaoManual && (
              <View style={styles.operationWarning}>
                <Feather name="shield" size={15} color={COLORS.rust} />
                <Text style={styles.operationWarningText}>
                  Há pagamento(s) que exigem conferência humana para evitar cobrança ou confirmação duplicada.
                </Text>
              </View>
            )}
            {!!operationalSummary?.pagamentosFalhos && (
              <SystemAction
                icon="rotate-ccw"
                title="Reprocessar confirmações com falha"
                subtitle="Devolve os eventos à fila automática sem alterar o pedido manualmente."
                onPress={() => void reprocessFailedPayments()}
                disabled={loadingOperation}
                danger
              />
            )}
            {!!operationalSummary?.estoquesNegativos?.length && (
              <View style={styles.operationWarning}>
                <Feather name="alert-octagon" size={15} color={COLORS.rust} />
                <Text style={styles.operationWarningText}>
                  Há {operationalSummary.estoquesNegativosTotal} saldo(s) físico(s) negativo(s). Confira a quantidade real na aba Estoque antes de continuar vendendo esses itens.
                </Text>
              </View>
            )}
            {!!operationalSummary?.errosFrontendRecentes?.[0] && (
              <View style={styles.operationWarning}>
                <Feather name="smartphone" size={15} color={COLORS.rust} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.operationWarningText}>
                    {operationalSummary.errosFrontendRecentes[0].mensagem}
                  </Text>
                  <Text style={styles.operationHealthHint}>
                    {operationalSummary.errosFrontendRecentes[0].plataforma || 'app'} · {operationalSummary.errosFrontendRecentes[0].ocorrencias} ocorrência(s)
                    {operationalSummary.errosFrontendRecentes[0].requestId
                      ? ` · código ${operationalSummary.errosFrontendRecentes[0].requestId}`
                      : ''}
                  </Text>
                </View>
              </View>
            )}
            <SystemAction
              icon="refresh-cw"
              title={loadingOperation ? 'Atualizando diagnóstico…' : 'Atualizar diagnóstico'}
              subtitle="Confere agora a fila de confirmações de pagamento."
              onPress={() => void refreshOperationalSummary(true)}
              disabled={loadingOperation}
              badge={operationalSummary?.status === 'atencao' ? 'ATENÇÃO' : operationalSummary ? 'OK' : undefined}
            />
          </SystemCard>

          <SystemCard icon="database" title="Base de dados" subtitle="Backup, registros preservados e limpezas protegidas.">
            <SystemAction
              icon="database"
              title="Abrir backup e restauração"
              subtitle="Baixe uma cópia segura ou recupere um backup anterior."
              onPress={() => setSystemView('backup')}
              badge={operationalSummary?.ultimoBackupEm ? 'PROTEGIDO' : 'PENDENTE'}
            />
            <SystemAction
              icon="archive"
              title="Itens arquivados"
              subtitle="Restaure pedidos, perfumes, avaliações e sugestões preservados."
              onPress={() => void openArquivados()}
              badge={arquivados.length ? String(arquivados.length) : undefined}
            />
            <SystemAction
              icon="shield"
              title="Central de Privacidade"
              subtitle="Atenda solicitações de acesso, correção, exclusão e revogação."
              onPress={() => void openPrivacidade()}
              badge={solicitacoesPrivacidade.filter((item) => item.status === 'recebida').length ? String(solicitacoesPrivacidade.filter((item) => item.status === 'recebida').length) : undefined}
            />
            <SystemAction
              icon="trash-2"
              title="Limpar pedidos"
              subtitle="Remove testes e invalida o histórico nos aparelhos."
              danger
              onPress={() => setSheet({
                type: 'confirm',
                label: 'Zerar toda a base de pedidos? As baixas automáticas serão estornadas e os históricos serão removidos dos aparelhos.',
                onConfirm: doResetPedidos,
                confirmLabel: 'Zerar pedidos',
                danger: true,
                requiresReauth: true,
              })}
            />
            <SystemAction
              icon="star"
              title="Limpar avaliações"
              subtitle="Remove opiniões e sugestões recebidas."
              danger
              onPress={() => setSheet({
                type: 'confirm',
                label: 'Excluir todas as opiniões e sugestões? Esta ação não pode ser desfeita.',
                onConfirm: () => clearSystemData('opinioes'),
                confirmLabel: 'Limpar avaliações',
                danger: true,
                requiresReauth: true,
              })}
            />
            <SystemAction
              icon="package"
              title="Limpar estoque"
              subtitle="Remove todos os lançamentos de entrada e saída."
              danger
              onPress={() => setSheet({
                type: 'confirm',
                label: 'Zerar todos os movimentos de estoque? O catálogo será preservado.',
                onConfirm: () => clearSystemData('estoque'),
                confirmLabel: 'Limpar estoque',
                danger: true,
                requiresReauth: true,
              })}
            />
            <SystemAction
              icon="alert-triangle"
              title="Resetar catálogo"
              subtitle="Remove perfumes, estoque e a vitrine publicada."
              danger
              onPress={() => setSheet({
                type: 'confirm',
                label: 'Resetar todo o catálogo? Só será permitido se não houver pedidos ativos.',
                onConfirm: () => clearSystemData('catalogo'),
                confirmLabel: 'Resetar catálogo',
                danger: true,
                requiresReauth: true,
              })}
            />
          </SystemCard>

          <SystemCard icon="sliders" title="Configurações" subtitle="Dados institucionais e canais de contato.">
            <View style={styles.storePreview} testID="store-brand-preview">
              <View style={styles.storePreviewVisual}>
                {storePreview.logoUrl ? (
                  <Image
                    source={{ uri: storePreview.logoUrl }}
                    style={styles.storePreviewLogo}
                    contentFit="contain"
                    transition={150}
                  />
                ) : (
                  <Text style={styles.storePreviewInitials}>{storeInitials || 'LF'}</Text>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.storePreviewLabel}>PRÉVIA DA VITRINE</Text>
                {!!storePreviewName.eyebrow && <Text style={styles.storePreviewEyebrow}>{storePreviewName.eyebrow}</Text>}
                <Text style={styles.storePreviewTitle} numberOfLines={1}>{storePreviewName.title}</Text>
                <Text style={styles.storePreviewHint}>
                  {[
                    storePreview.whatsapp && 'WhatsApp',
                    storePreview.instagram && 'Instagram',
                    storePreview.email && 'E-mail',
                    storeConfig.pix.trim() && 'Pix manual',
                  ].filter(Boolean).join(' · ') || 'Adicione seus canais de contato'}
                </Text>
              </View>
            </View>
            <Field label="Nome da loja"><TInput value={storeConfig.nomeLoja} onChangeText={(value) => setStoreField('nomeLoja', value)} testID="store-name-input" /></Field>
            <Field label="Logo no topo da vitrine (endereço da imagem)"><TInput value={storeConfig.logoUrl} onChangeText={(value) => setStoreField('logoUrl', value)} autoCapitalize="none" testID="store-logo-input" /></Field>
            <Text style={styles.storeConfigHelp}>Este campo substitui o nome no topo da vitrine. O ícone instalado usa separadamente o logo claro oficial.</Text>
            <View style={styles.systemFieldGrid}>
              <View style={{ flex: 1 }}><Field label="WhatsApp"><TInput value={storeConfig.whatsapp} onChangeText={(value) => setStoreField('whatsapp', value)} keyboardType="phone-pad" /></Field></View>
              <View style={{ flex: 1 }}><Field label="Instagram"><TInput value={storeConfig.instagram} onChangeText={(value) => setStoreField('instagram', value)} autoCapitalize="none" /></Field></View>
            </View>
            <Field label="E-mail"><TInput value={storeConfig.email} onChangeText={(value) => setStoreField('email', value)} keyboardType="email-address" autoCapitalize="none" /></Field>
            <Text style={styles.storeConfigHelp}>WhatsApp, Instagram e e-mail preenchidos aparecem em “Fale Conosco” para o cliente.</Text>
            <Field label="Chave Pix manual (contingência)"><TInput value={storeConfig.pix} onChangeText={(value) => setStoreField('pix', value)} autoCapitalize="none" /></Field>
            <Text style={styles.storeConfigHelp}>Usada somente como contingência manual quando o checkout automático da InfinitePay estiver desativado.</Text>
            <Field label="InfiniteTag da InfinitePay">
              <TInput
                value={storeConfig.infinitePayHandle}
                onChangeText={(value) => setStoreField('infinitePayHandle', value.replace(/^\$/, ''))}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="Ex.: lessencefurlani"
              />
            </Field>
            <Text style={styles.storeConfigHelp}>
              É o seu nome de usuário no app InfinitePay, sem o símbolo $. Ao salvar, Pix e cartão passam a ter confirmação automática.
            </Text>
            <Field label="CNPJ (opcional)"><TInput value={storeConfig.cnpj} onChangeText={(value) => setStoreField('cnpj', value)} keyboardType="numeric" /></Field>
            <Text style={styles.storeConfigHelp}>Fica armazenado para documentos e comprovantes futuros; ainda não é exibido na vitrine.</Text>
            <Pressable onPress={saveStoreConfig} disabled={savingStore} style={styles.systemPrimaryButton} testID="store-config-save">
              <Feather name="save" size={15} color={COLORS.ink} />
              <Text style={styles.systemPrimaryText}>{savingStore ? 'Salvando…' : 'Salvar configurações'}</Text>
            </Pressable>
          </SystemCard>

          <SystemCard icon="zap" title="Automações" subtitle="Rotinas operacionais em um único lugar.">
            <SystemAction icon="percent" title="Recalcular preços" subtitle="Preenche somente preços ausentes com o padrão atual." onPress={doPadronizar} />
            <SystemAction icon="refresh-cw" title="Reimportar fornecedores" subtitle="Sincroniza novamente a Nova Essência." onPress={doImport} />
            <SystemAction
              icon="package"
              title="Atualizar estoque por contagem"
              subtitle="Informe a quantidade física encontrada e registre somente a diferença."
              badge="ATIVO"
              onPress={() => setSheet({ type: 'stock-count' })}
            />
            <SystemAction
              icon="image"
              title="Auditar imagens e preços"
              subtitle="Localiza itens sem foto, com endereço inválido ou sem preço."
              badge="ATIVO"
              onPress={doAuditCatalog}
            />
            <SystemAction
              icon="tag"
              title="Gerar etiquetas por pedido"
              subtitle="Abra um pedido e baixe o PDF de etiquetas internas de produção."
              badge="ATIVO"
              onPress={() => { setTab('pedidos'); setSystemView('main'); setSheet(null); }}
            />
          </SystemCard>
        </View>
      );
    }

    return null;
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 2 }}>PAINEL DE CONTROLE</Text>
          <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.titleLarge, fontWeight: '500' }}>Administração</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={styles.topBtn} testID="auto-publish-status">
            <Feather name="refresh-cw" size={13} color={COLORS.sage} />
            <Text style={{ color: COLORS.sage, fontSize: FONT_SIZES.caption, marginLeft: 4 }}>Automática</Text>
          </View>
          <Pressable onPress={onSair} style={styles.topBtn} testID="sair-btn">
            <Feather name="log-out" size={13} color={COLORS.muted} />
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }} {...pullToRefresh.panHandlers}>
        {(refreshing || pullToRefresh.pullDistance > 0) && Platform.OS === 'web' && (
          <View style={styles.pullRefreshIndicator} pointerEvents="none">
            <ActivityIndicator
              size="small"
              color={COLORS.gold}
              animating={refreshing}
              accessibilityLabel="Atualizando painel de controle"
            />
            <Text style={styles.pullRefreshText}>
              {refreshing
                ? 'Atualizando painel…'
                : pullToRefresh.pullDistance >= pullToRefresh.releaseDistance
                  ? 'Solte para atualizar'
                  : 'Puxe para atualizar'}
            </Text>
          </View>
        )}
        <ScrollView
          contentContainerStyle={styles.adminScrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshPanel} tintColor={COLORS.gold} />}
          onScroll={pullToRefresh.onScroll}
          scrollEventThrottle={16}
        >
          <View style={[styles.adminContent, desktopViewport && styles.adminContentWide]}>
            <Animated.View
              style={{
                opacity: contentTransition,
                transform: [{
                  translateY: contentTransition.interpolate({
                    inputRange: [0, 1],
                    outputRange: [reducedMotion ? 0 : 7, 0],
                  }),
                }],
              }}
            >
              {renderContent()}
            </Animated.View>
          </View>
        </ScrollView>
      </View>
      {tab !== 'dashboard' && tab !== 'opinioes' && tab !== 'sistema' && (
        <Pressable onPress={openCreate} style={styles.fab} testID="fab-add">
          <Feather name="plus" size={24} color={COLORS.ink} />
        </Pressable>
      )}

      <View style={styles.tabbar}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <Pressable key={t.id} onPress={() => { setTab(t.id); setSystemView('main'); }} style={styles.tabItem} testID={`tab-${t.id}`}>
              <Feather name={t.icon} size={18} color={active ? COLORS.gold : COLORS.muted} />
              <Text style={{ color: active ? COLORS.gold : COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <BottomSheet visible={!!sheet} onClose={() => setSheet(null)} title={sheetTitle}>
        {sheet?.type === 'perfume' && <PerfumeForm initial={sheet.data} onSave={doSavePerfume} onCancel={() => setSheet(null)} />}
        {sheet?.type === 'movimento' && <MovimentoForm perfumes={perfumes} onSave={doMov} onCancel={() => setSheet(null)} />}
        {sheet?.type === 'stock-count' && (
          <StockCountForm
            perfumes={perfumes}
            resumo={estoqueResumo}
            initial={sheet.data}
            onSave={doStockCount}
            onCancel={() => setSheet(null)}
          />
        )}
        {sheet?.type === 'pedido' && (
          <PedidoForm
            perfumes={perfumes}
            initial={sheet.data}
            onSave={doSavePedido}
            onCancel={() => setSheet(null)}
            onDelete={requestDeletePedido}
            onGenerateLabels={doGenerateLabels}
            onPaymentOperation={(pedido) => setSheet({ type: 'payment-operation', data: pedido })}
          />
        )}
        {sheet?.type === 'payment-operation' && (
          <PaymentOperationForm
            pedido={sheet.data}
            onSave={(operacao, motivo, referencia) => doPaymentOperation(sheet.data, operacao, motivo, referencia)}
            onCancel={() => setSheet({ type: 'pedido', data: sheet.data })}
          />
        )}
        {sheet?.type === 'availability' && (
          <AdminAvailabilityManager
            perfumes={perfumes}
            onSave={requestSaveAvailability}
            onCancel={() => setSheet(null)}
          />
        )}
        {sheet?.type === 'confirm' && (
          <ConfirmSheetContent sheet={sheet} onCancel={() => setSheet(null)} />
        )}
        {sheet?.type === 'whatsapp' && (
          <View>
            <View style={styles.whatsappStatusNotice}>
              <Feather name="check-circle" size={17} color={COLORS.sage} />
              <View style={{ flex: 1 }}>
                <Text style={styles.whatsappStatusTitle}>Status atualizado</Text>
                <Text style={styles.whatsappStatusSubtitle}>{sheet.statusLabel}</Text>
              </View>
            </View>
            <Text style={styles.whatsappStatusHint}>
              {sheet.phone.length >= 12
                ? 'A mensagem não será enviada automaticamente. Confira o texto e envie pelo WhatsApp.'
                : 'O status foi salvo, mas o pedido não possui um WhatsApp válido. Confira o campo Contato do pedido.'}
            </Text>
            <View style={styles.whatsappMessagePreview}>
              <Text selectable style={styles.whatsappMessageText}>{sheet.message}</Text>
            </View>
            <View style={styles.whatsappStatusActions}>
              <SecondaryButton label={sheet.phone.length >= 12 ? 'Agora não' : 'Fechar'} onPress={() => setSheet(null)} />
              <PrimaryButton
                label={sheet.phone.length >= 12 ? 'Abrir WhatsApp' : 'WhatsApp não informado'}
                onPress={() => openStatusWhatsApp(sheet)}
                disabled={sheet.phone.length < 12}
                testID="order-status-whatsapp"
              />
            </View>
          </View>
        )}
        {sheet?.type === 'info' && (
          <View>
            <Text style={{ color: COLORS.bone, marginBottom: SPACING.lg }}>{sheet.label}</Text>
            <PrimaryButton label="Entendi" onPress={() => setSheet(null)} testID="info-ok" />
          </View>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  adminScrollContent: { flexGrow: 1, paddingBottom: 120 },
  adminContent: { width: '100%' },
  adminContentWide: { maxWidth: 1840, alignSelf: 'center' },
  pullRefreshIndicator: { position: 'absolute', zIndex: 20, top: 6, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, minHeight: 34, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  pullRefreshText: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.md },
  topBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  shippingPanel: { padding: SPACING.md, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.lg },
  shippingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  shippingTitle: { color: COLORS.bone, fontSize: FONT_SIZES.subtitle, fontWeight: '600', marginTop: -4 },
  shippingStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  shippingStatusDot: { width: 6, height: 6, borderRadius: 3 },
  shippingHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 16, marginVertical: SPACING.md },
  shippingRuleCard: { padding: 12, marginBottom: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  shippingRuleTitle: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '700' },
  shippingRuleHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 14, marginTop: 2, marginBottom: 9 },
  shippingTypeRow: { flexDirection: 'row', gap: 7, marginBottom: 9 },
  shippingTypeButton: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  shippingTypeButtonActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  shippingTypeText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  shippingTypeTextActive: { color: COLORS.ink },
  shippingFields: { flexDirection: 'row', gap: 8 },
  shippingFieldLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, letterSpacing: 0.8, marginBottom: 5 },
  shippingSaveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: RADIUS.md, backgroundColor: COLORS.gold, marginTop: SPACING.sm },
  shippingSaveText: { color: COLORS.ink, fontSize: FONT_SIZES.label, fontWeight: '600' },
  shippingConnectButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.sm },
  shippingConnectText: { color: COLORS.gold, fontSize: FONT_SIZES.label },
  shippingEnvironment: { color: COLORS.muted, fontSize: FONT_SIZES.caption, textAlign: 'center', marginTop: 8 },
  whatsappStatusNotice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.sage + '66', backgroundColor: COLORS.sage + '12' },
  whatsappStatusTitle: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '700' },
  whatsappStatusSubtitle: { color: COLORS.sage, fontSize: FONT_SIZES.caption, marginTop: 2 },
  whatsappStatusHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 16, marginBottom: SPACING.sm },
  whatsappMessagePreview: { padding: SPACING.md, marginBottom: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  whatsappMessageText: { color: COLORS.bone, fontSize: FONT_SIZES.label, lineHeight: 18 },
  whatsappStatusActions: { flexDirection: 'row', gap: 8 },
  systemPage: { padding: SPACING.lg },
  systemBackButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 11, marginBottom: SPACING.md, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  systemBackText: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  systemHero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.gold + '55', backgroundColor: COLORS.surfaceRaised },
  systemHeroIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.gold + '66', backgroundColor: COLORS.surface },
  systemEyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.4 },
  systemTitle: { color: COLORS.bone, fontSize: FONT_SIZES.titleLarge, fontWeight: '600', marginTop: 1 },
  systemIntro: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 16, marginTop: 3 },
  catalogStatsGrid: { flexDirection: 'row', gap: 8, marginBottom: SPACING.sm },
  catalogStat: { flex: 1, padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  catalogStatValue: { color: COLORS.bone, fontSize: FONT_SIZES.titleLarge, fontWeight: '700' },
  catalogStatLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 1 },
  catalogStatMeta: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600', marginTop: 6 },
  alphabeticalStatus: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 10, marginBottom: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.sage + '66', backgroundColor: COLORS.surface },
  alphabeticalIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.sage + '22', borderWidth: 1, borderColor: COLORS.sage + '55' },
  alphabeticalTitle: { color: COLORS.bone, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  alphabeticalHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 12, marginTop: 2 },
  systemSuccessBadge: { color: COLORS.sage, fontSize: FONT_SIZES.caption, letterSpacing: 0.6, paddingHorizontal: 7, paddingVertical: 4, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.sage + '77' },
  catalogHistoryEmpty: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15, paddingVertical: 8 },
  catalogHistoryRow: { flexDirection: 'row', gap: 9, paddingVertical: 9, borderTopWidth: 1, borderTopColor: COLORS.border },
  catalogHistoryIcon: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  catalogHistoryTitle: { color: COLORS.bone, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  catalogHistoryDetails: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 13, marginTop: 2 },
  catalogHistoryDate: { color: COLORS.gold, fontSize: FONT_SIZES.caption, marginTop: 3 },
  systemInlineButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.pill, backgroundColor: COLORS.surface },
  systemInlineButtonText: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  privacyAdminCard: { paddingVertical: SPACING.md, gap: 7, borderTopWidth: 1, borderTopColor: COLORS.border },
  privacyAdminHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  privacyAdminMessage: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, lineHeight: 18, padding: SPACING.sm, borderRadius: RADIUS.sm, backgroundColor: COLORS.surface },
  storePreview: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 104, padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.gold + '55', backgroundColor: COLORS.surface },
  storePreviewVisual: { width: 74, height: 74, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: COLORS.gold + '55', backgroundColor: COLORS.surfaceRaised },
  storePreviewLogo: { width: '100%', height: '100%' },
  storePreviewInitials: { color: COLORS.gold, fontSize: FONT_SIZES.display, fontWeight: '700', letterSpacing: 1 },
  storePreviewLabel: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.4, marginBottom: 4 },
  storePreviewEyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 2.2 },
  storePreviewTitle: { color: COLORS.bone, fontSize: FONT_SIZES.heading, lineHeight: 22, fontWeight: '700', letterSpacing: 0.8 },
  storePreviewHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 13, marginTop: 4 },
  systemFieldGrid: { flexDirection: 'row', gap: 8, marginBottom: SPACING.sm },
  systemPriceField: { flex: 1 },
  systemPriceHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15, marginBottom: SPACING.md },
  systemFieldLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, letterSpacing: 0.7, marginBottom: 5 },
  storeConfigHelp: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 13, marginTop: -8, marginBottom: SPACING.md },
  systemPrimaryButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12, borderRadius: RADIUS.md, backgroundColor: COLORS.gold, marginTop: SPACING.sm },
  systemPrimaryText: { color: COLORS.ink, fontSize: FONT_SIZES.label, fontWeight: '700' },
  systemMiniActions: { flexDirection: 'row', gap: 6, marginTop: 7 },
  systemMiniButton: { flex: 1, minHeight: 35, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  systemMiniText: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600', textAlign: 'center' },
  operationHealthGrid: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  operationHealthItem: { flex: 1, minHeight: 58, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  operationHealthValue: { color: COLORS.bone, fontSize: FONT_SIZES.title, fontWeight: '700' },
  operationHealthLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  operationHealthHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15, marginBottom: 8 },
  backupStatusValue: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '700', textAlign: 'center' },
  backupGuidance: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 11, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, marginBottom: 6 },
  backupGuidanceText: { flex: 1, color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, lineHeight: 18 },
  operationWarning: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.rust, backgroundColor: COLORS.surface, marginBottom: 4 },
  operationWarningText: { flex: 1, color: COLORS.rust, fontSize: FONT_SIZES.caption, lineHeight: 15 },
  supplierActive: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 4, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.gold + '44' },
  supplierName: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '700' },
  supplierMeta: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  connectedPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.sage + '88' },
  connectedPillText: { color: COLORS.sage, fontSize: FONT_SIZES.caption, fontWeight: '700', letterSpacing: 0.6 },
  sectionLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginBottom: SPACING.sm, letterSpacing: 1 },
  rowCard: { padding: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.sm },
  ordersManagement: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceRaised },
  ordersManagementTitle: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.1, marginBottom: 3 },
  ordersManagementText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15 },
  resetOrdersButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 11, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.rust + '88', backgroundColor: COLORS.surface },
  resetOrdersText: { color: COLORS.rust, fontSize: FONT_SIZES.caption, fontWeight: '700' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, backgroundColor: COLORS.surface },
  miniChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, flexShrink: 0 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, marginBottom: SPACING.sm },
  searchInput: { flex: 1, color: COLORS.bone, paddingVertical: 10, fontSize: FONT_SIZES.body },
  actionBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm, alignItems: 'center' },
  fab: { position: 'absolute', right: 20, bottom: 86, width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8 },
  tabbar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', paddingBottom: 16, paddingTop: 8, backgroundColor: COLORS.surfaceRaised, borderTopWidth: 1, borderTopColor: COLORS.border },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 4 },
});
