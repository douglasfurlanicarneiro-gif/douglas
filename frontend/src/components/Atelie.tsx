import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, RefreshControl, useWindowDimensions, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import {
  COLORS, SPACING, RADIUS, STATUS, FAMILIAS, CONCENTRACOES, OCASIOES,
  brl, familiasDoPerfume, fmtDate, nomeConcentracao, padSeq,
} from '../theme';
import { BottomSheet } from './BottomSheet';
import { Field, TInput, PrimaryButton, SecondaryButton, EmptyState, Stars } from './atoms';
import {
  listPerfumes, createPerfume, updatePerfume, deletePerfume, bulkImport, padronizarTamanhos,
  listMovimentos, createMovimento, completarEstoque, getEstoqueMap, getEstoqueResumo,
  listPedidos, createPedido, updatePedido, deletePedido,
  listOpinioes, deleteOpiniao,
  publishVitrine, listSugestoes, deleteSugestao, listCompras, deleteCompra,
  downloadBackup, getMetricas, resetAllOrders,
  getConfiguracaoFrete, updateConfiguracaoFrete, autorizarMelhorEnvio,
  aplicarPrecos, getConfiguracoesLoja, updateConfiguracoesLoja, limparDados,
} from '../api';
import { PRESET_FORNECEDOR } from '../data/preset-fornecedor';
import type { Compra, ConfiguracaoFrete, ConfiguracoesLoja, EstoqueResumo, Metricas, Movimento, Opiniao, OrderStatus, Pedido, Perfume, Sugestao } from '../types';
import { publicStoreConfig, storeNameParts } from '../storeConfig';

type SheetType = null | { type: 'perfume'; data?: Perfume } | { type: 'movimento' } | { type: 'pedido'; data?: Pedido }
  | { type: 'confirm'; label: string; onConfirm: () => void; confirmLabel?: string; danger?: boolean; safetyText?: string }
  | { type: 'info'; label: string };

type PedidoPainel = Pedido & {
  fonte: 'pedidos' | 'compras-legadas';
  compraLegada?: Compra;
};

const TABS = [
  { id: 'dashboard', label: 'Início', icon: 'home' as const },
  { id: 'catalogo', label: 'Catálogo', icon: 'droplet' as const },
  { id: 'estoque', label: 'Estoque', icon: 'package' as const },
  { id: 'pedidos', label: 'Pedidos', icon: 'clipboard' as const },
  { id: 'opinioes', label: 'Opiniões', icon: 'star' as const },
  { id: 'sistema', label: 'Sistema', icon: 'settings' as const },
];

const KANBAN_FLOW: OrderStatus[] = [
  'pendente',
  'pagamento_confirmado',
  'preparando',
  'pronto',
  'enviado',
  'entregue',
];

function StatCard({ label, value, icon, alert }: { label: string; value: string | number; icon: any; alert?: boolean }) {
  return (
    <View style={[styles.statCard, alert && { borderColor: COLORS.rust }]}>
      <Feather name={icon} size={16} color={alert ? COLORS.rust : COLORS.gold} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const ORDER_ACTIONS_WIDTH = 156;

function SwipeablePedidoCard({
  children,
  onEdit,
  onDelete,
  testID,
}: {
  children: React.ReactNode;
  onEdit: () => void;
  onDelete: () => void;
  testID: string;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const dragStartRef = useRef(0);

  const animateTo = useCallback((open: boolean) => {
    openRef.current = open;
    Animated.spring(translateX, {
      toValue: open ? -ORDER_ACTIONS_WIDTH : 0,
      useNativeDriver: false,
      damping: 22,
      stiffness: 240,
      mass: 0.8,
    }).start();
  }, [translateX]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      Math.abs(gesture.dx) > 8
      && Math.abs(gesture.dx) > Math.abs(gesture.dy)
    ),
    onPanResponderGrant: () => {
      dragStartRef.current = openRef.current ? -ORDER_ACTIONS_WIDTH : 0;
    },
    onPanResponderMove: (_, gesture) => {
      const nextPosition = Math.max(
        -ORDER_ACTIONS_WIDTH,
        Math.min(0, dragStartRef.current + gesture.dx),
      );
      translateX.setValue(nextPosition);
    },
    onPanResponderRelease: (_, gesture) => {
      const finalPosition = dragStartRef.current + gesture.dx;
      animateTo(finalPosition < -(ORDER_ACTIONS_WIDTH / 2) || gesture.vx < -0.35);
    },
    onPanResponderTerminate: () => animateTo(openRef.current),
  }), [animateTo, translateX]);

  const edit = () => {
    animateTo(false);
    onEdit();
  };

  const remove = () => {
    animateTo(false);
    onDelete();
  };

  return (
    <View style={styles.swipeOrderWrap} testID={testID}>
      <View style={styles.swipeOrderActions}>
        <Pressable
          onPress={edit}
          style={({ pressed }) => [styles.swipeOrderAction, styles.swipeOrderEdit, pressed && styles.swipeOrderActionPressed]}
          accessibilityRole="button"
          accessibilityLabel="Editar pedido"
          testID={`${testID}-editar`}
        >
          <Feather name="edit-2" size={18} color={COLORS.ink} />
          <Text style={styles.swipeOrderEditText}>Editar</Text>
        </Pressable>
        <Pressable
          onPress={remove}
          style={({ pressed }) => [styles.swipeOrderAction, styles.swipeOrderDelete, pressed && styles.swipeOrderActionPressed]}
          accessibilityRole="button"
          accessibilityLabel="Excluir pedido"
          testID={`${testID}-excluir`}
        >
          <Feather name="trash-2" size={18} color={COLORS.bone} />
          <Text style={styles.swipeOrderDeleteText}>Excluir</Text>
        </Pressable>
      </View>
      <Animated.View
        style={[styles.swipeOrderFront, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable
          onPress={() => openRef.current ? animateTo(false) : onEdit()}
          style={({ pressed }) => [styles.swipeOrderCard, pressed && { opacity: 0.94 }]}
          accessibilityRole="button"
          accessibilityHint="Deslize para a esquerda para editar ou excluir"
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

function SystemCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: any;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.systemCard}>
      <View style={styles.systemCardHeader}>
        <View style={styles.systemCardIcon}><Feather name={icon} size={17} color={COLORS.gold} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.systemCardTitle}>{title}</Text>
          <Text style={styles.systemCardSubtitle}>{subtitle}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

function SystemAction({
  icon,
  title,
  subtitle,
  onPress,
  danger,
  disabled,
  badge,
}: {
  icon: any;
  title: string;
  subtitle: string;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.systemAction, disabled && { opacity: 0.5 }, pressed && { opacity: 0.75 }]}
    >
      <Feather name={icon} size={15} color={danger ? COLORS.rust : COLORS.gold} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.systemActionTitle, danger && { color: COLORS.rust }]}>{title}</Text>
        <Text style={styles.systemActionSubtitle}>{subtitle}</Text>
      </View>
      {!!badge && <Text style={styles.systemBadge}>{badge}</Text>}
      {!disabled && <Feather name="chevron-right" size={15} color={COLORS.muted} />}
    </Pressable>
  );
}

