import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, useWindowDimensions, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import {
  COLORS, SPACING, RADIUS, STATUS, FONT_SIZES,
  statusPermitidosNoPainel,
  brl, familiasDoPerfume, fmtDate, nomeConcentracao, padSeq,
} from '../theme';
import { BottomSheet } from './BottomSheet';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import { AppText as Text, AppTextInput as TextInput } from './Typography';
import { Field, TInput, PrimaryButton, SecondaryButton, EmptyState, Stars } from './atoms';
import {
  listPerfumes, createPerfume, updatePerfume, deletePerfume, bulkImport, padronizarTamanhos,
  listMovimentos, createMovimento, getEstoqueMap, getEstoqueResumo, conferirEstoque,
  atualizarDisponibilidadeCatalogo,
  getCatalogoEstoqueResumo, completarEstoqueProntaEntrega, zerarEstoqueSobEncomenda,
  listPedidos, createPedido, updatePedido, deletePedido, registerPaymentOperation, getClientePorContato,
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
import type { CatalogoEstoqueResumo, Compra, ConfiguracaoFrete, ConfiguracoesLoja, EstoqueResumo, Metricas, Movimento, Opiniao, OrderStatus, PaymentOperation, Pedido, PedidoItem, Perfume, Sugestao } from '../types';
import { publicStoreConfig, storeNameParts, whatsappNumber } from '../storeConfig';
import { CustosView, FornecedoresView, InsumosView } from './GestaoOperacional';
import { useWebPullToRefresh } from '../hooks/use-web-pull-to-refresh';
import {
  ConfirmSheetContent,
  SystemAction,
  SystemCard,
  type ConfirmSheet,
} from './AdminSystemComponents';
import { AdminAvailabilityManager } from './AdminAvailabilityManager';
import {
  ADMIN_KANBAN_FLOW as KANBAN_FLOW,
  KanbanPedidoCard,
  SwipeablePedidoCard,
  type AdminPedido as PedidoPainel,
} from './AdminOrderCards';
import {
  MovimentoForm,
  PerfumeForm,
  StockCountForm,
  type MovimentoDraft,
  type PerfumeSaveData,
} from './AdminInventoryForms';

type FeatherIconName = React.ComponentProps<typeof Feather>['name'];
type PedidoFormState = Partial<Pedido> & Pick<Pedido, 'cliente' | 'contato' | 'status' | 'observacoes' | 'itens'>;
type PedidoSaveData = PedidoFormState & {
  itens: PedidoItem[];
  subtotalTabela: number;
  ajusteManual: number;
  total: number;
};
type PedidoEndereco = NonNullable<Pedido['endereco']>;

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

function StatCard({ label, value, icon, alert }: { label: string; value: string | number; icon: FeatherIconName; alert?: boolean }) {
  return (
    <View style={[styles.statCard, alert && { borderColor: COLORS.rust }]}>
      <Feather name={icon} size={16} color={alert ? COLORS.rust : COLORS.gold} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const PAYMENT_OPERATION_COPY: Record<PaymentOperation, { label: string; hint: string }> = {
  solicitar_estorno: {
    label: 'Solicitar estorno',
    hint: 'Marca o valor como aguardando devolução.',
  },
  confirmar_estorno: {
    label: 'Confirmar estorno realizado',
    hint: 'Use somente depois de concluir o cancelamento no provedor.',
  },
  registrar_contestacao: {
    label: 'Registrar contestação',
    hint: 'Sinaliza uma venda contestada pelo titular do cartão.',
  },
  resolver_contestacao_favoravel: {
    label: 'Contestação favorável',
    hint: 'O pagamento continua válido para a loja.',
  },
  resolver_chargeback: {
    label: 'Confirmar chargeback',
    hint: 'O valor foi devolvido ao titular e deixa de compor a receita.',
  },
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  aguardando_pagamento: 'Aguardando pagamento',
  pendente: 'Pendente',
  pago: 'Pago',
  estorno_solicitado: 'Estorno solicitado',
  estornado: 'Estornado',
  contestado: 'Em contestação',
  chargeback_confirmado: 'Chargeback confirmado',
};

function PaymentOperationForm({
  pedido,
  onSave,
  onCancel,
}: {
  pedido: Pedido;
  onSave: (operacao: PaymentOperation, motivo: string, referencia: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const status = pedido.pagamento?.status || '';
  const operacoes: PaymentOperation[] = status === 'pago'
    ? ['solicitar_estorno', 'registrar_contestacao']
    : status === 'estorno_solicitado'
      ? ['confirmar_estorno', 'registrar_contestacao']
      : status === 'contestado'
        ? ['resolver_contestacao_favoravel', 'resolver_chargeback']
        : [];
  const [operacao, setOperacao] = useState<PaymentOperation | null>(operacoes[0] || null);
  const [motivo, setMotivo] = useState('');
  const [referencia, setReferencia] = useState('');
  const [saving, setSaving] = useState(false);
  const exigeReferencia = operacao != null && [
    'confirmar_estorno',
    'resolver_contestacao_favoravel',
    'resolver_chargeback',
  ].includes(operacao);
  const valido = Boolean(operacao && motivo.trim().length >= 5 && (!exigeReferencia || referencia.trim().length >= 3));
  const submit = async () => {
    if (!operacao || !valido || saving) return;
    setSaving(true);
    try {
      await onSave(operacao, motivo.trim(), referencia.trim());
    } finally {
      setSaving(false);
    }
  };
  return (
    <View>
      <View style={styles.paymentProviderNotice}>
        <Feather name="alert-circle" size={19} color={COLORS.gold} />
        <Text style={styles.paymentProviderNoticeText}>
          O ERP não movimenta dinheiro. Faça o estorno ou acompanhe a contestação no provedor ou banco (InfinitePay, quando aplicável) e registre aqui o resultado.
        </Text>
      </View>
      <Text style={styles.paymentOperationStatus}>
        Pedido Nº {padSeq(pedido.seq)} · situação atual: {PAYMENT_STATUS_LABELS[status] || 'Não informada'}
      </Text>
      {operacoes.map((item) => {
        const selected = operacao === item;
        return (
          <Pressable
            key={item}
            onPress={() => setOperacao(item)}
            style={[styles.paymentOperationChoice, selected && styles.paymentOperationChoiceActive]}
          >
            <Feather name={selected ? 'check-circle' : 'circle'} size={18} color={selected ? COLORS.gold : COLORS.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentOperationChoiceTitle}>{PAYMENT_OPERATION_COPY[item].label}</Text>
              <Text style={styles.paymentOperationChoiceHint}>{PAYMENT_OPERATION_COPY[item].hint}</Text>
            </View>
          </Pressable>
        );
      })}
      {operacoes.length === 0 && (
        <Text style={styles.paymentOperationEmpty}>Este pagamento não possui operações pendentes.</Text>
      )}
      {operacoes.length > 0 && (
        <>
          <Field label="Motivo ou observação">
            <TInput value={motivo} onChangeText={setMotivo} placeholder="Ex.: cliente solicitou cancelamento" multiline />
          </Field>
          <Field label={exigeReferencia ? 'Protocolo, NSU ou referência' : 'Referência (opcional)'}>
            <TInput value={referencia} onChangeText={setReferencia} placeholder="Informe o comprovante do provedor" />
          </Field>
        </>
      )}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
        <SecondaryButton label="Voltar" onPress={onCancel} />
        {operacoes.length > 0 && (
          <PrimaryButton label={saving ? 'Salvando…' : 'Registrar operação'} disabled={!valido || saving} onPress={submit} testID="payment-operation-save" />
        )}
      </View>
    </View>
  );
}

function PedidoForm({
  perfumes,
  initial,
  onSave,
  onCancel,
  onDelete,
  onGenerateLabels,
  onPaymentOperation,
}: {
  perfumes: Perfume[];
  initial?: Pedido;
  onSave: (data: PedidoSaveData) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: (pedido: Pedido) => void | Promise<void>;
  onGenerateLabels?: (pedido: Pedido) => void | Promise<void>;
  onPaymentOperation?: (pedido: Pedido) => void;
}) {
  const [f, setF] = useState<PedidoFormState>(initial || {
    cliente: '', contato: '', status: 'pendente', observacoes: '', itens: [],
  });
  const pedidoRecebido = Boolean(initial?.id);
  const [valorPersonalizado, setValorPersonalizado] = useState(Boolean(initial?.id || initial?.ajusteManual));
  const [valorFinalInput, setValorFinalInput] = useState(
    initial?.total != null ? Number(initial.total).toFixed(2).replace('.', ',') : '',
  );
  const [searchingIdx, setSearchingIdx] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [editandoEndereco, setEditandoEndereco] = useState(false);
  const [recuperandoEndereco, setRecuperandoEndereco] = useState(false);
  const [mensagemEndereco, setMensagemEndereco] = useState('');
  const set = <K extends keyof PedidoFormState,>(k: K, v: PedidoFormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const enderecoVazio = (): PedidoEndereco => ({
    cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
  });
  const setEndereco = <K extends keyof PedidoEndereco,>(k: K, v: PedidoEndereco[K]) => setF((s) => ({
    ...s,
    endereco: { ...(s.endereco || enderecoVazio()), [k]: v },
  }));
  const pedidoRetirada = initial?.entrega?.tipo === 'retirada' || initial?.tipoEntrega === 'retirada';
  const recuperarEnderecoCliente = async () => {
    const contato = String(f.contato || '').trim();
    if (!contato) {
      setMensagemEndereco('Este pedido não possui contato para localizar o cadastro do cliente.');
      return;
    }
    setRecuperandoEndereco(true);
    setMensagemEndereco('');
    try {
      const cliente = await getClientePorContato(contato);
      if (!cliente.endereco) {
        setMensagemEndereco('O cadastro deste cliente não possui endereço salvo.');
        return;
      }
      setF((current) => ({ ...current, endereco: { ...enderecoVazio(), ...cliente.endereco } }));
      setEditandoEndereco(true);
      setMensagemEndereco('Endereço recuperado do cadastro do cliente. Confira e salve o pedido.');
    } catch {
      setMensagemEndereco('Não foi possível localizar um endereço salvo para este contato.');
    } finally {
      setRecuperandoEndereco(false);
    }
  };
  const addItem = () => {
    if (!perfumes[0]) return;
    setF((s) => ({ ...s, itens: [...s.itens, { perfumeId: perfumes[0].id, ml: perfumes[0].precos?.[0]?.ml || 30, quantidade: 1 }] }));
    setSearchingIdx(f.itens.length);
    setQ('');
  };
  const setItem = <K extends keyof PedidoItem,>(i: number, k: K, v: PedidoItem[K]) => setF((s) => ({
    ...s,
    itens: s.itens.map((it, idx) => idx === i ? { ...it, [k]: v } : it),
  }));
  const rmItem = (i: number) => setF((s) => ({ ...s, itens: s.itens.filter((_, idx) => idx !== i) }));
  const precoDo = (it: PedidoItem) => {
    if (it.precoUnitario != null && Number.isFinite(Number(it.precoUnitario))) {
      return Number(it.precoUnitario);
    }
    const p = perfumes.find((pf) => pf.id === it.perfumeId);
    return p?.precos.find((pr) => pr.ml === Number(it.ml))?.preco || 0;
  };
  const totalProdutos = f.itens.reduce((sum, item) => sum + precoDo(item) * item.quantidade, 0);
  const totalCalculado = Math.round((totalProdutos + Number(f.frete || 0)) * 100) / 100;
  const valorDigitado = Number(valorFinalInput.replace(',', '.'));
  const valorDigitadoValido = valorFinalInput.trim().length > 0
    && Number.isFinite(valorDigitado)
    && valorDigitado >= 0;
  const total = valorPersonalizado && valorDigitadoValido
    ? Math.round(valorDigitado * 100) / 100
    : totalCalculado;
  const ajusteManual = Math.round((total - totalCalculado) * 100) / 100;
  const pedidoParaSalvar = (status = f.status): PedidoSaveData => ({
    ...f,
    status,
    itens: f.itens.map((it) => {
      const precoUnitario = precoDo(it);
      return {
        ...it,
        precoUnitario,
        subtotal: Math.round(precoUnitario * it.quantidade * 100) / 100,
      };
    }),
    subtotalTabela: Math.round(totalProdutos * 100) / 100,
    ajusteManual,
    total,
  });
  const filtrados = perfumes.filter((p) => p.nome.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  return (
    <View>
      <Field label="Cliente"><TInput value={f.cliente} onChangeText={(v) => set('cliente', v)} testID="pedido-cliente" /></Field>
      <Field label="Contato (opcional)"><TInput value={f.contato} onChangeText={(v) => set('contato', v)} /></Field>
      <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.label, marginBottom: 6 }}>Itens do pedido</Text>
      {f.itens.map((it, i) => {
        const p = perfumes.find((pf) => pf.id === it.perfumeId);
        const editando = searchingIdx === i;
        return (
          <View key={i} style={{ padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={() => { if (!pedidoRecebido) { setSearchingIdx(editando ? null : i); setQ(''); } }}
                disabled={pedidoRecebido}
                style={{ flex: 1 }}
                testID={`item-select-${i}`}
              >
                <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption }}>Nº {padSeq(p?.seq || 0)}</Text>
                <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.body, fontWeight: '500' }} numberOfLines={1}>{p?.nome || 'Selecionar perfume'}</Text>
                {!pedidoRecebido && <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption }}>{editando ? 'toque para fechar' : 'toque para trocar'}</Text>}
              </Pressable>
              {!pedidoRecebido && <Pressable onPress={() => rmItem(i)} hitSlop={8} accessibilityLabel="Remover item do pedido"><Feather name="x" size={16} color={COLORS.rust} /></Pressable>}
            </View>
            {editando && (
              <View style={{ marginTop: SPACING.sm }}>
                <View style={styles.searchBox}>
                  <Feather name="search" size={14} color={COLORS.muted} />
                  <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Buscar contratipo..."
                    placeholderTextColor={COLORS.muted + 'BB'}
                    style={styles.searchInput}
                    testID={`item-search-${i}`}
                    autoFocus
                  />
                </View>
                <ScrollView style={{ maxHeight: 200, borderRadius: 8, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }} nestedScrollEnabled>
                  {filtrados.length === 0 && <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.label, padding: 12 }}>Nenhum resultado.</Text>}
                  {filtrados.map((p2) => (
                    <Pressable
                      key={p2.id}
                      onPress={() => { setItem(i, 'perfumeId', p2.id); setItem(i, 'ml', p2.precos?.[0]?.ml || 30); setSearchingIdx(null); setQ(''); }}
                      style={{ paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: it.perfumeId === p2.id ? COLORS.surfaceRaised : 'transparent' }}
                      testID={`item-option-${p2.id}`}
                    >
                      <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption }}>Nº {padSeq(p2.seq)}</Text>
                      <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodySmall }} numberOfLines={1}>{p2.nome}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
            {pedidoRecebido ? (
              <View style={styles.orderChoiceRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderChoiceLabel}>TAMANHO ESCOLHIDO</Text>
                  <Text style={styles.orderChoiceValue}>
                    {it.ml}ml · {brl((p?.precos || []).find((pr) => pr.ml === Number(it.ml))?.preco || 0)}
                  </Text>
                </View>
                <View style={styles.orderQuantity}>
                  <Text style={styles.orderChoiceLabel}>QUANTIDADE</Text>
                  <Text style={styles.orderQuantityValue}>{it.quantidade}</Text>
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: SPACING.sm }}>
                {(p?.precos || []).map((pr) => (
                  <Pressable key={pr.ml} onPress={() => setItem(i, 'ml', pr.ml)} style={[styles.miniChip, Number(it.ml) === pr.ml && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}>
                    <Text style={{ color: Number(it.ml) === pr.ml ? COLORS.ink : COLORS.muted, fontSize: FONT_SIZES.caption }}>{pr.ml}ml · {brl(pr.preco)}</Text>
                  </Pressable>
                ))}
                <TInput style={{ width: 60 }} keyboardType="numeric" value={String(it.quantidade)} onChangeText={(v) => setItem(i, 'quantidade', Number(v) || 1)} />
              </View>
            )}
          </View>
        );
      })}
      {!pedidoRecebido && <Pressable onPress={addItem} testID="pedido-add-item"><Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.label, marginBottom: SPACING.md }}>+ adicionar item</Text></Pressable>}
      {pedidoRecebido && (initial?.email || initial?.whatsapp || initial?.contato) && (
        <View style={styles.orderDeliveryCard}>
          <View style={styles.orderDeliveryIcon}>
            <Feather name="user" size={17} color={COLORS.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderDeliveryTitle}>Contato informado no checkout</Text>
            {!!(initial.whatsapp || initial.contato) && (
              <Text style={styles.orderDeliveryMeta}>WhatsApp: {initial.whatsapp || initial.contato}</Text>
            )}
            {!!initial.email && <Text style={styles.orderDeliveryMeta}>E-mail: {initial.email}</Text>}
          </View>
        </View>
      )}
      {pedidoRecebido && initial?.entrega && (
        <View style={styles.orderDeliveryCard}>
          <View style={styles.orderDeliveryIcon}>
            <Feather name="truck" size={17} color={COLORS.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderDeliveryTitle}>
              {initial.entrega.tipo === 'retirada'
                ? 'Retirada Combinada · Grátis'
                : (initial.entrega.nomeExibicao || 'Entrega')}
            </Text>
            <Text style={styles.orderDeliveryMeta}>
              {initial.entrega.tipo === 'retirada'
                ? 'O cliente combinará o horário pelo WhatsApp'
                : `${brl(initial.frete || initial.entrega.preco)} · prazo estimado de ${initial.entrega.prazoDias} ${
                    initial.entrega.prazoDias === 1 ? 'dia útil' : 'dias úteis'
                  }`}
            </Text>
            {initial.entrega.tipo !== 'retirada' && (
              <>
                <Text style={styles.orderDeliveryMeta}>
                  {initial.entrega.transportadora} · {initial.entrega.servico}
                </Text>
                <Text style={styles.orderDeliveryMeta}>
                  Transportadora {brl(initial.entrega.precoTransportadora || 0)}
                  {' · '}embalagem {brl(initial.entrega.taxaEmbalagem || 0)}
                  {Number(initial.entrega.valorAjuste || 0) > 0
                    ? ` · acréscimo ${initial.entrega.tipoAjuste === 'percentual'
                      ? `${initial.entrega.valorAjuste}%`
                      : brl(initial.entrega.valorAjuste || 0)}`
                    : ''}
                </Text>
              </>
            )}
          </View>
        </View>
      )}
      {pedidoRecebido && initial?.temSobEncomenda && (
        <View style={styles.orderDeliveryCard}>
          <View style={styles.orderDeliveryIcon}>
            <Feather name="clock" size={17} color={COLORS.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderDeliveryTitle}>Pedido com item sob encomenda</Text>
            <Text style={styles.orderDeliveryMeta}>
              Cliente confirmou prazo de até {initial.prazoEncomendaDias || 14} dias para produção e maturação, além do prazo da transportadora.
            </Text>
          </View>
        </View>
      )}
      {pedidoRecebido && initial?.pagamento && (
        <View style={styles.orderDeliveryCard}>
          <View style={styles.orderDeliveryIcon}>
            <Feather name="credit-card" size={17} color={COLORS.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderDeliveryTitle}>Pagamento</Text>
            <Text style={styles.orderDeliveryMeta}>
              {String(initial.pagamento.metodo || initial.formaPagamento || '').toUpperCase()}
              {' · '}{initial.pagamento.provedor || 'Confirmação manual'}
              {' · '}{PAYMENT_STATUS_LABELS[initial.pagamento.status] || initial.pagamento.status || 'Pendente'}
            </Text>
            {!!initial.pagamento.parcelas && initial.pagamento.parcelas > 1 && (
              <Text style={styles.orderDeliveryMeta}>{initial.pagamento.parcelas} parcelas</Text>
            )}
            {!!initial.pagamento.transactionNsu && (
              <Text style={styles.orderDeliveryMeta}>Transação: {initial.pagamento.transactionNsu}</Text>
            )}
            {!!initial.pagamento.historico?.length && (
              <Text style={styles.orderDeliveryMeta}>
                Última operação: {PAYMENT_OPERATION_COPY[
                  initial.pagamento.historico[initial.pagamento.historico.length - 1].operacao as PaymentOperation
                ]?.label || 'Pagamento confirmado'}
              </Text>
            )}
            {['pago', 'estorno_solicitado', 'contestado'].includes(initial.pagamento.status) && onPaymentOperation && (
              <Pressable
                onPress={() => onPaymentOperation(initial)}
                style={styles.paymentManageButton}
                testID="manage-payment"
              >
                <Feather name="shield" size={14} color={COLORS.gold} />
                <Text style={styles.paymentManageButtonText}>Gerenciar estorno ou contestação</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
      {pedidoRecebido && !pedidoRetirada && (
        <View style={{ marginBottom: SPACING.md }}>
          {f.endereco ? (
            <View style={styles.orderAddressCard}>
              <View style={styles.orderAddressIcon}>
                <Feather name="map-pin" size={17} color={COLORS.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderAddressEyebrow}>ENDEREÇO DE ENTREGA</Text>
                <Text style={styles.orderAddressTitle}>
                  {f.endereco.endereco}, {f.endereco.numero}
                  {f.endereco.complemento ? ` · ${f.endereco.complemento}` : ''}
                </Text>
                <Text style={styles.orderAddressMeta}>
                  {f.endereco.bairro} · {f.endereco.cidade}/{f.endereco.estado}
                </Text>
                <Text style={styles.orderAddressMeta}>
                  CEP {String(f.endereco.cep || '').replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2')}
                </Text>
                <Pressable onPress={() => setEditandoEndereco((value) => !value)} style={{ marginTop: 8 }} testID="pedido-editar-endereco">
                  <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.label }}>{editandoEndereco ? 'Fechar edição' : 'Editar endereço'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.orderAddressWarning}>
              <Feather name="alert-triangle" size={16} color={COLORS.rust} />
              <View style={{ flex: 1 }}>
                <Text style={styles.orderAddressWarningText}>Endereço de entrega não está gravado neste pedido.</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                  <Pressable onPress={recuperarEnderecoCliente} disabled={recuperandoEndereco} testID="pedido-recuperar-endereco">
                    <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.label }}>
                      {recuperandoEndereco ? 'Buscando…' : 'Buscar no cadastro do cliente'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => { setF((current) => ({ ...current, endereco: enderecoVazio() })); setEditandoEndereco(true); }} testID="pedido-adicionar-endereco">
                    <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.label }}>Adicionar manualmente</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {!!mensagemEndereco && (
            <Text style={{ color: mensagemEndereco.startsWith('Endereço recuperado') ? COLORS.sage : COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 6 }}>
              {mensagemEndereco}
            </Text>
          )}

          {editandoEndereco && f.endereco && (
            <View style={{ marginTop: SPACING.sm, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, backgroundColor: COLORS.surface }}>
              <Field label="CEP"><TInput keyboardType="numeric" value={f.endereco.cep || ''} onChangeText={(v) => setEndereco('cep', v)} /></Field>
              <Field label="Endereço"><TInput value={f.endereco.endereco || ''} onChangeText={(v) => setEndereco('endereco', v)} /></Field>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Field label="Número"><TInput value={f.endereco.numero || ''} onChangeText={(v) => setEndereco('numero', v)} /></Field></View>
                <View style={{ flex: 2 }}><Field label="Complemento"><TInput value={f.endereco.complemento || ''} onChangeText={(v) => setEndereco('complemento', v)} /></Field></View>
              </View>
              <Field label="Bairro"><TInput value={f.endereco.bairro || ''} onChangeText={(v) => setEndereco('bairro', v)} /></Field>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 3 }}><Field label="Cidade"><TInput value={f.endereco.cidade || ''} onChangeText={(v) => setEndereco('cidade', v)} /></Field></View>
                <View style={{ flex: 1 }}><Field label="UF"><TInput maxLength={2} autoCapitalize="characters" value={f.endereco.estado || ''} onChangeText={(v) => setEndereco('estado', v)} /></Field></View>
              </View>
              <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption }}>O endereço será gravado quando você tocar em “Salvar pedido”.</Text>
            </View>
          )}
        </View>
      )}
      <Field label="Status">
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {STATUS.filter((s) => statusPermitidosNoPainel(initial?.status).includes(s.id)).map((s) => (
            <Pressable key={s.id} onPress={() => set('status', s.id)} style={[styles.miniChip, f.status === s.id && { backgroundColor: s.color, borderColor: s.color }]}>
              <Text style={{ color: f.status === s.id ? COLORS.ink : COLORS.muted, fontSize: FONT_SIZES.caption }}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      {pedidoRecebido && initial?.pagamento?.metodo === 'pix' && initial.pagamento.provedor !== 'infinitepay' && f.status === 'pendente' && (
        <Pressable
          onPress={() => onSave(pedidoParaSalvar('pagamento_confirmado'))}
          style={styles.confirmPaymentButton}
          testID="confirm-manual-payment"
        >
          <Feather name="check-circle" size={17} color={COLORS.ink} />
          <View style={{ flex: 1 }}>
            <Text style={styles.confirmPaymentTitle}>Confirmar pagamento recebido</Text>
            <Text style={styles.confirmPaymentHint}>Use após conferir o Pix no PicPay</Text>
          </View>
        </Pressable>
      )}
      <Field label="Observações"><TInput value={f.observacoes} onChangeText={(v) => set('observacoes', v)} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} /></Field>
      <View style={styles.manualValueCard}>
        <View style={styles.manualValueHeading}>
          <View style={{ flex: 1 }}>
            <Text style={styles.manualValueEyebrow}>VALOR DO PEDIDO</Text>
            <Text style={styles.manualValueTitle}>Valor final combinado</Text>
          </View>
          {valorPersonalizado && (
            <Pressable
              onPress={() => {
                setValorPersonalizado(false);
                setValorFinalInput('');
              }}
              hitSlop={8}
              testID="pedido-restaurar-valor"
            >
              <Text style={styles.manualValueReset}>Usar valor calculado</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.manualValueHint}>
          Informe aqui o total negociado com o cliente, inclusive quando houver desconto.
        </Text>
        <View style={styles.manualValueInputRow}>
          <Text style={styles.manualValueCurrency}>R$</Text>
          <TInput
            keyboardType="decimal-pad"
            value={valorPersonalizado ? valorFinalInput : totalCalculado.toFixed(2).replace('.', ',')}
            onChangeText={(value) => {
              setValorFinalInput(value);
              setValorPersonalizado(true);
            }}
            placeholder="0,00"
            style={styles.manualValueInput}
            testID="pedido-valor-final"
          />
        </View>
        <View style={styles.manualValueSummary}>
          <Text style={styles.manualValueSummaryLabel}>Valor calculado</Text>
          <Text style={styles.manualValueSummaryValue}>{brl(totalCalculado)}</Text>
        </View>
        {valorPersonalizado && valorDigitadoValido && Math.abs(ajusteManual) >= 0.01 && (
          <View style={styles.manualValueSummary}>
            <Text style={[styles.manualValueSummaryLabel, { color: ajusteManual < 0 ? COLORS.sage : COLORS.rust }]}>
              {ajusteManual < 0 ? 'Desconto aplicado' : 'Acréscimo aplicado'}
            </Text>
            <Text style={[styles.manualValueSummaryValue, { color: ajusteManual < 0 ? COLORS.sage : COLORS.rust }]}>
              {brl(Math.abs(ajusteManual))}
            </Text>
          </View>
        )}
        {valorPersonalizado && !valorDigitadoValido && (
          <Text style={styles.manualValueError}>Informe um valor final válido.</Text>
        )}
        <View style={styles.manualValueTotal}>
          <Text style={styles.manualValueTotalLabel}>Total final</Text>
          <Text style={styles.manualValueTotalAmount}>{brl(total)}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton
          label="Salvar pedido"
          onPress={() => f.cliente.trim() && f.itens.length > 0 && onSave(pedidoParaSalvar())}
          disabled={!f.cliente.trim() || f.itens.length === 0 || (valorPersonalizado && !valorDigitadoValido)}
          testID="pedido-save"
        />
      </View>
      {pedidoRecebido && (
        <Pressable
          onPress={() => initial && onGenerateLabels?.(initial)}
          style={styles.cancelAdminOrderButton}
          testID="pedido-gerar-etiquetas"
        >
          <Feather name="tag" size={16} color={COLORS.gold} />
          <Text style={[styles.cancelAdminOrderText, { color: COLORS.gold }]}>Gerar etiquetas de produção (PDF)</Text>
        </Pressable>
      )}
      {pedidoRecebido && initial?.status !== 'cancelado' && (
        <Pressable
          onPress={() => onSave(pedidoParaSalvar('cancelado'))}
          style={styles.cancelAdminOrderButton}
          testID="pedido-cancelar"
        >
          <Feather name="x-circle" size={16} color={COLORS.rust} />
          <Text style={styles.cancelAdminOrderText}>Cancelar pedido</Text>
        </Pressable>
      )}
      {pedidoRecebido && (initial?.status === 'cancelado' || initial?.status === 'entregue') && (
        <Pressable
          onPress={() => onDelete?.(initial)}
          style={styles.deleteAdminOrderButton}
          testID="pedido-arquivar"
        >
          <Feather name="archive" size={16} color={COLORS.inverse} />
          <View style={{ flex: 1 }}>
            <Text style={styles.deleteAdminOrderTitle}>Arquivar pedido</Text>
            <Text style={styles.deleteAdminOrderHint}>Retira do fluxo ativo e preserva todo o histórico.</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
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
  const [tab, setTab] = useState('dashboard');
  const [systemView, setSystemView] = useState<'main' | 'historico' | 'arquivados' | 'privacidade' | 'fornecedores' | 'custos' | 'insumos'>('main');
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
  const [metricPeriod, setMetricPeriod] = useState<'7d' | '30d' | 'mes' | 'todos'>('30d');
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
  const [orderView, setOrderView] = useState<'kanban' | 'lista'>('kanban');
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

  const pedidosFiltrados = useMemo(() => {
    const termo = orderSearch.trim().toLocaleLowerCase('pt-BR');
    const ordenados = [...pedidosUnificados].sort(
      (a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime(),
    );
    if (!termo) return ordenados;
    return ordenados.filter((pedido) => {
      const nomesItens = (pedido.itens || [])
        .map((item) => perfumes.find((perfume) => perfume.id === item.perfumeId)?.nome || item.perfumeNome || '')
        .join(' ');
      return [
        pedido.cliente,
        pedido.contato,
        pedido.observacoes,
        String(pedido.seq),
        nomesItens,
      ].some((valor) => valor.toLocaleLowerCase('pt-BR').includes(termo));
    });
  }, [orderSearch, pedidosUnificados, perfumes]);

  const resumoDe = (id: string) => estoqueResumo[id] || {
    saldoAtualMl: 0,
    reservadoMl: 0,
    disponivelMl: 0,
  };
  const disponivelDe = (id: string) => resumoDe(id).disponivelMl;
  const estoqueBaixo = perfumes.filter((p) => disponivelDe(p.id) <= (p.estoqueMinimoMl || 0)).length;
  const totaisEstoque = perfumes.reduce((totais, perfume) => {
    const resumo = resumoDe(perfume.id);
    totais.saldo += resumo.saldoAtualMl;
    totais.reservado += resumo.reservadoMl;
    totais.disponivel += resumo.disponivelMl;
    return totais;
  }, { saldo: 0, reservado: 0, disponivel: 0 });
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

  const perfumesFiltrados = perfumes.filter((p) => p.nome.toLowerCase().includes(search.toLowerCase()));
  const perfumesEstoqueFiltrados = useMemo(() => {
    const termo = stockSearch.trim().toLocaleLowerCase('pt-BR');
    if (!termo) return perfumes;
    const termoSemZeros = termo.replace(/^0+/, '');
    return perfumes.filter((perfume) => (
      perfume.nome.toLocaleLowerCase('pt-BR').includes(termo)
      || String(perfume.seq).includes(termoSemZeros)
      || padSeq(perfume.seq).includes(termo)
    ));
  }, [perfumes, stockSearch]);

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
        <View style={{ padding: SPACING.lg }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: SPACING.lg }}>
            <View style={{ width: '48%' }}><StatCard label="Contratipos" value={perfumes.length} icon="droplet" /></View>
            <View style={{ width: '48%' }}><StatCard label="Estoque baixo" value={estoqueBaixo} icon="alert-triangle" /></View>
            <View style={{ width: '48%' }}><StatCard label="Aguardando pagamento" value={pendentes} icon="clipboard" /></View>
            <View style={{ width: '48%' }}><StatCard label="Nota média" value={notaMedia} icon="star" /></View>
          </View>
          {metricas && (
            <View style={styles.metricsPanel}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm, flexWrap: 'wrap' }}>
                <Text style={styles.sectionLabel}>VISÃO DO NEGÓCIO</Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {([['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Este mês'], ['todos', 'Tudo']] as const).map(([id, label]) => (
                    <Pressable key={id} onPress={() => void changeMetricPeriod(id)} style={[styles.miniChip, metricPeriod === id && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}>
                      <Text style={{ color: metricPeriod === id ? COLORS.ink : COLORS.muted, fontSize: FONT_SIZES.caption }}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.metricsRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.metricLabel}>Receita confirmada</Text>
                  <Text style={styles.metricValue}>{brl(metricas.receitaConfirmada)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.metricLabel}>Lucro estimado</Text>
                  <Text style={[styles.metricValue, { color: metricas.lucroEstimado >= 0 ? COLORS.sage : COLORS.rust }]}>{brl(metricas.lucroEstimado)}</Text>
                </View>
              </View>
              <View style={[styles.metricsRow, { marginTop: SPACING.md }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.metricLabel}>Ticket médio</Text>
                  <Text style={styles.metricValue}>{brl(metricas.ticketMedio)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.metricLabel}>Margem estimada</Text>
                  <Text style={styles.metricValue}>{metricas.margemEstimada.toFixed(1)}%</Text>
                </View>
              </View>
              <View style={[styles.metricsRow, { marginTop: SPACING.md }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.metricLabel}>A receber</Text>
                  <Text style={styles.metricValue}>{brl(metricas.aReceber)}</Text>
                  <Text style={styles.metricSubtle}>{metricas.pedidosPendentes} pendente(s)</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.metricLabel}>Volume vendido</Text>
                  <Text style={styles.metricValue}>{metricas.mlVendidos.toLocaleString('pt-BR')} ml</Text>
                  <Text style={styles.metricSubtle}>{metricas.pedidosPagos} pedido(s) pago(s)</Text>
                </View>
              </View>
              {(metricas.receitaEmRisco > 0 || metricas.valorEstornado > 0 || metricas.valorChargeback > 0) && (
                <View style={styles.financialAttentionCard}>
                  <Feather name="alert-circle" size={17} color={COLORS.rust} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.financialAttentionTitle}>Atenção financeira</Text>
                    <Text style={styles.financialAttentionText}>
                      Em análise {brl(metricas.receitaEmRisco)} · estornado {brl(metricas.valorEstornado)} · chargeback {brl(metricas.valorChargeback)}
                    </Text>
                  </View>
                </View>
              )}
              {metricas.serieDiaria?.length > 0 && (() => {
                const dias = metricas.serieDiaria.slice(-14);
                const maxReceita = Math.max(1, ...dias.map((dia) => dia.receita));
                return (
                  <>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.lg }}>
                      <Text style={styles.metricLabel}>RECEITA DIÁRIA</Text>
                      {!!metricas.tamanhoMaisVendido && (
                        <Text style={styles.metricSubtle}>Tamanho líder: {metricas.tamanhoMaisVendido.ml}ml · {metricas.tamanhoMaisVendido.quantidade} un.</Text>
                      )}
                    </View>
                    <View style={styles.metricChart}>
                      {dias.map((dia, index) => (
                        <View key={dia.data} style={styles.metricChartColumn}>
                          <View style={[styles.metricChartBar, { height: Math.max(3, Math.round((dia.receita / maxReceita) * 72)) }]} />
                          {(index === 0 || index === dias.length - 1) && (
                            <Text style={styles.metricChartLabel}>{dia.data.slice(5).replace('-', '/')}</Text>
                          )}
                        </View>
                      ))}
                    </View>
                  </>
                );
              })()}
              {metricas.maisVendidos.length > 0 && (
                <>
                  <Text style={[styles.metricLabel, { marginTop: SPACING.lg }]}>MAIS VENDIDOS · POR VOLUME</Text>
                  {metricas.maisVendidos.slice(0, 5).map((item, index) => (
                    <View key={`${item.perfumeId}-${index}`} style={styles.rankingRow}>
                      <Text style={styles.rankingNumber}>{index + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rankingName} numberOfLines={1}>{item.nome}</Text>
                        <Text style={styles.metricSubtle}>{item.ml.toLocaleString('pt-BR')} ml · {brl(item.faturamento)}</Text>
                      </View>
                      <Text style={styles.rankingQty}>{item.quantidade} un.</Text>
                    </View>
                  ))}
                </>
              )}
              {metricas.maisLucrativos?.length > 0 && (
                <>
                  <Text style={[styles.metricLabel, { marginTop: SPACING.lg }]}>MAIOR LUCRO ESTIMADO</Text>
                  {metricas.maisLucrativos.slice(0, 3).map((item, index) => (
                    <View key={`lucro-${item.perfumeId}-${index}`} style={styles.rankingRow}>
                      <Text style={styles.rankingNumber}>{index + 1}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rankingName} numberOfLines={1}>{item.nome}</Text>
                        <Text style={styles.metricSubtle}>{brl(item.faturamento)} em vendas</Text>
                      </View>
                      <Text style={[styles.rankingQty, { color: item.lucroEstimado >= 0 ? COLORS.sage : COLORS.rust }]}>{brl(item.lucroEstimado)}</Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          )}
          <Text style={styles.sectionLabel}>ÚLTIMOS PEDIDOS</Text>
          {pedidosUnificados.length === 0 && <EmptyState text="Nenhum pedido recebido ainda." />}
          {[...pedidosUnificados].sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime()).slice(0, 5).map((p) => {
            const st = STATUS.find((s) => s.id === p.status) || STATUS[0];
            return (
              <Pressable key={`${p.fonte}-${p.id}`} onPress={() => abrirPedido(p)} style={styles.rowCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption }}>Nº {padSeq(p.seq)}</Text>
                    <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodyLarge, fontWeight: '500' }}>{p.cliente}</Text>
                  </View>
                  <View style={[styles.pill, { borderColor: st.color }]}><Text style={{ color: st.color, fontSize: FONT_SIZES.caption }}>{st.label}</Text></View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.label }}>{(p.itens || []).length} item(ns) · {fmtDate(p.criadoEm)}</Text>
                  <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodySmall }}>{brl(p.total)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      );
    }

    if (tab === 'catalogo') {
      return (
        <View style={{ padding: SPACING.lg }}>
          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={COLORS.muted} />
            <TextInput value={search} onChangeText={setSearch} placeholder="Buscar" placeholderTextColor={COLORS.muted + 'BB'} style={styles.searchInput} testID="catalogo-search" />
          </View>
          {perfumesFiltrados.length === 0 && <EmptyState text="Nenhum contratipo. Toque em + para começar." />}
          {perfumesFiltrados.map((p) => {
            const resumo = resumoDe(p.id);
            const baixo = resumo.disponivelMl <= (p.estoqueMinimoMl || 0);
            return (
              <View key={p.id} style={styles.perfumeCard} testID={`perfume-card-${p.id}`}>
                {p.imagemUrl ? (
                  <Image source={{ uri: p.imagemUrl }} style={styles.catalogThumb} contentFit="cover" transition={150} />
                ) : (
                  <View style={styles.catalogThumbPlaceholder}><Feather name="image" size={20} color={COLORS.muted} /></View>
                )}
                <View style={{ flex: 1, padding: SPACING.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption }}>Nº {padSeq(p.seq)}</Text>
                      <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodyLarge, fontWeight: '500' }}>{p.nome}</Text>
                      <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption }}>
                        {(p.ocasioes || []).length ? (p.ocasioes || []).join(' · ') : 'Clima & ocasião não informados'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Pressable onPress={() => setSheet({ type: 'perfume', data: p })} hitSlop={8} testID={`edit-${p.id}`} accessibilityLabel={`Editar ${p.nome}`}><Feather name="edit-2" size={16} color={COLORS.muted} /></Pressable>
                      <Pressable onPress={() => setSheet({ type: 'confirm', label: `Arquivar "${p.nome}"? Ele sairá da vitrine, mas o histórico será preservado.`, onConfirm: () => doDeletePerfume(p.id), danger: true, confirmLabel: 'Arquivar perfume', safetyText: 'O perfume poderá ser restaurado e seus pedidos e movimentos de estoque não serão apagados.' })} hitSlop={8} testID={`archive-${p.id}`} accessibilityLabel={`Arquivar ${p.nome}`}><Feather name="archive" size={16} color={COLORS.muted} /></Pressable>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    <View style={styles.tag}><Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption }}>{familiasDoPerfume(p).join(' · ')}</Text></View>
                    <View style={styles.tag}><Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption }}>{nomeConcentracao(p.concentracao)}</Text></View>
                    <View style={styles.tag}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.prontaEntrega ? COLORS.sage : COLORS.gold }} />
                        <Text style={{ color: p.prontaEntrega ? COLORS.sage : COLORS.gold, fontSize: FONT_SIZES.caption }}>
                          {p.prontaEntrega ? 'Pronta entrega' : 'Sob encomenda'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                    {p.precos.map((pr, i) => (
                      <Text key={i} style={{ color: COLORS.bone, fontSize: FONT_SIZES.caption }}>{pr.ml}ml · {brl(pr.preco)}</Text>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                    {baixo && <Feather name="alert-triangle" size={11} color={COLORS.rust} />}
                    <Text style={{ color: baixo ? COLORS.rust : COLORS.sage, fontSize: FONT_SIZES.caption }}>
                      {resumo.disponivelMl}ml disponíveis
                      {resumo.reservadoMl > 0 ? ` · ${resumo.reservadoMl}ml reservados` : ''}
                      {baixo ? ' · baixo' : ''}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      );
    }

    if (tab === 'estoque') {
      return (
        <View style={{ padding: SPACING.lg }}>
          <View style={styles.stockSummary}>
            <Text style={styles.sectionLabel}>RESUMO DO ESTOQUE</Text>
            <View style={styles.stockSummaryGrid}>
              <View style={styles.stockSummaryItem}>
                <Text style={styles.stockSummaryValue}>{totaisEstoque.saldo.toLocaleString('pt-BR')}ml</Text>
                <Text style={styles.stockSummaryLabel}>Saldo físico</Text>
              </View>
              <View style={styles.stockSummaryItem}>
                <Text style={styles.stockSummaryValue}>{totaisEstoque.reservado.toLocaleString('pt-BR')}ml</Text>
                <Text style={styles.stockSummaryLabel}>Reservado</Text>
              </View>
              <View style={styles.stockSummaryItem}>
                <Text style={[styles.stockSummaryValue, totaisEstoque.disponivel < 0 && { color: COLORS.rust }]}>
                  {totaisEstoque.disponivel.toLocaleString('pt-BR')}ml
                </Text>
                <Text style={styles.stockSummaryLabel}>Disponível</Text>
              </View>
            </View>
            <Text style={styles.stockSummaryHint}>
              Pedidos pendentes ou com pagamento confirmado ficam reservados. A baixa ocorre quando o pedido entra em preparação.
            </Text>
          </View>
          <View style={styles.searchBox}>
            <Feather name="search" size={16} color={COLORS.muted} />
            <TextInput
              value={stockSearch}
              onChangeText={setStockSearch}
              placeholder="Buscar perfume ou nÃºmero"
              placeholderTextColor={COLORS.muted + 'BB'}
              style={styles.searchInput}
              testID="estoque-search"
            />
          </View>
          {perfumes.length === 0 && <EmptyState text="Cadastre um contratipo antes." />}
          {perfumes.length > 0 && perfumesEstoqueFiltrados.length === 0 && <EmptyState text="Nenhum perfume encontrado no estoque." />}
          {perfumesEstoqueFiltrados.map((p) => {
            const resumo = resumoDe(p.id);
            const baixo = resumo.disponivelMl <= (p.estoqueMinimoMl || 0);
            const precisaRepor = Math.max(0, -resumo.disponivelMl);
            return (
              <View key={p.id} style={styles.rowCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption }}>Nº{padSeq(p.seq)}</Text>
                    <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.body, fontWeight: '500' }}>{p.nome}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: baixo ? COLORS.rust : COLORS.sage, fontSize: FONT_SIZES.bodyLarge }}>{resumo.disponivelMl}ml</Text>
                    <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption }}>disponíveis</Text>
                  </View>
                </View>
                <View style={styles.stockBreakdown}>
                  <Text style={styles.stockBreakdownText}>Físico: {resumo.saldoAtualMl}ml</Text>
                  <Text style={styles.stockBreakdownText}>Reservado: {resumo.reservadoMl}ml</Text>
                </View>
                {baixo && (
                  <View style={styles.stockAlertRow}>
                    <Feather name="alert-triangle" size={12} color={COLORS.rust} />
                    <Text style={styles.stockAlertText}>
                      {precisaRepor > 0 ? `Repor ao menos ${precisaRepor}ml para atender as reservas.` : `Abaixo do alerta de ${p.estoqueMinimoMl || 0}ml.`}
                    </Text>
                  </View>
                )}
                <Pressable onPress={() => setSheet({ type: 'stock-count', data: p })} style={styles.stockCountButton}>
                  <Feather name="check-square" size={14} color={COLORS.gold} />
                  <Text style={styles.stockCountButtonText}>Conferir quantidade física</Text>
                </Pressable>
              </View>
            );
          })}
          {perfumes.length > 0 && <Text style={[styles.sectionLabel, { marginTop: SPACING.lg }]}>ÚLTIMOS LANÇAMENTOS</Text>}
          {perfumes.length > 0 && movimentos.length === 0 && <EmptyState text="Nenhum lançamento ainda." />}
          {[...movimentos].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()).slice(0, 15).map((m) => {
            const p = perfumes.find((pf) => pf.id === m.perfumeId);
            return (
              <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
                <Feather name={m.tipo === 'entrada' ? 'arrow-up-circle' : 'arrow-down-circle'} size={18} color={m.tipo === 'entrada' ? COLORS.sage : COLORS.rust} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodySmall }}>{p?.nome || 'Perfume removido'}</Text>
                  <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption }}>{m.motivo || (m.tipo === 'entrada' ? 'Entrada' : 'Saída')} · {fmtDate(m.data)}</Text>
                </View>
                <Text style={{ color: m.tipo === 'entrada' ? COLORS.sage : COLORS.rust, fontSize: FONT_SIZES.bodySmall }}>{m.tipo === 'entrada' ? '+' : '-'}{m.quantidadeMl}ml</Text>
              </View>
            );
          })}
        </View>
      );
    }

    if (tab === 'pedidos') {
      return (
        <View style={{ padding: SPACING.lg }}>
          <View style={styles.orderToolbar}>
            <View style={styles.orderViewToggle}>
              {([
                { id: 'kanban', label: 'Etapas', icon: 'columns' },
                { id: 'lista', label: 'Lista', icon: 'list' },
              ] as const).map((view) => {
                const active = orderView === view.id;
                return (
                  <Pressable
                    key={view.id}
                    onPress={() => setOrderView(view.id)}
                    style={[styles.orderViewButton, active && styles.orderViewButtonActive]}
                    accessibilityRole="button"
                    testID={`orders-view-${view.id}`}
                  >
                    <Feather name={view.icon} size={13} color={active ? COLORS.ink : COLORS.muted} />
                    <Text style={[styles.orderViewText, active && { color: COLORS.ink }]}>{view.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.orderSearchBox}>
              <Feather name="search" size={14} color={COLORS.muted} />
              <TextInput
                value={orderSearch}
                onChangeText={setOrderSearch}
                placeholder="Buscar pedido, cliente ou contato"
                placeholderTextColor={COLORS.muted}
                style={styles.orderSearchInput}
                testID="orders-search"
              />
              {!!orderSearch && (
                <Pressable onPress={() => setOrderSearch('')} hitSlop={8} accessibilityLabel="Limpar busca de pedidos">
                  <Feather name="x" size={14} color={COLORS.muted} />
                </Pressable>
              )}
            </View>
          </View>

          {pedidosFiltrados.length === 0 && (
            <EmptyState text={orderSearch ? 'Nenhum pedido encontrado para esta busca.' : 'Nenhum pedido recebido ainda.'} />
          )}

          {pedidosFiltrados.length > 0 && orderView === 'kanban' && (
            <>
              <View style={styles.kanbanHint}>
                <Feather name="move" size={14} color={COLORS.gold} />
                <Text style={styles.kanbanHintText}>Arraste o cartão para os lados ou use as setas para mudar a etapa.</Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled
                contentContainerStyle={styles.kanbanBoard}
              >
                {KANBAN_FLOW.map((statusId) => {
                  const status = STATUS.find((item) => item.id === statusId) || STATUS[0];
                  const pedidosDaEtapa = pedidosFiltrados.filter((pedido) => pedido.status === statusId);
                  return (
                    <View key={statusId} style={[styles.kanbanColumn, { width: kanbanColumnWidth }]}>
                      <View style={styles.kanbanColumnHeader}>
                        <View style={styles.kanbanColumnTitleRow}>
                          <View style={[styles.kanbanStatusDot, { backgroundColor: status.color }]} />
                          <Text style={styles.kanbanColumnTitle}>{status.label}</Text>
                        </View>
                        <View style={styles.kanbanCount}>
                          <Text style={styles.kanbanCountText}>{pedidosDaEtapa.length}</Text>
                        </View>
                      </View>
                      {pedidosDaEtapa.length === 0 ? (
                        <View style={styles.kanbanEmpty}>
                          <Text style={styles.kanbanEmptyText}>Nenhum pedido nesta etapa</Text>
                        </View>
                      ) : pedidosDaEtapa.map((pedido) => (
                        <KanbanPedidoCard
                          key={`${pedido.fonte}-${pedido.id}`}
                          pedido={pedido}
                          onOpen={() => abrirPedido(pedido)}
                          onMove={(novoStatus) => moverPedido(pedido, novoStatus)}
                          moving={movingOrderId === pedido.id}
                        />
                      ))}
                    </View>
                  );
                })}
              </ScrollView>
              {pedidosFiltrados.some((pedido) => pedido.status === 'cancelado') && (
                <View style={styles.cancelledOrders}>
                  <Text style={styles.sectionLabel}>CANCELADOS</Text>
                  {pedidosFiltrados.filter((pedido) => pedido.status === 'cancelado').map((pedido) => (
                    <Pressable
                      key={`${pedido.fonte}-${pedido.id}`}
                      onPress={() => abrirPedido(pedido)}
                      style={styles.cancelledOrderCard}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.kanbanOrderNumber}>Nº {padSeq(pedido.seq)}</Text>
                        <Text style={styles.cancelledOrderCustomer}>{pedido.cliente}</Text>
                      </View>
                      <Text style={styles.kanbanOrderDate}>{fmtDate(pedido.criadoEm)}</Text>
                      <Feather name="chevron-right" size={15} color={COLORS.muted} />
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}

          {pedidosFiltrados.length > 0 && orderView === 'lista' && (
            <>
              <View style={styles.swipeOrderHint}>
                <Feather name="chevrons-left" size={15} color={COLORS.gold} />
                <Text style={styles.swipeOrderHintText}>Deslize um pedido para a esquerda para editar; pedidos concluídos ou cancelados também podem ser arquivados.</Text>
              </View>
              {pedidosFiltrados.map((p) => {
                const st = STATUS.find((s) => s.id === p.status) || STATUS[0];
                return (
                  <SwipeablePedidoCard
                    key={`${p.fonte}-${p.id}`}
                    onEdit={() => abrirPedido(p)}
                    onDelete={(['cancelado', 'entregue'] as OrderStatus[]).includes(p.status) ? () => setSheet({
                      type: 'confirm',
                      label: `Arquivar pedido de ${p.cliente}? O histórico será preservado.`,
                      onConfirm: () => p.compraLegada ? doDelCompra(p.compraLegada.id) : doDelPedido(p.id),
                      confirmLabel: 'Arquivar pedido',
                    }) : undefined}
                    testID={`pedido-${p.id}`}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <View><Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption }}>Nº {padSeq(p.seq)}</Text><Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodyLarge, fontWeight: '500' }}>{p.cliente}</Text></View>
                      <View style={[styles.pill, { borderColor: st.color }]}><Text style={{ color: st.color, fontSize: FONT_SIZES.caption }}>{st.label}</Text></View>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.label }}>{(p.itens || []).length} item(ns) · {fmtDate(p.criadoEm)}</Text>
                      <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodySmall }}>{brl(p.total)}</Text>
                    </View>
                  </SwipeablePedidoCard>
                );
              })}
            </>
          )}
        </View>
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
                  {freteConfig?.integrado ? 'Conectado' : 'Aguardando conexão'}
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

          <SystemCard icon="database" title="Base de dados" subtitle="Backup e limpezas protegidas por confirmação de senha.">
            <SystemAction icon="download" title="Exportar backup criptografado" subtitle="Baixe uma cópia protegida e compactada dos dados atuais." onPress={doBackup} />
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
              icon="upload"
              title="Restaurar backup"
              subtitle="Valide e restaure um arquivo .lfe anterior com transação segura."
              onPress={chooseAndRestoreBackup}
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
            {renderContent()}
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
  statCard: { padding: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg },
  statValue: { color: COLORS.bone, fontSize: FONT_SIZES.display, fontWeight: '500', marginTop: 6 },
  statLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  metricsPanel: { padding: SPACING.md, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.lg },
  metricsRow: { flexDirection: 'row', gap: 12 },
  metricLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, letterSpacing: 0.6 },
  metricValue: { color: COLORS.bone, fontSize: FONT_SIZES.heading, fontWeight: '600', marginTop: 3 },
  metricSubtle: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  metricChart: { height: 96, flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: SPACING.sm, paddingTop: SPACING.xs, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  metricChartColumn: { flex: 1, minWidth: 4, height: 92, justifyContent: 'flex-end', alignItems: 'center' },
  metricChartBar: { width: '72%', minWidth: 3, maxWidth: 18, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: COLORS.gold },
  metricChartLabel: { color: COLORS.muted, fontSize: FONT_SIZES.micro, marginTop: 3, position: 'absolute', bottom: -13, width: 42, textAlign: 'center' },
  rankingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rankingNumber: { color: COLORS.gold, width: 22, fontSize: FONT_SIZES.label, fontWeight: '700' },
  rankingName: { color: COLORS.bone, flex: 1, fontSize: FONT_SIZES.label },
  rankingQty: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
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
  operationWarning: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 9, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.rust, backgroundColor: COLORS.surface, marginBottom: 4 },
  operationWarningText: { flex: 1, color: COLORS.rust, fontSize: FONT_SIZES.caption, lineHeight: 15 },
  supplierActive: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 4, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.gold + '44' },
  supplierName: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '700' },
  supplierMeta: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  connectedPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.sage + '88' },
  connectedPillText: { color: COLORS.sage, fontSize: FONT_SIZES.caption, fontWeight: '700', letterSpacing: 0.6 },
  orderDeliveryCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, marginBottom: SPACING.sm },
  orderDeliveryIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  orderDeliveryTitle: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '600' },
  orderDeliveryMeta: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 3 },
  orderAddressCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.gold + '66', borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceRaised, marginBottom: SPACING.md },
  orderAddressIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  orderAddressEyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 },
  orderAddressTitle: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '600', lineHeight: 20 },
  orderAddressMeta: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 3, lineHeight: 16 },
  orderAddressWarning: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.rust + '66', borderRadius: RADIUS.md, backgroundColor: COLORS.surface, marginBottom: SPACING.md },
  orderAddressWarningText: { flex: 1, color: COLORS.rust, fontSize: FONT_SIZES.caption, lineHeight: 16 },
  manualValueCard: { padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.gold + '88', backgroundColor: COLORS.surfaceRaised },
  manualValueHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 5 },
  manualValueEyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '700', letterSpacing: 1.2 },
  manualValueTitle: { color: COLORS.bone, fontSize: FONT_SIZES.subtitle, fontWeight: '700', marginTop: 2 },
  manualValueReset: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600', textDecorationLine: 'underline' },
  manualValueHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15, marginBottom: 10 },
  manualValueInputRow: { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, overflow: 'hidden' },
  manualValueCurrency: { color: COLORS.gold, fontSize: FONT_SIZES.bodyLarge, fontWeight: '700', paddingLeft: 12 },
  manualValueInput: { flex: 1, borderWidth: 0, backgroundColor: 'transparent', color: COLORS.bone, fontSize: FONT_SIZES.heading, fontWeight: '700' },
  manualValueSummary: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 8 },
  manualValueSummaryLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  manualValueSummaryValue: { color: COLORS.muted, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  manualValueError: { color: COLORS.rust, fontSize: FONT_SIZES.caption, marginTop: 7 },
  manualValueTotal: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, paddingTop: 9, marginTop: 9, borderTopWidth: 1, borderTopColor: COLORS.border },
  manualValueTotalLabel: { color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '600' },
  manualValueTotalAmount: { color: COLORS.gold, fontSize: FONT_SIZES.heading, fontWeight: '800' },
  sectionLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginBottom: SPACING.sm, letterSpacing: 1 },
  rowCard: { padding: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.sm },
  stockSummary: { padding: SPACING.md, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.md },
  stockSummaryGrid: { flexDirection: 'row', gap: 8 },
  stockSummaryItem: { flex: 1, padding: 10, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  stockSummaryValue: { color: COLORS.gold, fontSize: FONT_SIZES.bodyLarge, fontWeight: '600' },
  stockSummaryLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 3 },
  stockSummaryHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15, marginTop: SPACING.sm },
  stockBreakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  stockBreakdownText: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  stockAlertRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7 },
  stockAlertText: { color: COLORS.rust, fontSize: FONT_SIZES.caption, flex: 1 },
  stockCountButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 9, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.gold + '66', backgroundColor: COLORS.surfaceRaised },
  stockCountButtonText: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  swipeOrderHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACING.sm, paddingHorizontal: 2 },
  swipeOrderHintText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, flex: 1 },
  ordersManagement: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceRaised },
  ordersManagementTitle: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.1, marginBottom: 3 },
  ordersManagementText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15 },
  resetOrdersButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 11, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.rust + '88', backgroundColor: COLORS.surface },
  resetOrdersText: { color: COLORS.rust, fontSize: FONT_SIZES.caption, fontWeight: '700' },
  orderToolbar: { marginBottom: SPACING.md, gap: SPACING.sm },
  orderViewToggle: { flexDirection: 'row', alignSelf: 'flex-start', padding: 3, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  orderViewButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 13, borderRadius: RADIUS.pill },
  orderViewButtonActive: { backgroundColor: COLORS.gold },
  orderViewText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  orderSearchBox: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44, paddingHorizontal: 13, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  orderSearchInput: { flex: 1, color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, paddingVertical: 11 },
  kanbanHint: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: SPACING.sm, paddingHorizontal: 2 },
  kanbanHintText: { flex: 1, color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15 },
  kanbanBoard: { gap: SPACING.sm, paddingBottom: SPACING.sm, paddingRight: SPACING.lg },
  kanbanColumn: { padding: 10, alignSelf: 'flex-start', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceRaised },
  kanbanColumnHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 2 },
  kanbanColumnTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  kanbanStatusDot: { width: 8, height: 8, borderRadius: 4 },
  kanbanColumnTitle: { color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '700', letterSpacing: 0.2 },
  kanbanCount: { minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  kanbanCountText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, fontWeight: '700' },
  kanbanEmpty: { minHeight: 98, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border, backgroundColor: COLORS.surface },
  kanbanEmptyText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, textAlign: 'center' },
  kanbanOrderNumber: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 0.6, fontWeight: '700' },
  kanbanOrderDate: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  cancelledOrders: { marginTop: SPACING.lg },
  cancelledOrderCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, marginBottom: 7, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.rust + '55', backgroundColor: COLORS.surface },
  cancelledOrderCustomer: { color: COLORS.muted, fontSize: FONT_SIZES.label, marginTop: 3 },
  perfumeCard: { flexDirection: 'row', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.sm, overflow: 'hidden' },
  catalogThumb: { width: 84, minHeight: 126, backgroundColor: COLORS.surface },
  catalogThumbPlaceholder: { width: 84, minHeight: 126, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  orderChoiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: SPACING.md, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border },
  orderChoiceLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, letterSpacing: 0.8, marginBottom: 3 },
  orderChoiceValue: { color: COLORS.gold, fontSize: FONT_SIZES.bodyLarge, fontWeight: '600' },
  orderQuantity: { minWidth: 76, alignItems: 'center', paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: COLORS.border },
  orderQuantityValue: { color: COLORS.bone, fontSize: FONT_SIZES.subtitle, fontWeight: '600' },
  confirmPaymentButton: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.gold },
  confirmPaymentTitle: { color: COLORS.ink, fontSize: FONT_SIZES.bodySmall, fontWeight: '700' },
  confirmPaymentHint: { color: COLORS.ink, opacity: 0.72, fontSize: FONT_SIZES.caption, marginTop: 2 },
  paymentManageButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9, paddingHorizontal: 10, minHeight: 34, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceRaised },
  paymentManageButtonText: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '700' },
  paymentProviderNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.gold, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceRaised },
  paymentProviderNoticeText: { flex: 1, color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, lineHeight: 20 },
  paymentOperationStatus: { color: COLORS.muted, fontSize: FONT_SIZES.label, marginBottom: SPACING.sm },
  paymentOperationChoice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  paymentOperationChoiceActive: { borderColor: COLORS.gold, backgroundColor: COLORS.surfaceRaised },
  paymentOperationChoiceTitle: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '700' },
  paymentOperationChoiceHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  paymentOperationEmpty: { color: COLORS.muted, fontSize: FONT_SIZES.bodySmall, paddingVertical: SPACING.md },
  financialAttentionCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.rust, backgroundColor: COLORS.surfaceRaised },
  financialAttentionTitle: { color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '700' },
  financialAttentionText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  cancelAdminOrderButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.rust + '80' },
  cancelAdminOrderText: { color: COLORS.rust, fontSize: FONT_SIZES.label, fontWeight: '700' },
  deleteAdminOrderButton: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, marginTop: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.rust },
  deleteAdminOrderTitle: { color: COLORS.inverse, fontSize: FONT_SIZES.label, fontWeight: '700' },
  deleteAdminOrderHint: { color: COLORS.inverse, opacity: 0.78, fontSize: FONT_SIZES.caption, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, backgroundColor: COLORS.surface },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  miniChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, flexShrink: 0 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, marginBottom: SPACING.sm },
  searchInput: { flex: 1, color: COLORS.bone, paddingVertical: 10, fontSize: FONT_SIZES.body },
  actionBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm, alignItems: 'center' },
  fab: { position: 'absolute', right: 20, bottom: 86, width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8 },
  tabbar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', paddingBottom: 16, paddingTop: 8, backgroundColor: COLORS.surfaceRaised, borderTopWidth: 1, borderTopColor: COLORS.border },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 4 },
});