function KanbanPedidoCard({
  pedido,
  onOpen,
  onMove,
  moving,
}: {
  pedido: PedidoPainel;
  onOpen: () => void;
  onMove: (status: OrderStatus) => void;
  moving: boolean;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const statusIndex = KANBAN_FLOW.indexOf(pedido.status);
  const podeVoltar = pedido.fonte === 'pedidos' && statusIndex > 0;
  const podeAvancar = pedido.fonte === 'pedidos' && statusIndex >= 0 && statusIndex < KANBAN_FLOW.length - 1;

  const mover = useCallback((direcao: -1 | 1) => {
    const novoStatus = KANBAN_FLOW[statusIndex + direcao];
    if (!novoStatus || moving || pedido.fonte !== 'pedidos') {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: false }).start();
      return;
    }
    Animated.timing(translateX, {
      toValue: direcao * 36,
      duration: 120,
      useNativeDriver: false,
    }).start(() => {
      translateX.setValue(0);
      onMove(novoStatus);
    });
  }, [moving, onMove, pedido.fonte, statusIndex, translateX]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      pedido.fonte === 'pedidos'
      && Math.abs(gesture.dx) > 10
      && Math.abs(gesture.dx) > Math.abs(gesture.dy)
    ),
    onPanResponderMove: (_, gesture) => {
      translateX.setValue(Math.max(-90, Math.min(90, gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx > 72) mover(-1);
      else if (gesture.dx < -72) mover(1);
      else Animated.spring(translateX, { toValue: 0, useNativeDriver: false }).start();
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: false }).start();
    },
  }), [mover, pedido.fonte, translateX]);

  const unidades = (pedido.itens || []).reduce((total, item) => total + (item.quantidade || 1), 0);
  return (
    <Animated.View
      style={[styles.kanbanCard, moving && { opacity: 0.55 }, { transform: [{ translateX }] }]}
      {...panResponder.panHandlers}
      testID={`kanban-pedido-${pedido.id}`}
    >
      <Pressable onPress={onOpen} disabled={moving}>
        <View style={styles.kanbanCardTop}>
          <Text style={styles.kanbanOrderNumber}>Nº {padSeq(pedido.seq)}</Text>
          <Text style={styles.kanbanOrderDate}>{fmtDate(pedido.criadoEm)}</Text>
        </View>
        <Text style={styles.kanbanCustomer} numberOfLines={1}>{pedido.cliente}</Text>
        <Text style={styles.kanbanOrderMeta}>{unidades} unidade(s) · {brl(pedido.total)}</Text>
        {!!pedido.contato && <Text style={styles.kanbanContact} numberOfLines={1}>{pedido.contato}</Text>}
      </Pressable>
      <View style={styles.kanbanCardActions}>
        <Pressable
          onPress={() => podeVoltar && mover(-1)}
          disabled={!podeVoltar || moving}
          style={[styles.kanbanMoveButton, !podeVoltar && styles.kanbanMoveDisabled]}
          accessibilityLabel="Voltar pedido uma etapa"
        >
          <Feather name="arrow-left" size={13} color={podeVoltar ? COLORS.muted : COLORS.border} />
        </Pressable>
        <Pressable onPress={onOpen} style={styles.kanbanEditButton}>
          <Feather name="edit-2" size={12} color={COLORS.gold} />
          <Text style={styles.kanbanEditText}>Detalhes</Text>
        </Pressable>
        <Pressable
          onPress={() => podeAvancar && mover(1)}
          disabled={!podeAvancar || moving}
          style={[styles.kanbanMoveButton, !podeAvancar && styles.kanbanMoveDisabled]}
          accessibilityLabel="Avançar pedido uma etapa"
        >
          <Feather name="arrow-right" size={13} color={podeAvancar ? COLORS.gold : COLORS.border} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

function ConfirmSheetContent({
  sheet,
  onCancel,
}: {
  sheet: Extract<NonNullable<SheetType>, { type: 'confirm' }>;
  onCancel: () => void;
}) {
  const [ready, setReady] = useState(!sheet.danger);

  useEffect(() => {
    if (!sheet.danger) {
      setReady(true);
      return;
    }
    setReady(false);
    const timer = setTimeout(() => setReady(true), 700);
    return () => clearTimeout(timer);
  }, [sheet]);

  return (
    <View>
      <Text style={{ color: COLORS.bone, marginBottom: SPACING.lg }}>{sheet.label}</Text>
      {sheet.danger && (
        <View style={styles.deleteSafetyNotice}>
          <Feather name="shield" size={15} color={COLORS.gold} />
          <Text style={styles.deleteSafetyText}>
            {sheet.safetyText || 'Esta ação é permanente. Confirme somente se deseja realmente excluir.'}
          </Text>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <Pressable
          onPress={sheet.onConfirm}
          disabled={!ready}
          testID="confirm-ok"
          style={[
            styles.confirmAction,
            { backgroundColor: sheet.danger ? COLORS.rust : COLORS.gold },
            !ready && styles.confirmActionDisabled,
          ]}
        >
          <Text style={{ color: sheet.danger ? COLORS.bone : COLORS.ink, fontWeight: '600' }}>
            {!ready ? 'Aguarde…' : (sheet.confirmLabel || (sheet.danger ? 'Sim, excluir' : 'Confirmar'))}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function PerfumeForm({ initial, onSave, onCancel }: any) {
  const [f, setF] = useState<any>(initial ? {
    ...initial,
    familias: familiasDoPerfume(initial),
    concentracao: nomeConcentracao(initial.concentracao),
  } : {
    nome: '', imagemUrl: '', ocasioes: [], familia: FAMILIAS[0], familias: [FAMILIAS[0]], concentracao: CONCENTRACOES[0],
    notasSaida: '', notasCoracao: '', notasFundo: '',
    precos: [{ ml: 30, preco: 0 }], estoqueMinimoMl: 100, publicavel: false,
  });
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const toggleOcasiao = (value: string) => setF((s: any) => {
    const atuais = Array.isArray(s.ocasioes) ? s.ocasioes : [];
    return { ...s, ocasioes: atuais.includes(value) ? atuais.filter((item: string) => item !== value) : [...atuais, value] };
  });
  const toggleFamilia = (value: string) => setF((s: any) => {
    const atuais = familiasDoPerfume(s);
    const familias = atuais.includes(value) ? atuais.filter((item: string) => item !== value) : [...atuais, value];
    return { ...s, familias, familia: familias[0] || '' };
  });
  const setPreco = (i: number, k: string, v: any) => setF((s: any) => ({ ...s, precos: s.precos.map((p: any, idx: number) => idx === i ? { ...p, [k]: v } : p) }));
  const addPreco = () => setF((s: any) => ({ ...s, precos: [...s.precos, { ml: 10, preco: 0 }] }));
  const rmPreco = (i: number) => setF((s: any) => ({ ...s, precos: s.precos.filter((_: any, idx: number) => idx !== i) }));
  return (
    <View>
      <Field label="Nome do contratipo"><TInput value={f.nome} onChangeText={(v) => set('nome', v)} placeholder="Ex: Âmbar Noturno" testID="perfume-nome" /></Field>
      <Field label="Foto do perfume (link da imagem)">
        <TInput
          value={f.imagemUrl || ''}
          onChangeText={(v) => set('imagemUrl', v)}
          placeholder="https://.../foto-do-perfume.jpg"
          autoCapitalize="none"
          keyboardType="url"
          testID="perfume-imagem"
        />
      </Field>
      {!!f.imagemUrl && (
        <View style={styles.imagePreview}>
          <Image source={{ uri: f.imagemUrl }} style={styles.imagePreviewPhoto} contentFit="contain" transition={180} />
          <Text style={styles.imagePreviewText}>Prévia da foto</Text>
        </View>
      )}
      <Field label="Clima & Ocasião">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {OCASIOES.map((item) => {
            const selected = (f.ocasioes || []).includes(item);
            return (
              <Pressable key={item} onPress={() => toggleOcasiao(item)} style={[styles.miniChip, selected && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}>
                <Text style={{ color: selected ? COLORS.ink : COLORS.muted, fontSize: 11 }}>{item}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>
      <Field label="Família Olfativa">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {FAMILIAS.map((fam) => {
            const selected = familiasDoPerfume(f).includes(fam);
            return (
              <Pressable key={fam} onPress={() => toggleFamilia(fam)} style={[styles.miniChip, selected && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}>
                <Text style={{ color: selected ? COLORS.ink : COLORS.muted, fontSize: 11 }}>{fam}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>
      <Field label="Concentração">
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {CONCENTRACOES.map((c) => (
            <Pressable key={c} onPress={() => set('concentracao', c)} style={[styles.miniChip, f.concentracao === c && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}>
              <Text style={{ color: f.concentracao === c ? COLORS.ink : COLORS.muted, fontSize: 11 }}>{c}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <View style={{ padding: SPACING.md, backgroundColor: COLORS.ink, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md }}>
        <Text style={{ color: COLORS.gold, fontSize: 11, marginBottom: 8 }}>PIRÂMIDE OLFATIVA</Text>
        {[
          { c: COLORS.topNote, label: 'Saída', k: 'notasSaida' },
          { c: COLORS.heartNote, label: 'Coração', k: 'notasCoracao' },
          { c: COLORS.baseNote, label: 'Fundo', k: 'notasFundo' },
        ].map((row) => (
          <View key={row.k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: row.c }} />
            <TInput style={{ flex: 1 }} value={f[row.k]} onChangeText={(v) => set(row.k, v)} placeholder={`Notas de ${row.label.toLowerCase()}`} />
          </View>
        ))}
      </View>
      <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 6 }}>Tamanhos e preços</Text>
      {f.precos.map((p: any, i: number) => (
        <View key={i} style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <TInput style={{ width: 70 }} keyboardType="numeric" value={String(p.ml)} onChangeText={(v) => setPreco(i, 'ml', Number(v) || 0)} placeholder="ml" />
          <Text style={{ color: COLORS.muted, fontSize: 11 }}>ml</Text>
          <TInput style={{ flex: 1 }} keyboardType="decimal-pad" value={String(p.preco)} onChangeText={(v) => setPreco(i, 'preco', Number(v) || 0)} placeholder="Preço" />
          {f.precos.length > 1 && (
            <Pressable onPress={() => rmPreco(i)} hitSlop={8}><Feather name="x" size={16} color={COLORS.rust} /></Pressable>
          )}
        </View>
      ))}
      <Pressable onPress={addPreco}><Text style={{ color: COLORS.gold, fontSize: 12, marginBottom: SPACING.md }}>+ adicionar tamanho</Text></Pressable>
      <Field label="Estoque mínimo de alerta (ml)">
        <TInput keyboardType="numeric" value={String(f.estoqueMinimoMl)} onChangeText={(v) => set('estoqueMinimoMl', Number(v) || 0)} />
      </Field>
      <Pressable onPress={() => set('publicavel', !f.publicavel)} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, marginBottom: SPACING.md }}>
        <Text style={{ color: COLORS.bone, fontSize: 14 }}>Mostrar na vitrine pública</Text>
        <View style={{ width: 44, height: 24, borderRadius: 12, backgroundColor: f.publicavel ? COLORS.gold : COLORS.border, justifyContent: 'center', paddingHorizontal: 2, alignItems: f.publicavel ? 'flex-end' : 'flex-start' }}>
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.bone }} />
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton
          label="Salvar"
          onPress={() => f.nome.trim() && familiasDoPerfume(f).length && onSave({
            ...f,
            inspiracao: '',
            familia: familiasDoPerfume(f)[0],
            familias: familiasDoPerfume(f),
          })}
          disabled={!f.nome.trim() || !familiasDoPerfume(f).length || (f.publicavel && !f.precos.some((price: { preco: number }) => price.preco > 0))}
          testID="perfume-save"
        />
      </View>
    </View>
  );
}

function MovimentoForm({ perfumes, onSave, onCancel }: any) {
  const opcoes = [
    { id: 'entrada', label: 'Entrada', tipo: 'entrada', motivo: 'Entrada de estoque' },
    { id: 'perda', label: 'Perda', tipo: 'saida', motivo: 'Perda ou vazamento' },
    { id: 'ajuste-positivo', label: 'Ajuste +', tipo: 'entrada', motivo: 'Ajuste positivo de inventário' },
    { id: 'ajuste-negativo', label: 'Ajuste −', tipo: 'saida', motivo: 'Ajuste negativo de inventário' },
    { id: 'devolucao', label: 'Devolução', tipo: 'entrada', motivo: 'Devolução ao estoque' },
  ] as const;
  const [f, setF] = useState({
    perfumeId: perfumes[0]?.id || '',
    tipo: 'entrada',
    quantidadeMl: 100,
    motivo: 'Entrada de estoque',
    categoria: 'entrada',
  });
  const selecionarMovimento = (opcao: typeof opcoes[number]) => {
    setF({
      ...f,
      tipo: opcao.tipo,
      motivo: opcao.motivo,
      categoria: opcao.id,
    });
  };
  return (
    <View>
      <Field label="Perfume">
        <ScrollView style={{ maxHeight: 200 }}>
          {perfumes.map((p: any) => (
            <Pressable key={p.id} onPress={() => setF({ ...f, perfumeId: p.id })} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <Text style={{ color: f.perfumeId === p.id ? COLORS.gold : COLORS.bone, fontSize: 13 }}>Nº{padSeq(p.seq)} · {p.nome}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Field>
      <Field label="Movimentação">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {opcoes.map((opcao) => (
            <Pressable
              key={opcao.id}
              onPress={() => selecionarMovimento(opcao)}
              style={[styles.miniChip, f.categoria === opcao.id && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}
            >
              <Text style={{ color: f.categoria === opcao.id ? COLORS.ink : COLORS.muted, fontSize: 11 }}>{opcao.label}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label="Quantidade (ml)"><TInput keyboardType="numeric" value={String(f.quantidadeMl)} onChangeText={(v) => setF({ ...f, quantidadeMl: Number(v) || 0 })} testID="mov-qtd" /></Field>
      <Field label="Observação">
        <TInput value={f.motivo} onChangeText={(v) => setF({ ...f, motivo: v })} placeholder="Descreva o motivo desta movimentação" />
      </Field>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: SPACING.sm }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton label="Lançar" onPress={() => f.perfumeId && f.quantidadeMl > 0 && onSave(f)} testID="mov-save" />
      </View>
    </View>
  );
}

function PedidoForm({ perfumes, initial, onSave, onCancel, onDelete }: any) {
  const [f, setF] = useState<any>(initial || { cliente: '', contato: '', status: 'pendente', observacoes: '', itens: [] });
  const pedidoRecebido = Boolean(initial?.id);
  const [searchingIdx, setSearchingIdx] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const addItem = () => {
    if (!perfumes[0]) return;
    setF((s: any) => ({ ...s, itens: [...s.itens, { perfumeId: perfumes[0].id, ml: perfumes[0].precos?.[0]?.ml || 30, quantidade: 1 }] }));
    setSearchingIdx(f.itens.length);
    setQ('');
  };
  const setItem = (i: number, k: string, v: any) => setF((s: any) => ({ ...s, itens: s.itens.map((it: any, idx: number) => idx === i ? { ...it, [k]: v } : it) }));
  const rmItem = (i: number) => setF((s: any) => ({ ...s, itens: s.itens.filter((_: any, idx: number) => idx !== i) }));
  const precoDo = (it: any) => {
    const p = perfumes.find((pf: any) => pf.id === it.perfumeId);
    return p?.precos.find((pr: any) => pr.ml === Number(it.ml))?.preco || 0;
  };
  const totalProdutos = f.itens.reduce((s: number, it: any) => s + precoDo(it) * it.quantidade, 0);
  const total = totalProdutos + Number(f.frete || 0);
  const filtrados = perfumes.filter((p: any) => p.nome.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  return (
    <View>
      <Field label="Cliente"><TInput value={f.cliente} onChangeText={(v) => set('cliente', v)} testID="pedido-cliente" /></Field>
      <Field label="Contato (opcional)"><TInput value={f.contato} onChangeText={(v) => set('contato', v)} /></Field>
      <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 6 }}>Itens do pedido</Text>
      {f.itens.map((it: any, i: number) => {
        const p = perfumes.find((pf: any) => pf.id === it.perfumeId);
        const editando = searchingIdx === i;
        return (
          <View key={i} style={{ padding: SPACING.md, backgroundColor: COLORS.ink, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={() => { if (!pedidoRecebido) { setSearchingIdx(editando ? null : i); setQ(''); } }}
                disabled={pedidoRecebido}
                style={{ flex: 1 }}
                testID={`item-select-${i}`}
              >
                <Text style={{ color: COLORS.gold, fontSize: 11 }}>Nº {padSeq(p?.seq || 0)}</Text>
                <Text style={{ color: COLORS.bone, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{p?.nome || 'Selecionar perfume'}</Text>
                {!pedidoRecebido && <Text style={{ color: COLORS.muted, fontSize: 11 }}>{editando ? 'toque para fechar' : 'toque para trocar'}</Text>}
              </Pressable>
              {!pedidoRecebido && <Pressable onPress={() => rmItem(i)} hitSlop={8}><Feather name="x" size={16} color={COLORS.rust} /></Pressable>}
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
                  {filtrados.length === 0 && <Text style={{ color: COLORS.muted, fontSize: 12, padding: 12 }}>Nenhum resultado.</Text>}
                  {filtrados.map((p2: any) => (
                    <Pressable
                      key={p2.id}
                      onPress={() => { setItem(i, 'perfumeId', p2.id); setItem(i, 'ml', p2.precos?.[0]?.ml || 30); setSearchingIdx(null); setQ(''); }}
                      style={{ paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: it.perfumeId === p2.id ? COLORS.surfaceRaised : 'transparent' }}
                      testID={`item-option-${p2.id}`}
                    >
                      <Text style={{ color: COLORS.gold, fontSize: 10 }}>Nº {padSeq(p2.seq)}</Text>
                      <Text style={{ color: COLORS.bone, fontSize: 13 }} numberOfLines={1}>{p2.nome}</Text>
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
                    {it.ml}ml · {brl((p?.precos || []).find((pr: any) => pr.ml === Number(it.ml))?.preco || 0)}
                  </Text>
                </View>
                <View style={styles.orderQuantity}>
                  <Text style={styles.orderChoiceLabel}>QUANTIDADE</Text>
                  <Text style={styles.orderQuantityValue}>{it.quantidade}</Text>
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: SPACING.sm }}>
                {(p?.precos || []).map((pr: any) => (
                  <Pressable key={pr.ml} onPress={() => setItem(i, 'ml', pr.ml)} style={[styles.miniChip, Number(it.ml) === pr.ml && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}>
                    <Text style={{ color: Number(it.ml) === pr.ml ? COLORS.ink : COLORS.muted, fontSize: 11 }}>{pr.ml}ml · {brl(pr.preco)}</Text>
                  </Pressable>
                ))}
                <TInput style={{ width: 60 }} keyboardType="numeric" value={String(it.quantidade)} onChangeText={(v) => setItem(i, 'quantidade', Number(v) || 1)} />
              </View>
            )}
          </View>
        );
      })}
      {!pedidoRecebido && <Pressable onPress={addItem} testID="pedido-add-item"><Text style={{ color: COLORS.gold, fontSize: 12, marginBottom: SPACING.md }}>+ adicionar item</Text></Pressable>}
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
          </View>
        </View>
      )}
      <Field label="Status">
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {STATUS.map((s) => (
            <Pressable key={s.id} onPress={() => set('status', s.id)} style={[styles.miniChip, f.status === s.id && { backgroundColor: s.color, borderColor: s.color }]}>
              <Text style={{ color: f.status === s.id ? COLORS.ink : COLORS.muted, fontSize: 11 }}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      {pedidoRecebido && initial?.pagamento?.metodo === 'pix' && f.status === 'pendente' && (
        <Pressable
          onPress={() => onSave({ ...f, status: 'pagamento_confirmado', total })}
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
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md }}>
        <Text style={{ color: COLORS.muted, fontSize: 13 }}>Total</Text>
        <Text style={{ color: COLORS.bone, fontSize: 16 }}>{brl(total)}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton label="Salvar pedido" onPress={() => f.cliente.trim() && f.itens.length > 0 && onSave({ ...f, total })} disabled={!f.cliente.trim() || f.itens.length === 0} testID="pedido-save" />
      </View>
      {pedidoRecebido && initial?.status !== 'cancelado' && (
        <Pressable
          onPress={() => onSave({ ...f, status: 'cancelado', total })}
          style={styles.cancelAdminOrderButton}
          testID="pedido-cancelar"
        >
          <Feather name="x-circle" size={16} color={COLORS.rust} />
          <Text style={styles.cancelAdminOrderText}>Cancelar pedido</Text>
        </Pressable>
      )}
      {pedidoRecebido && initial?.status === 'cancelado' && (
        <Pressable
          onPress={() => onDelete(initial)}
          style={styles.deleteAdminOrderButton}
          testID="pedido-excluir-definitivamente"
        >
          <Feather name="trash-2" size={16} color={COLORS.bone} />
          <View style={{ flex: 1 }}>
            <Text style={styles.deleteAdminOrderTitle}>Excluir definitivamente</Text>
            <Text style={styles.deleteAdminOrderHint}>Remove o pedido e seu histórico do painel.</Text>
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
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [perfumes, setPerfumes] = useState<Perfume[]>([]);
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [opinioes, setOpinioes] = useState<Opiniao[]>([]);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [estoqueResumo, setEstoqueResumo] = useState<EstoqueResumo>({});
  const [sheet, setSheet] = useState<SheetType>(null);
  const [search, setSearch] = useState('');
  const [publicando, setPublicando] = useState(false);
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [freteConfig, setFreteConfig] = useState<ConfiguracaoFrete | null>(null);
  const [freteFeeInput, setFreteFeeInput] = useState('0,00');
  const [freteCepInput, setFreteCepInput] = useState('');
  const [freteGratisInput, setFreteGratisInput] = useState('0,00');
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
    try {
      const [p, m, pe, o, s, c, e, metrics, shipping, store] = await Promise.all([
        listPerfumes(), listMovimentos(), listPedidos(), listOpinioes(), listSugestoes(), listCompras(),
        getEstoqueResumo().catch(async () => {
          const mapa = await getEstoqueMap();
          return Object.fromEntries(Object.entries(mapa).map(([id, saldoAtualMl]) => [
            id,
            { saldoAtualMl, reservadoMl: 0, disponivelMl: saldoAtualMl },
          ]));
        }),
        getMetricas().catch(() => null),
        getConfiguracaoFrete().catch(() => null),
        getConfiguracoesLoja().catch(() => null),
      ]);
      setPerfumes(p); setMovimentos(m); setPedidos(pe); setOpinioes(o); setSugestoes(s); setCompras(c); setEstoqueResumo(e);
      setMetricas(metrics);
      setFreteConfig(shipping);
      if (store) setStoreConfig(store);
      if (shipping) {
        setFreteFeeInput(shipping.taxaEmbalagem.toFixed(2).replace('.', ','));
        setFreteCepInput(shipping.cepOrigem);
        setFreteGratisInput(shipping.freteGratisAcima.toFixed(2).replace('.', ','));
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveFreteConfig = async () => {
    const fee = Number(freteFeeInput.replace(',', '.'));
    const freeAbove = Number(freteGratisInput.replace(',', '.'));
    const cep = freteCepInput.replace(/\D/g, '');
    if (!Number.isFinite(fee) || fee < 0 || !Number.isFinite(freeAbove) || freeAbove < 0 || cep.length !== 8) {
      setSheet({ type: 'info', label: 'Informe um CEP válido e valores de frete iguais ou maiores que zero.' });
      return;
    }
    setSavingFrete(true);
    try {
      const updated = await updateConfiguracaoFrete({
        taxaEmbalagem: fee,
        cepOrigem: cep,
        freteGratisAcima: freeAbove,
      });
      setFreteConfig(updated);
      setFreteFeeInput(updated.taxaEmbalagem.toFixed(2).replace('.', ','));
      setFreteCepInput(updated.cepOrigem);
      setFreteGratisInput(updated.freteGratisAcima.toFixed(2).replace('.', ','));
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
      await publishVitrine();
      setSheet({
        type: 'info',
        label: `Preços atualizados em ${result.atualizados} perfume(s) e publicados na vitrine.`,
      });
      await load();
    } catch {
      setSheet({ type: 'info', label: 'Não foi possível aplicar os preços.' });
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
  const notaMedia = opinioes.length ? (opinioes.reduce((s, o) => s + o.nota, 0) / opinioes.length).toFixed(1) : '–';

  const doSavePerfume = async (data: any) => {
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
    await publishVitrine();
    setSheet({
      type: 'info',
      label: `Preços padrão aplicados a ${r.atualizados} perfume(s) e vitrine republicada: 30ml por R$ 50, 50ml por R$ 80 e 100ml por R$ 120.`,
    });
    load();
  };
  const doMov = async (data: any) => { await createMovimento(data); setSheet(null); load(); };
  const doCompletarEstoque = async () => {
    const r = await completarEstoque(1000);
    setSheet({
      type: 'info',
      label: `${r.perfumesAtualizados} perfume(s) atualizados. Todos os ${r.perfumesConsiderados} itens da vitrine agora possuem pelo menos ${r.estoqueAlvoMl}ml.`,
    });
    load();
  };
  const pedidoPayload = (data: any) => ({
    cliente: data.cliente,
    contato: data.contato || '',
    status: data.status,
    observacoes: data.observacoes || '',
    itens: (data.itens || []).map((item: any) => ({
      perfumeId: item.perfumeId,
      ml: Number(item.ml),
      quantidade: Number(item.quantidade) || 1,
    })),
    total: Number(data.total) || 0,
  });
  const persistPedido = async (data: any) => {
    if (data.id) await updatePedido(data.id, pedidoPayload(data));
    else await createPedido(pedidoPayload(data) as any);
    setSheet(null);
    await load();
  };
  const doSavePedido = async (data: any) => {
    const anterior = data.id ? pedidos.find((pedido) => pedido.id === data.id) : null;
    if (anterior && anterior.status !== 'cancelado' && data.status === 'cancelado') {
      setSheet({
        type: 'confirm',
        label: `Cancelar o pedido Nº ${padSeq(data.seq)} de ${data.cliente}? A reserva ou a baixa automática do estoque será liberada.`,
        onConfirm: () => persistPedido(data),
        confirmLabel: 'Cancelar pedido',
        danger: true,
        safetyText: 'O pedido sairá do fluxo ativo e a reserva ou baixa automática será liberada. O histórico continuará disponível.',
      });
      return;
    }
    await persistPedido(data);
  };
  const doDelPedido = async (id: string) => { await deletePedido(id); setSheet(null); load(); };
  const requestDeletePedido = (pedido: Pedido) => {
    setSheet({
      type: 'confirm',
      label: `Excluir definitivamente o pedido Nº ${padSeq(pedido.seq)} de ${pedido.cliente}?`,
      onConfirm: () => doDelPedido(pedido.id),
      confirmLabel: 'Excluir definitivamente',
      danger: true,
      safetyText: 'Esta ação não pode ser desfeita. O pedido, o acompanhamento do cliente e todo o histórico serão removidos.',
    });
  };
  const doDelOpiniao = async (id: string) => { await deleteOpiniao(id); setSheet(null); load(); };
  const doPublish = async () => {
    setPublicando(true);
    try { await publishVitrine(); setSheet({ type: 'info', label: 'Vitrine publicada! Quem abrir o app vê a nova versão.' }); }
    catch { setSheet({ type: 'info', label: 'Erro ao publicar. Tente de novo.' }); }
    finally { setPublicando(false); }
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
      await updatePedido(pedido.id, pedidoPayload({ ...pedido, status }));
      await load();
    } catch {
      setSheet({ type: 'info', label: 'Não foi possível mover o pedido. Verifique a conexão e tente novamente.' });
    } finally {
      setMovingOrderId(null);
    }
  };
  const doBackup = async () => {
    try {
      await downloadBackup();
      setSheet({ type: 'info', label: 'Backup gerado e baixado com sucesso. Guarde o arquivo em um local seguro.' });
    } catch {
      setSheet({ type: 'info', label: 'Não foi possível baixar o backup. Abra o painel no navegador e tente novamente.' });
    }
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

  const sheetTitle = !sheet ? '' :
    sheet.type === 'perfume' ? (sheet.data ? 'Editar contratipo' : 'Novo contratipo') :
    sheet.type === 'movimento' ? 'Lançar estoque' :
    sheet.type === 'pedido' ? (sheet.data ? 'Editar pedido' : 'Novo pedido') :
    sheet.type === 'confirm' ? (sheet.danger ? 'Confirmar exclusão' : 'Confirmar') : 'Aviso';

  const openCreate = () => {
    if (tab === 'catalogo') { setSheet({ type: 'perfume' }); return; }
    if (perfumes.length === 0) { setSheet({ type: 'info', label: 'Cadastre um contratipo no Catálogo antes.' }); return; }
    if (tab === 'estoque') setSheet({ type: 'movimento' });
    else if (tab === 'pedidos') setSheet({ type: 'pedido' });
  };

  const renderContent = () => {
    if (loading) return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={COLORS.gold} /></View>;

    if (tab === 'dashboard') {
      return (
        <View style={{ padding: SPACING.lg }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: SPACING.lg }}>
            <View style={{ width: '48%' }}><StatCard label="Contratipos" value={perfumes.length} icon="droplet" /></View>
            <View style={{ width: '48%' }}><StatCard label="Estoque baixo" value={estoqueBaixo} icon="alert-triangle" alert={estoqueBaixo > 0} /></View>
            <View style={{ width: '48%' }}><StatCard label="Aguardando pagamento" value={pendentes} icon="clipboard" /></View>
            <View style={{ width: '48%' }}><StatCard label="Nota média" value={notaMedia} icon="star" /></View>
          </View>
          {metricas && (
            <View style={styles.metricsPanel}>
              <Text style={styles.sectionLabel}>VISÃO DO NEGÓCIO</Text>
              <View style={styles.metricsRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.metricLabel}>Faturamento em pedidos</Text>
                  <Text style={styles.metricValue}>{brl(metricas.faturamento)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.metricLabel}>Ticket médio</Text>
                  <Text style={styles.metricValue}>{brl(metricas.ticketMedio)}</Text>
                </View>
              </View>
              {metricas.maisVendidos.length > 0 && (
                <>
                  <Text style={[styles.metricLabel, { marginTop: SPACING.md }]}>MAIS VENDIDOS</Text>
                  {metricas.maisVendidos.slice(0, 5).map((item, index) => (
                    <View key={`${item.perfumeId}-${index}`} style={styles.rankingRow}>
                      <Text style={styles.rankingNumber}>{index + 1}</Text>
                      <Text style={styles.rankingName} numberOfLines={1}>{item.nome}</Text>
                      <Text style={styles.rankingQty}>{item.quantidade} un.</Text>
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
                    <Text style={{ color: COLORS.gold, fontSize: 11 }}>Nº {padSeq(p.seq)}</Text>
                    <Text style={{ color: COLORS.bone, fontSize: 15, fontWeight: '500' }}>{p.cliente}</Text>
                  </View>
                  <View style={[styles.pill, { borderColor: st.color }]}><Text style={{ color: st.color, fontSize: 11 }}>{st.label}</Text></View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ color: COLORS.muted, fontSize: 12 }}>{(p.itens || []).length} item(ns) · {fmtDate(p.criadoEm)}</Text>
                  <Text style={{ color: COLORS.bone, fontSize: 13 }}>{brl(p.total)}</Text>
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
                      <Text style={{ color: COLORS.gold, fontSize: 11 }}>Nº {padSeq(p.seq)}</Text>
                      <Text style={{ color: COLORS.bone, fontSize: 15, fontWeight: '500' }}>{p.nome}</Text>
                      <Text style={{ color: COLORS.muted, fontSize: 11 }}>
                        {(p.ocasioes || []).length ? (p.ocasioes || []).join(' · ') : 'Clima & ocasião não informados'}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Pressable onPress={() => setSheet({ type: 'perfume', data: p })} hitSlop={8} testID={`edit-${p.id}`}><Feather name="edit-2" size={16} color={COLORS.muted} /></Pressable>
                      <Pressable onPress={() => setSheet({ type: 'confirm', label: `Excluir "${p.nome}"?`, onConfirm: () => doDeletePerfume(p.id), danger: true })} hitSlop={8} testID={`del-${p.id}`}><Feather name="trash-2" size={16} color={COLORS.muted} /></Pressable>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    <View style={styles.tag}><Text style={{ color: COLORS.gold, fontSize: 10 }}>{familiasDoPerfume(p).join(' · ')}</Text></View>
                    <View style={styles.tag}><Text style={{ color: COLORS.muted, fontSize: 10 }}>{nomeConcentracao(p.concentracao)}</Text></View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                    {p.precos.map((pr: any, i: number) => (
                      <Text key={i} style={{ color: COLORS.bone, fontSize: 11 }}>{pr.ml}ml · {brl(pr.preco)}</Text>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                    {baixo && <Feather name="alert-triangle" size={11} color={COLORS.rust} />}
                    <Text style={{ color: baixo ? COLORS.rust : COLORS.sage, fontSize: 11 }}>
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
          <Pressable
            onPress={() => setSheet({
              type: 'confirm',
              label: 'Completar o estoque de todos os perfumes da vitrine para 1.000ml? Itens que já possuem 1.000ml ou mais não serão alterados.',
              onConfirm: doCompletarEstoque,
              confirmLabel: 'Completar estoque',
            })}
            style={styles.actionBtn}
            testID="completar-estoque-btn"
          >
            <Text style={{ color: COLORS.gold, fontSize: 12 }}>Completar todos para 1.000ml</Text>
          </Pressable>
          {perfumes.length === 0 && <EmptyState text="Cadastre um contratipo antes." />}
          {perfumes.map((p) => {
            const resumo = resumoDe(p.id);
            const baixo = resumo.disponivelMl <= (p.estoqueMinimoMl || 0);
            const precisaRepor = Math.max(0, -resumo.disponivelMl);
            return (
              <View key={p.id} style={styles.rowCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: COLORS.gold, fontSize: 11 }}>Nº{padSeq(p.seq)}</Text>
                    <Text style={{ color: COLORS.bone, fontSize: 14, fontWeight: '500' }}>{p.nome}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: baixo ? COLORS.rust : COLORS.sage, fontSize: 15 }}>{resumo.disponivelMl}ml</Text>
                    <Text style={{ color: COLORS.muted, fontSize: 10 }}>disponíveis</Text>
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
                  <Text style={{ color: COLORS.bone, fontSize: 13 }}>{p?.nome || 'Perfume removido'}</Text>
                  <Text style={{ color: COLORS.muted, fontSize: 11 }}>{m.motivo || (m.tipo === 'entrada' ? 'Entrada' : 'Saída')} · {fmtDate(m.data)}</Text>
                </View>
                <Text style={{ color: m.tipo === 'entrada' ? COLORS.sage : COLORS.rust, fontSize: 13 }}>{m.tipo === 'entrada' ? '+' : '-'}{m.quantidadeMl}ml</Text>
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
                <Pressable onPress={() => setOrderSearch('')} hitSlop={8}>
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
                <Text style={styles.swipeOrderHintText}>Deslize um pedido para a esquerda para editar ou excluir.</Text>
              </View>
              {pedidosFiltrados.map((p) => {
                const st = STATUS.find((s) => s.id === p.status) || STATUS[0];
                return (
                  <SwipeablePedidoCard
                    key={`${p.fonte}-${p.id}`}
                    onEdit={() => abrirPedido(p)}
                    onDelete={() => setSheet({
                      type: 'confirm',
                      label: `Excluir pedido de ${p.cliente}?`,
                      onConfirm: () => p.compraLegada ? doDelCompra(p.compraLegada.id) : doDelPedido(p.id),
                      danger: true,
                    })}
                    testID={`pedido-${p.id}`}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <View><Text style={{ color: COLORS.gold, fontSize: 11 }}>Nº {padSeq(p.seq)}</Text><Text style={{ color: COLORS.bone, fontSize: 15, fontWeight: '500' }}>{p.cliente}</Text></View>
                      <View style={[styles.pill, { borderColor: st.color }]}><Text style={{ color: st.color, fontSize: 11 }}>{st.label}</Text></View>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                      <Text style={{ color: COLORS.muted, fontSize: 12 }}>{(p.itens || []).length} item(ns) · {fmtDate(p.criadoEm)}</Text>
                      <Text style={{ color: COLORS.bone, fontSize: 13 }}>{brl(p.total)}</Text>
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
                  <Text style={{ color: COLORS.bone, fontSize: 15, fontWeight: '500' }}>{p?.nome || 'Perfume removido'}</Text>
                  <Pressable onPress={() => setSheet({ type: 'confirm', label: 'Excluir opinião?', onConfirm: () => doDelOpiniao(o.id), danger: true })} hitSlop={8}>
                    <Feather name="trash-2" size={14} color={COLORS.muted} />
                  </Pressable>
                </View>
                <View style={{ marginTop: 4 }}><Stars value={o.nota} size={14} /></View>
                {!!o.cliente && <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>{o.cliente}</Text>}
                {!!o.comentario && <Text style={{ color: COLORS.bone, fontSize: 13, marginTop: 4 }}>{o.comentario}</Text>}
              </View>
            );
          })}
          <Text style={[styles.sectionLabel, { marginTop: SPACING.lg }]}>SUGESTÕES RECEBIDAS</Text>
          {sugestoes.length === 0 && <EmptyState text="Nenhuma sugestão recebida." />}
          {[...sugestoes].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()).map((s) => (
            <View key={s.id} style={styles.rowCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.bone, fontSize: 14, fontWeight: '500' }}>{s.cliente || 'Anônimo'}</Text>
                <Pressable onPress={() => doDelSugestao(s.id)} hitSlop={8}><Feather name="trash-2" size={14} color={COLORS.muted} /></Pressable>
              </View>
              {!!s.contato && <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>{s.contato}</Text>}
              <Text style={{ color: COLORS.bone, fontSize: 13, marginTop: 4 }}>{s.mensagem}</Text>
              <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 4 }}>{fmtDate(s.data)}</Text>
            </View>
          ))}
        </View>
      );
    }

    if (tab === 'sistema') {
      const setStoreField = <K extends keyof ConfiguracoesLoja,>(key: K, value: ConfiguracoesLoja[K]) => {
        setStoreConfig((current) => ({ ...current, [key]: value }));
      };
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

          <SystemCard icon="dollar-sign" title="Preços" subtitle="Defina os valores e aplique em todo o catálogo.">
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
                <Text style={{ color: freteConfig?.integrado ? COLORS.sage : COLORS.muted, fontSize: 10 }}>
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
            <Pressable onPress={saveFreteConfig} disabled={savingFrete} style={styles.systemPrimaryButton}>
              <Feather name="save" size={15} color={COLORS.ink} />
              <Text style={styles.systemPrimaryText}>{savingFrete ? 'Salvando…' : 'Salvar frete'}</Text>
            </Pressable>
            {!freteConfig?.integrado && (
              <SystemAction icon="external-link" title="Conectar Melhor Envio" subtitle="Autorize a conta responsável pelas cotações." onPress={connectMelhorEnvio} />
            )}
          </SystemCard>

          <SystemCard icon="archive" title="Fornecedores" subtitle="Importe e mantenha seu catálogo sincronizado.">
            <View style={styles.supplierActive}>
              <View style={{ flex: 1 }}>
                <Text style={styles.supplierName}>Nova Essência</Text>
                <Text style={styles.supplierMeta}>{PRESET_FORNECEDOR.length} fragrâncias disponíveis</Text>
              </View>
              <View style={styles.connectedPill}><Text style={styles.connectedPillText}>ATIVO</Text></View>
            </View>
            <SystemAction
              icon="download-cloud"
              title="Importar todos os perfumes"
              subtitle="Adiciona somente os itens que ainda não existem."
              onPress={() => setSheet({
                type: 'confirm',
                label: `Importar e sincronizar ${PRESET_FORNECEDOR.length} fragrâncias da Nova Essência? Itens existentes serão preservados.`,
                onConfirm: doImport,
                confirmLabel: 'Sincronizar catálogo',
              })}
            />
            <SystemAction icon="plus-circle" title="Essencial" subtitle="Novo fornecedor poderá ser conectado aqui." disabled badge="PLANEJADO" />
            <SystemAction icon="plus-circle" title="Casa das Essências" subtitle="Novo fornecedor poderá ser conectado aqui." disabled badge="PLANEJADO" />
          </SystemCard>

          <SystemCard icon="database" title="Base de dados" subtitle="Backup e limpezas protegidas por confirmação.">
            <SystemAction icon="download" title="Exportar backup" subtitle="Baixe uma cópia dos dados atuais." onPress={doBackup} />
            <SystemAction icon="upload" title="Restaurar backup" subtitle="Importação validada de um arquivo anterior." disabled badge="PRÓXIMA ETAPA" />
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
                    storePreview.pix && 'Pix',
                  ].filter(Boolean).join(' · ') || 'Adicione seus canais de contato'}
                </Text>
              </View>
            </View>
            <Field label="Nome da loja"><TInput value={storeConfig.nomeLoja} onChangeText={(value) => setStoreField('nomeLoja', value)} testID="store-name-input" /></Field>
            <Field label="Logo (endereço da imagem)"><TInput value={storeConfig.logoUrl} onChangeText={(value) => setStoreField('logoUrl', value)} autoCapitalize="none" testID="store-logo-input" /></Field>
            <View style={styles.systemFieldGrid}>
              <View style={{ flex: 1 }}><Field label="WhatsApp"><TInput value={storeConfig.whatsapp} onChangeText={(value) => setStoreField('whatsapp', value)} keyboardType="phone-pad" /></Field></View>
              <View style={{ flex: 1 }}><Field label="Instagram"><TInput value={storeConfig.instagram} onChangeText={(value) => setStoreField('instagram', value)} autoCapitalize="none" /></Field></View>
            </View>
            <Field label="E-mail"><TInput value={storeConfig.email} onChangeText={(value) => setStoreField('email', value)} keyboardType="email-address" autoCapitalize="none" /></Field>
            <Field label="Chave Pix"><TInput value={storeConfig.pix} onChangeText={(value) => setStoreField('pix', value)} autoCapitalize="none" /></Field>
            <Field label="CNPJ (opcional)"><TInput value={storeConfig.cnpj} onChangeText={(value) => setStoreField('cnpj', value)} keyboardType="numeric" /></Field>
            <Pressable onPress={saveStoreConfig} disabled={savingStore} style={styles.systemPrimaryButton} testID="store-config-save">
              <Feather name="save" size={15} color={COLORS.ink} />
              <Text style={styles.systemPrimaryText}>{savingStore ? 'Salvando…' : 'Salvar configurações'}</Text>
            </Pressable>
          </SystemCard>

          <SystemCard icon="zap" title="Automações" subtitle="Rotinas operacionais em um único lugar.">
            <SystemAction icon="percent" title="Recalcular preços" subtitle="Preenche somente preços ausentes com o padrão atual." onPress={doPadronizar} />
            <SystemAction icon="refresh-cw" title="Reimportar fornecedores" subtitle="Sincroniza novamente a Nova Essência." onPress={doImport} />
            <SystemAction icon="package" title="Atualizar estoque" subtitle="Automação reservada para a próxima fase do estoque." disabled badge="PLANEJADO" />
            <SystemAction icon="image" title="Corrigir imagens" subtitle="Auditoria automática de fotos ausentes." disabled badge="PLANEJADO" />
            <SystemAction icon="tag" title="Gerar etiquetas" subtitle="Etiquetas prontas para impressão por pedido." disabled badge="PLANEJADO" />
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
          <Text style={{ color: COLORS.gold, fontSize: 11, letterSpacing: 2 }}>PAINEL DE CONTROLE</Text>
          <Text style={{ color: COLORS.bone, fontSize: 22, fontWeight: '500' }}>Administração</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            onPress={() => setSheet({ type: 'confirm', label: `Publicar ${perfumes.filter((p) => p.publicavel !== false).length} contratipo(s) na vitrine?`, onConfirm: doPublish, confirmLabel: publicando ? 'Publicando…' : 'Publicar' })}
            style={styles.topBtn}
            testID="publish-btn"
          >
            <Feather name="share-2" size={13} color={COLORS.gold} />
            <Text style={{ color: COLORS.gold, fontSize: 11, marginLeft: 4 }}>Vitrine</Text>
          </Pressable>
          <Pressable onPress={onSair} style={styles.topBtn} testID="sair-btn">
            <Feather name="log-out" size={13} color={COLORS.muted} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.gold} />}
      >
        {renderContent()}
      </ScrollView>

      {tab !== 'dashboard' && tab !== 'opinioes' && tab !== 'sistema' && (
        <Pressable onPress={openCreate} style={styles.fab} testID="fab-add">
          <Feather name="plus" size={24} color={COLORS.ink} />
        </Pressable>
      )}

      <View style={styles.tabbar}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={styles.tabItem} testID={`tab-${t.id}`}>
              <Feather name={t.icon} size={18} color={active ? COLORS.gold : COLORS.muted} />
              <Text style={{ color: active ? COLORS.gold : COLORS.muted, fontSize: 10, marginTop: 2 }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <BottomSheet visible={!!sheet} onClose={() => setSheet(null)} title={sheetTitle}>
        {sheet?.type === 'perfume' && <PerfumeForm initial={sheet.data} onSave={doSavePerfume} onCancel={() => setSheet(null)} />}
        {sheet?.type === 'movimento' && <MovimentoForm perfumes={perfumes} onSave={doMov} onCancel={() => setSheet(null)} />}
        {sheet?.type === 'pedido' && (
          <PedidoForm
            perfumes={perfumes}
            initial={sheet.data}
            onSave={doSavePedido}
            onCancel={() => setSheet(null)}
            onDelete={requestDeletePedido}
          />
        )}
        {sheet?.type === 'confirm' && (
          <ConfirmSheetContent sheet={sheet} onCancel={() => setSheet(null)} />
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
  screen: { flex: 1, backgroundColor: COLORS.ink },
  topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.md },
  topBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  statCard: { padding: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg },
  statValue: { color: COLORS.bone, fontSize: 24, fontWeight: '500', marginTop: 6 },
  statLabel: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  metricsPanel: { padding: SPACING.md, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.lg },
  metricsRow: { flexDirection: 'row', gap: 12 },
  metricLabel: { color: COLORS.muted, fontSize: 9, letterSpacing: 0.6 },
  metricValue: { color: COLORS.bone, fontSize: 18, fontWeight: '600', marginTop: 3 },
  rankingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rankingNumber: { color: COLORS.gold, width: 22, fontSize: 12, fontWeight: '700' },
  rankingName: { color: COLORS.bone, flex: 1, fontSize: 12 },
  rankingQty: { color: COLORS.muted, fontSize: 11 },
  shippingPanel: { padding: SPACING.md, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.lg },
  shippingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  shippingTitle: { color: COLORS.bone, fontSize: 17, fontWeight: '600', marginTop: -4 },
  shippingStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  shippingStatusDot: { width: 6, height: 6, borderRadius: 3 },
  shippingHint: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginVertical: SPACING.md },
  shippingFields: { flexDirection: 'row', gap: 8 },
  shippingFieldLabel: { color: COLORS.muted, fontSize: 9, letterSpacing: 0.8, marginBottom: 5 },
  shippingSaveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: RADIUS.md, backgroundColor: COLORS.gold, marginTop: SPACING.sm },
  shippingSaveText: { color: COLORS.ink, fontSize: 12, fontWeight: '600' },
  shippingConnectButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginTop: SPACING.sm },
  shippingConnectText: { color: COLORS.gold, fontSize: 12 },
  shippingEnvironment: { color: COLORS.muted, fontSize: 9, textAlign: 'center', marginTop: 8 },
  systemPage: { padding: SPACING.lg },
  systemHero: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.gold + '55', backgroundColor: COLORS.surfaceRaised },
  systemHeroIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.gold + '66', backgroundColor: COLORS.ink },
  systemEyebrow: { color: COLORS.gold, fontSize: 9, letterSpacing: 1.4 },
  systemTitle: { color: COLORS.bone, fontSize: 22, fontWeight: '600', marginTop: 1 },
  systemIntro: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  systemCard: { padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceRaised },
  systemCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: SPACING.md },
  systemCardIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.ink, borderWidth: 1, borderColor: COLORS.border },
  systemCardTitle: { color: COLORS.bone, fontSize: 16, fontWeight: '700' },
  systemCardSubtitle: { color: COLORS.muted, fontSize: 10, lineHeight: 14, marginTop: 2 },
  storePreview: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 104, padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.gold + '55', backgroundColor: COLORS.ink },
  storePreviewVisual: { width: 74, height: 74, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: COLORS.gold + '55', backgroundColor: COLORS.surfaceRaised },
  storePreviewLogo: { width: '100%', height: '100%' },
  storePreviewInitials: { color: COLORS.gold, fontSize: 25, fontWeight: '700', letterSpacing: 1 },
  storePreviewLabel: { color: COLORS.gold, fontSize: 8, letterSpacing: 1.4, marginBottom: 4 },
  storePreviewEyebrow: { color: COLORS.gold, fontSize: 8, letterSpacing: 2.2 },
  storePreviewTitle: { color: COLORS.bone, fontSize: 18, lineHeight: 22, fontWeight: '700', letterSpacing: 0.8 },
  storePreviewHint: { color: COLORS.muted, fontSize: 9, lineHeight: 13, marginTop: 4 },
  systemFieldGrid: { flexDirection: 'row', gap: 8, marginBottom: SPACING.sm },
  systemPriceField: { flex: 1 },
  systemFieldLabel: { color: COLORS.muted, fontSize: 9, letterSpacing: 0.7, marginBottom: 5 },
  systemPrimaryButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12, borderRadius: RADIUS.md, backgroundColor: COLORS.gold, marginTop: SPACING.sm },
  systemPrimaryText: { color: COLORS.ink, fontSize: 12, fontWeight: '700' },
  systemMiniActions: { flexDirection: 'row', gap: 6, marginTop: 7 },
  systemMiniButton: { flex: 1, minHeight: 35, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.ink },
  systemMiniText: { color: COLORS.gold, fontSize: 9, fontWeight: '600', textAlign: 'center' },
  systemAction: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: COLORS.border },
  systemActionTitle: { color: COLORS.bone, fontSize: 12, fontWeight: '600' },
  systemActionSubtitle: { color: COLORS.muted, fontSize: 9, lineHeight: 13, marginTop: 2 },
  systemBadge: { color: COLORS.muted, fontSize: 8, letterSpacing: 0.5, paddingHorizontal: 7, paddingVertical: 4, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border },
  supplierActive: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 4, borderRadius: RADIUS.md, backgroundColor: COLORS.ink, borderWidth: 1, borderColor: COLORS.gold + '44' },
  supplierName: { color: COLORS.bone, fontSize: 13, fontWeight: '700' },
  supplierMeta: { color: COLORS.muted, fontSize: 10, marginTop: 2 },
  connectedPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.sage + '88' },
  connectedPillText: { color: COLORS.sage, fontSize: 8, fontWeight: '700', letterSpacing: 0.6 },
  orderDeliveryCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, backgroundColor: COLORS.ink, marginBottom: SPACING.md },
  orderDeliveryIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  orderDeliveryTitle: { color: COLORS.bone, fontSize: 13, fontWeight: '600' },
  orderDeliveryMeta: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  sectionLabel: { color: COLORS.muted, fontSize: 11, marginBottom: SPACING.sm, letterSpacing: 1 },
  rowCard: { padding: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.sm },
  stockSummary: { padding: SPACING.md, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.md },
  stockSummaryGrid: { flexDirection: 'row', gap: 8 },
  stockSummaryItem: { flex: 1, padding: 10, borderRadius: RADIUS.md, backgroundColor: COLORS.ink, borderWidth: 1, borderColor: COLORS.border },
  stockSummaryValue: { color: COLORS.gold, fontSize: 15, fontWeight: '600' },
  stockSummaryLabel: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  stockSummaryHint: { color: COLORS.muted, fontSize: 10, lineHeight: 15, marginTop: SPACING.sm },
  stockBreakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  stockBreakdownText: { color: COLORS.muted, fontSize: 10 },
  stockAlertRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7 },
  stockAlertText: { color: COLORS.rust, fontSize: 10, flex: 1 },
  swipeOrderHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACING.sm, paddingHorizontal: 2 },
  swipeOrderHintText: { color: COLORS.muted, fontSize: 11, flex: 1 },
  ordersManagement: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceRaised },
  ordersManagementTitle: { color: COLORS.gold, fontSize: 9, letterSpacing: 1.1, marginBottom: 3 },
  ordersManagementText: { color: COLORS.muted, fontSize: 11, lineHeight: 15 },
  resetOrdersButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 11, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.rust + '88', backgroundColor: COLORS.ink },
  resetOrdersText: { color: COLORS.rust, fontSize: 10, fontWeight: '700' },
  orderToolbar: { marginBottom: SPACING.md, gap: SPACING.sm },
  orderViewToggle: { flexDirection: 'row', alignSelf: 'flex-start', padding: 3, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.ink },
  orderViewButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 13, borderRadius: RADIUS.pill },
  orderViewButtonActive: { backgroundColor: COLORS.gold },
  orderViewText: { color: COLORS.muted, fontSize: 11, fontWeight: '600' },
  orderSearchBox: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44, paddingHorizontal: 13, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  orderSearchInput: { flex: 1, color: COLORS.bone, fontSize: 13, paddingVertical: 11 },
  kanbanHint: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: SPACING.sm, paddingHorizontal: 2 },
  kanbanHintText: { flex: 1, color: COLORS.muted, fontSize: 11, lineHeight: 15 },
  kanbanBoard: { gap: SPACING.sm, paddingBottom: SPACING.sm, paddingRight: SPACING.lg },
  kanbanColumn: { padding: 10, alignSelf: 'flex-start', borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceRaised },
  kanbanColumnHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 2 },
  kanbanColumnTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 },
  kanbanStatusDot: { width: 8, height: 8, borderRadius: 4 },
  kanbanColumnTitle: { color: COLORS.bone, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  kanbanCount: { minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.ink },
  kanbanCountText: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  kanbanEmpty: { minHeight: 98, alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.border, backgroundColor: COLORS.ink },
  kanbanEmptyText: { color: COLORS.muted, fontSize: 11, textAlign: 'center' },
  kanbanCard: { marginBottom: 8, padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  kanbanCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kanbanOrderNumber: { color: COLORS.gold, fontSize: 9, letterSpacing: 0.6, fontWeight: '700' },
  kanbanOrderDate: { color: COLORS.muted, fontSize: 9 },
  kanbanCustomer: { color: COLORS.bone, fontSize: 14, fontWeight: '600', marginTop: 5 },
  kanbanOrderMeta: { color: COLORS.bone, fontSize: 11, marginTop: 4 },
  kanbanContact: { color: COLORS.muted, fontSize: 10, marginTop: 3 },
  kanbanCardActions: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10, paddingTop: 9, borderTopWidth: 1, borderTopColor: COLORS.border },
  kanbanMoveButton: { width: 34, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.ink },
  kanbanMoveDisabled: { opacity: 0.45 },
  kanbanEditButton: { flex: 1, minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, borderWidth: 1, borderColor: COLORS.gold + '66', backgroundColor: COLORS.ink },
  kanbanEditText: { color: COLORS.gold, fontSize: 10, fontWeight: '600' },
  cancelledOrders: { marginTop: SPACING.lg },
  cancelledOrderCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, marginBottom: 7, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.rust + '55', backgroundColor: COLORS.surface },
  cancelledOrderCustomer: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  swipeOrderWrap: { position: 'relative', marginBottom: SPACING.sm, borderRadius: RADIUS.lg, overflow: 'hidden', backgroundColor: COLORS.surfaceRaised },
  swipeOrderActions: { position: 'absolute', top: 0, right: 0, bottom: 0, width: ORDER_ACTIONS_WIDTH, flexDirection: 'row' },
  swipeOrderAction: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 },
  swipeOrderEdit: { backgroundColor: COLORS.gold },
  swipeOrderDelete: { backgroundColor: COLORS.rust },
  swipeOrderActionPressed: { opacity: 0.82 },
  swipeOrderEditText: { color: COLORS.ink, fontSize: 11, fontWeight: '700' },
  swipeOrderDeleteText: { color: COLORS.bone, fontSize: 11, fontWeight: '700' },
  swipeOrderFront: { backgroundColor: COLORS.surface },
  swipeOrderCard: { padding: SPACING.md, minHeight: 88, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, justifyContent: 'center' },
  deleteSafetyNotice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, marginBottom: SPACING.md, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.ink },
  deleteSafetyText: { color: COLORS.muted, fontSize: 11, lineHeight: 16, flex: 1 },
  confirmAction: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  confirmActionDisabled: { opacity: 0.45 },
  perfumeCard: { flexDirection: 'row', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.sm, overflow: 'hidden' },
  catalogThumb: { width: 84, minHeight: 126, backgroundColor: COLORS.ink },
  catalogThumbPlaceholder: { width: 84, minHeight: 126, backgroundColor: COLORS.ink, alignItems: 'center', justifyContent: 'center' },
  imagePreview: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginTop: -6, marginBottom: SPACING.md, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.ink },
  imagePreviewPhoto: { width: 64, height: 64, borderRadius: 8, backgroundColor: COLORS.surface },
  imagePreviewText: { color: COLORS.muted, fontSize: 12 },
  orderChoiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: SPACING.md, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border },
  orderChoiceLabel: { color: COLORS.muted, fontSize: 9, letterSpacing: 0.8, marginBottom: 3 },
  orderChoiceValue: { color: COLORS.gold, fontSize: 15, fontWeight: '600' },
  orderQuantity: { minWidth: 76, alignItems: 'center', paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: COLORS.border },
  orderQuantityValue: { color: COLORS.bone, fontSize: 17, fontWeight: '600' },
  confirmPaymentButton: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.gold },
  confirmPaymentTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '700' },
  confirmPaymentHint: { color: COLORS.ink, opacity: 0.72, fontSize: 10, marginTop: 2 },
  cancelAdminOrderButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.rust + '80' },
  cancelAdminOrderText: { color: COLORS.rust, fontSize: 12, fontWeight: '700' },
  deleteAdminOrderButton: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, marginTop: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.rust },
  deleteAdminOrderTitle: { color: COLORS.bone, fontSize: 12, fontWeight: '700' },
  deleteAdminOrderHint: { color: COLORS.bone, opacity: 0.78, fontSize: 10, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, backgroundColor: COLORS.ink },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.ink },
  miniChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, flexShrink: 0 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, marginBottom: SPACING.sm },
  searchInput: { flex: 1, color: COLORS.bone, paddingVertical: 10, fontSize: 14 },
  actionBtn: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm, alignItems: 'center' },
  fab: { position: 'absolute', right: 20, bottom: 86, width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8 },
  tabbar: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', paddingBottom: 16, paddingTop: 8, backgroundColor: COLORS.surfaceRaised, borderTopWidth: 1, borderTopColor: COLORS.border },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 4 },
});
