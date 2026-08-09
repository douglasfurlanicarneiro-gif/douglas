import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { AppText as Text } from './Typography';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import { Field, PrimaryButton, SecondaryButton, TInput } from './atoms';
import { COLORS, FONT_SIZES, RADIUS, SPACING, brl } from '../theme';
import {
  ApiError,
  archiveInsumo,
  compareFornecedores,
  createCotacao,
  createFornecedor,
  createInsumo,
  getCustosConfig,
  getRentabilidade,
  listCotacoes,
  listFornecedores,
  listInsumos,
  moveInsumo,
  registerProducao,
  simulateProducao,
  updateCustosConfig,
  updateInsumo,
} from '../api';
import type {
  CotacaoFornecedor,
  CustosConfig,
  Fornecedor,
  Insumo,
  Perfume,
  PlanoProducao,
  RentabilidadeItem,
} from '../types';

const DEFAULT_COSTS: CustosConfig = {
  custoBasePorMl: 0,
  custoValvula: 0,
  custoTampa: 0,
  custoEtiqueta: 0,
  custoEmbalagem: 0,
  outrosPorFrasco: 0,
  taxaPagamentoPercentual: 0,
  concentracaoPadraoPercentual: 25,
  frascos: { '30': 0, '50': 0, '100': 0 },
};

const INSUMO_CATEGORIES: { id: Insumo['categoria']; label: string; unit: Insumo['unidade'] }[] = [
  { id: 'essencia', label: 'Essência', unit: 'ml' },
  { id: 'base', label: 'Base', unit: 'ml' },
  { id: 'frasco', label: 'Frasco', unit: 'un' },
  { id: 'valvula', label: 'Válvula', unit: 'un' },
  { id: 'tampa', label: 'Tampa', unit: 'un' },
  { id: 'etiqueta', label: 'Etiqueta', unit: 'un' },
  { id: 'embalagem', label: 'Embalagem', unit: 'un' },
  { id: 'outro', label: 'Outro', unit: 'un' },
];

function parseNumber(value: string) {
  const normalized = value.replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function InlineNotice({ text, error }: { text: string; error?: boolean }) {
  if (!text) return null;
  return (
    <View style={[styles.notice, error && styles.noticeError]}>
      <Feather name={error ? 'alert-triangle' : 'check-circle'} size={14} color={error ? COLORS.rust : COLORS.sage} />
      <Text style={[styles.noticeText, error && { color: COLORS.rust }]}>{text}</Text>
    </View>
  );
}

function Card({
  title,
  subtitle,
  icon,
  children,
  collapsible = false,
  collapsed = false,
  onToggle,
}: {
  title: string;
  subtitle?: string;
  icon: any;
  children: React.ReactNode;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const header = (
    <View style={[styles.cardHeader, collapsed && styles.cardHeaderCollapsed]}>
      <View style={styles.cardIcon}><Feather name={icon} size={16} color={COLORS.gold} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
      </View>
      {collapsible && <Feather name={collapsed ? 'chevron-down' : 'chevron-up'} size={20} color={COLORS.gold} />}
    </View>
  );

  return (
    <View style={styles.card}>
      {collapsible ? (
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: !collapsed }}>
          {header}
        </Pressable>
      ) : header}
      {!collapsed && children}
    </View>
  );
}

function MiniStat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniStatLabel}>{label}</Text>
      <Text style={[styles.miniStatValue, emphasis && { color: COLORS.sage }]}>{value}</Text>
    </View>
  );
}

export function CustosView({ onChanged }: { onChanged?: () => void }) {
  const [config, setConfig] = useState<CustosConfig>(DEFAULT_COSTS);
  const [items, setItems] = useState<RentabilidadeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [profitabilityOpen, setProfitabilityOpen] = useState(false);
  const [expandedPerfumeId, setExpandedPerfumeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [costs, profitability] = await Promise.all([getCustosConfig(), getRentabilidade()]);
      setConfig(costs);
      setItems(profitability.itens);
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar os custos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const saved = await updateCustosConfig(config);
      setConfig(saved);
      setMessage('Custos globais atualizados. O dashboard já usa os novos valores.');
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar os custos.');
    } finally {
      setSaving(false);
    }
  };

  const configured = items.filter((item) => item.custoConfigurado);
  const missing = new Set(items.filter((item) => !item.custoConfigurado).map((item) => item.perfumeId)).size;
  const avgMargin = configured.length
    ? configured.reduce((sum, item) => sum + item.margemPercentual, 0) / configured.length
    : 0;
  const profitabilityGroups = Object.values(
    configured.reduce<Record<string, { perfumeId: string; nome: string; frascos: RentabilidadeItem[] }>>((groups, item) => {
      if (!groups[item.perfumeId]) {
        groups[item.perfumeId] = { perfumeId: item.perfumeId, nome: item.nome, frascos: [] };
      }
      groups[item.perfumeId].frascos.push(item);
      return groups;
    }, {}),
  )
    .map((group) => ({ ...group, frascos: [...group.frascos].sort((a, b) => b.ml - a.ml) }))
    .sort((a, b) => Math.max(...b.frascos.map((item) => item.lucro)) - Math.max(...a.frascos.map((item) => item.lucro)));

  if (loading) return <ActivityIndicator color={COLORS.gold} style={{ margin: SPACING.xl }} />;

  const setField = (key: keyof CustosConfig, value: string) => {
    setConfig((current) => ({ ...current, [key]: parseNumber(value) }));
  };
  const setBottle = (ml: string, value: string) => {
    setConfig((current) => ({ ...current, frascos: { ...current.frascos, [ml]: parseNumber(value) } }));
  };

  return (
    <View style={styles.page}>
      <InlineNotice text={message} />
      <InlineNotice text={error} error />
      <View style={styles.statsRow}>
        <MiniStat label="Perfumes com custo" value={String(new Set(configured.map((item) => item.perfumeId)).size)} />
        <MiniStat label="Faltando custo" value={String(missing)} />
        <MiniStat label="Margem média" value={`${avgMargin.toFixed(1)}%`} emphasis />
      </View>

      <Card title="Custos globais" subtitle="Componentes aplicados a todos os frascos." icon="dollar-sign">
        <View style={styles.fieldGrid}>
          <View style={styles.fieldHalf}><Field label="Base por ml (R$)"><TInput keyboardType="decimal-pad" value={String(config.custoBasePorMl).replace('.', ',')} onChangeText={(v) => setField('custoBasePorMl', v)} /></Field></View>
          <View style={styles.fieldHalf}><Field label="Taxa pagamento (%)"><TInput keyboardType="decimal-pad" value={String(config.taxaPagamentoPercentual).replace('.', ',')} onChangeText={(v) => setField('taxaPagamentoPercentual', v)} /></Field></View>
          <View style={styles.fieldHalf}><Field label="Válvula (R$)"><TInput keyboardType="decimal-pad" value={String(config.custoValvula).replace('.', ',')} onChangeText={(v) => setField('custoValvula', v)} /></Field></View>
          <View style={styles.fieldHalf}><Field label="Tampa (R$)"><TInput keyboardType="decimal-pad" value={String(config.custoTampa).replace('.', ',')} onChangeText={(v) => setField('custoTampa', v)} /></Field></View>
          <View style={styles.fieldHalf}><Field label="Etiqueta (R$)"><TInput keyboardType="decimal-pad" value={String(config.custoEtiqueta).replace('.', ',')} onChangeText={(v) => setField('custoEtiqueta', v)} /></Field></View>
          <View style={styles.fieldHalf}><Field label="Embalagem (R$)"><TInput keyboardType="decimal-pad" value={String(config.custoEmbalagem).replace('.', ',')} onChangeText={(v) => setField('custoEmbalagem', v)} /></Field></View>
          <View style={styles.fieldHalf}><Field label="Outros / frasco (R$)"><TInput keyboardType="decimal-pad" value={String(config.outrosPorFrasco).replace('.', ',')} onChangeText={(v) => setField('outrosPorFrasco', v)} /></Field></View>
          <View style={styles.fieldHalf}><Field label="Concentração padrão (%)"><TInput keyboardType="decimal-pad" value={String(config.concentracaoPadraoPercentual).replace('.', ',')} onChangeText={(v) => setField('concentracaoPadraoPercentual', v)} /></Field></View>
        </View>
        <Text style={styles.sectionCaption}>CUSTO DO FRASCO POR TAMANHO</Text>
        <View style={styles.fieldGrid}>
          {['30', '50', '100'].map((ml) => (
            <View style={styles.fieldThird} key={ml}>
              <Field label={`${ml} ml`}><TInput keyboardType="decimal-pad" value={String(config.frascos[ml] || 0).replace('.', ',')} onChangeText={(v) => setBottle(ml, v)} /></Field>
            </View>
          ))}
        </View>
        <PrimaryButton label={saving ? 'Salvando…' : 'Salvar custos globais'} onPress={() => void save()} disabled={saving} />
        <Text style={styles.helper}>O custo da essência e a concentração individual ficam no cadastro de cada perfume.</Text>
      </Card>

      <Card
        title="Rentabilidade por frasco"
        subtitle="Estimativa com a configuração atual; pedidos novos congelam o custo no momento da venda."
        icon="trending-up"
        collapsible
        collapsed={!profitabilityOpen}
        onToggle={() => setProfitabilityOpen((open) => !open)}
      >
        {profitabilityGroups.length === 0 ? (
          <Text style={styles.emptyText}>Cadastre o custo da essência em um perfume para começar a calcular lucro.</Text>
        ) : profitabilityGroups.map((group) => {
          const expanded = expandedPerfumeId === group.perfumeId;
          return (
            <View key={group.perfumeId} style={styles.perfumeGroup}>
              <Pressable
                onPress={() => setExpandedPerfumeId(expanded ? null : group.perfumeId)}
                style={[styles.perfumeHeader, expanded && styles.perfumeHeaderExpanded]}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{group.nome}</Text>
                  <Text style={styles.rowMeta}>{group.frascos.length} {group.frascos.length === 1 ? 'frasco' : 'frascos'}</Text>
                </View>
                <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.gold} />
              </Pressable>
              {expanded && group.frascos.map((item) => (
                <View key={`${item.perfumeId}-${item.ml}`} style={styles.bottleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.ml} ml</Text>
                    <Text style={styles.rowMeta}>Venda {brl(item.preco)} · Custo {brl(item.custoTotal)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.profit}>{brl(item.lucro)}</Text>
                    <Text style={styles.rowMeta}>{item.margemPercentual.toFixed(1)}%</Text>
                  </View>
                </View>
              ))}
            </View>
          );
        })}
      </Card>
    </View>
  );
}

export function InsumosView({ perfumes, onChanged }: { perfumes: Perfume[]; onChanged?: () => void }) {
  const [items, setItems] = useState<Insumo[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    nome: '', categoria: 'essencia' as Insumo['categoria'], unidade: 'ml' as Insumo['unidade'], custoUnitario: '0', estoqueMinimo: '0', estoqueInicial: '0', tamanhoMl: '30', perfumeId: '', observacoes: '',
  });
  const [perfumeSearch, setPerfumeSearch] = useState('');
  const [movement, setMovement] = useState<{ id: string; name: string; type: 'entrada' | 'saida' } | null>(null);
  const [movementQty, setMovementQty] = useState('');
  const [editing, setEditing] = useState<Insumo | null>(null);
  const [editForm, setEditForm] = useState({ nome: '', custoUnitario: '0', estoqueMinimo: '0', tamanhoMl: '30', perfumeId: '', observacoes: '' });
  const [editPerfumeSearch, setEditPerfumeSearch] = useState('');
  const [archiveCandidate, setArchiveCandidate] = useState<Insumo | null>(null);
  const [productionSearch, setProductionSearch] = useState('');
  const [productionPerfumeId, setProductionPerfumeId] = useState('');
  const [productionMl, setProductionMl] = useState('30');
  const [productionQty, setProductionQty] = useState('1');
  const [plan, setPlan] = useState<PlanoProducao | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listInsumos());
      setError('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar os insumos.');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const matchingPerfumes = useMemo(() => {
    const q = perfumeSearch.trim().toLowerCase();
    if (!q) return [];
    return perfumes.filter((p) => p.nome.toLowerCase().includes(q)).slice(0, 8);
  }, [perfumeSearch, perfumes]);
  const editMatchingPerfumes = useMemo(() => {
    const q = editPerfumeSearch.trim().toLowerCase();
    if (!q) return [];
    return perfumes.filter((p) => p.nome.toLowerCase().includes(q)).slice(0, 8);
  }, [editPerfumeSearch, perfumes]);
  const productionMatches = useMemo(() => {
    const q = productionSearch.trim().toLowerCase();
    if (!q) return [];
    return perfumes.filter((p) => p.nome.toLowerCase().includes(q)).slice(0, 8);
  }, [productionSearch, perfumes]);

  const chooseCategory = (category: Insumo['categoria']) => {
    const def = INSUMO_CATEGORIES.find((item) => item.id === category)!;
    setForm((current) => ({ ...current, categoria: category, unidade: def.unit }));
  };

  const add = async () => {
    if (!form.nome.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await createInsumo({
        nome: form.nome.trim(), categoria: form.categoria, unidade: form.unidade,
        custoUnitario: parseNumber(form.custoUnitario), estoqueMinimo: parseNumber(form.estoqueMinimo), estoqueInicial: parseNumber(form.estoqueInicial),
        perfumeId: form.perfumeId || null, tamanhoMl: form.categoria === 'frasco' ? Math.max(1, Number(form.tamanhoMl) || 30) : null,
        fornecedorId: null, observacoes: form.observacoes, ativo: true,
      });
      setMessage('Insumo cadastrado e estoque inicial registrado.');
      setForm((current) => ({ ...current, nome: '', estoqueInicial: '0', estoqueMinimo: '0', custoUnitario: '0', perfumeId: '', observacoes: '' }));
      setPerfumeSearch('');
      await load(); onChanged?.();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Não foi possível cadastrar o insumo.'); }
    finally { setBusy(false); }
  };

  const applyMovement = async () => {
    if (!movement || parseNumber(movementQty) <= 0) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await moveInsumo(movement.id, { tipo: movement.type, quantidade: parseNumber(movementQty), motivo: movement.type === 'entrada' ? 'Reposição de matéria-prima' : 'Ajuste de matéria-prima' });
      setMessage(`${movement.type === 'entrada' ? 'Entrada' : 'Saída'} registrada para ${movement.name}.`);
      setMovement(null); setMovementQty(''); await load(); onChanged?.();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Não foi possível movimentar o insumo.'); }
    finally { setBusy(false); }
  };

  const beginEdit = (item: Insumo) => {
    const linkedPerfume = item.perfumeId ? perfumes.find((p) => p.id === item.perfumeId) : undefined;
    setEditing(item);
    setEditForm({
      nome: item.nome,
      custoUnitario: String(item.custoUnitario ?? 0).replace('.', ','),
      estoqueMinimo: String(item.estoqueMinimo ?? 0).replace('.', ','),
      tamanhoMl: String(item.tamanhoMl || 30),
      perfumeId: item.perfumeId || '',
      observacoes: item.observacoes || '',
    });
    setEditPerfumeSearch(linkedPerfume?.nome || '');
    setArchiveCandidate(null);
    setMovement(null);
    setMessage(''); setError('');
  };

  const saveEdit = async () => {
    if (!editing || !editForm.nome.trim()) return;
    if (editing.categoria === 'essencia' && !editForm.perfumeId) {
      setError('Vincule a essência a um perfume antes de salvar.');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      await updateInsumo(editing.id, {
        nome: editForm.nome.trim(),
        categoria: editing.categoria,
        unidade: editing.unidade,
        custoUnitario: parseNumber(editForm.custoUnitario),
        estoqueMinimo: parseNumber(editForm.estoqueMinimo),
        fornecedorId: editing.fornecedorId || null,
        perfumeId: editing.categoria === 'essencia' ? (editForm.perfumeId || null) : (editing.perfumeId || null),
        tamanhoMl: editing.categoria === 'frasco' ? Math.max(1, Number(editForm.tamanhoMl) || 30) : (editing.tamanhoMl || null),
        observacoes: editForm.observacoes,
        ativo: true,
      });
      setMessage(`${editForm.nome.trim()} atualizado.`);
      setEditing(null); setEditPerfumeSearch('');
      await load(); onChanged?.();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Não foi possível atualizar o insumo.'); }
    finally { setBusy(false); }
  };

  const archive = async (item: Insumo) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await archiveInsumo(item.id);
      setMessage(`${item.nome} arquivado. O histórico de estoque foi preservado.`);
      setArchiveCandidate(null);
      if (editing?.id === item.id) setEditing(null);
      await load(); onChanged?.();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Não foi possível arquivar o insumo.'); }
    finally { setBusy(false); }
  };

  const restore = async (item: Insumo) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await updateInsumo(item.id, {
        nome: item.nome, categoria: item.categoria, unidade: item.unidade,
        custoUnitario: item.custoUnitario, estoqueMinimo: item.estoqueMinimo,
        fornecedorId: item.fornecedorId || null, perfumeId: item.perfumeId || null,
        tamanhoMl: item.tamanhoMl || null, observacoes: item.observacoes || '', ativo: true,
      });
      setMessage(`${item.nome} restaurado.`);
      await load(); onChanged?.();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Não foi possível restaurar o insumo.'); }
    finally { setBusy(false); }
  };

  const simulate = async () => {
    if (!productionPerfumeId) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await simulateProducao({ perfumeId: productionPerfumeId, ml: Math.max(1, Number(productionMl) || 30), quantidade: Math.max(1, Number(productionQty) || 1) });
      setPlan(result);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Não foi possível simular a produção.'); }
    finally { setBusy(false); }
  };

  const produce = async () => {
    if (!productionPerfumeId || !plan?.podeProduzir) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await registerProducao({ perfumeId: productionPerfumeId, ml: Math.max(1, Number(productionMl) || 30), quantidade: Math.max(1, Number(productionQty) || 1) });
      setPlan(result); setMessage(`Produção registrada: ${result.quantidade} frasco(s), ${result.volumeTotalMl} ml adicionados ao estoque comercial.`);
      await load(); onChanged?.();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Não foi possível registrar a produção.'); }
    finally { setBusy(false); }
  };

  const totalValue = items.reduce((sum, item) => sum + item.valorEstoque, 0);
  const below = items.filter((item) => item.ativo && item.saldoAtual <= item.estoqueMinimo).length;

  if (loading) return <ActivityIndicator color={COLORS.gold} style={{ margin: SPACING.xl }} />;
  return (
    <View style={styles.page}>
      <InlineNotice text={message} /><InlineNotice text={error} error />
      <View style={styles.statsRow}>
        <MiniStat label="Insumos ativos" value={String(items.filter((item) => item.ativo).length)} />
        <MiniStat label="Abaixo do mínimo" value={String(below)} />
        <MiniStat label="Valor em estoque" value={brl(totalValue)} />
      </View>

      <Card title="Novo insumo" subtitle="Essência, base, frascos e materiais de acabamento." icon="package">
        <Text style={styles.sectionCaption}>CATEGORIA</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {INSUMO_CATEGORIES.map((category) => (
            <Pressable key={category.id} onPress={() => chooseCategory(category.id)} style={[styles.chip, form.categoria === category.id && styles.chipActive]}>
              <Text style={[styles.chipText, form.categoria === category.id && styles.chipTextActive]}>{category.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Field label="Nome"><TInput value={form.nome} onChangeText={(nome) => setForm((c) => ({ ...c, nome }))} placeholder="Ex.: Essência Vibrato 400123" /></Field>
        {form.categoria === 'essencia' && (
          <>
            <Field label="Vincular a um perfume"><TInput value={perfumeSearch} onChangeText={(v) => { setPerfumeSearch(v); setForm((c) => ({ ...c, perfumeId: '' })); }} placeholder="Digite o nome do perfume" /></Field>
            {matchingPerfumes.map((p) => (
              <Pressable key={p.id} onPress={() => { setForm((c) => ({ ...c, perfumeId: p.id })); setPerfumeSearch(p.nome); }} style={[styles.searchOption, form.perfumeId === p.id && styles.searchOptionActive]}>
                <Text style={styles.searchOptionText}>{p.nome}</Text>
              </Pressable>
            ))}
          </>
        )}
        <View style={styles.fieldGrid}>
          <View style={styles.fieldHalf}><Field label={`Custo por ${form.unidade} (R$)`}><TInput keyboardType="decimal-pad" value={form.custoUnitario} onChangeText={(v) => setForm((c) => ({ ...c, custoUnitario: v }))} /></Field></View>
          <View style={styles.fieldHalf}><Field label={`Estoque inicial (${form.unidade})`}><TInput keyboardType="decimal-pad" value={form.estoqueInicial} onChangeText={(v) => setForm((c) => ({ ...c, estoqueInicial: v }))} /></Field></View>
          <View style={styles.fieldHalf}><Field label={`Estoque mínimo (${form.unidade})`}><TInput keyboardType="decimal-pad" value={form.estoqueMinimo} onChangeText={(v) => setForm((c) => ({ ...c, estoqueMinimo: v }))} /></Field></View>
          {form.categoria === 'frasco' && <View style={styles.fieldHalf}><Field label="Tamanho do frasco (ml)"><TInput keyboardType="numeric" value={form.tamanhoMl} onChangeText={(v) => setForm((c) => ({ ...c, tamanhoMl: v }))} /></Field></View>}
        </View>
        <PrimaryButton label={busy ? 'Salvando…' : 'Cadastrar insumo'} onPress={() => void add()} disabled={busy || !form.nome.trim() || (form.categoria === 'essencia' && !form.perfumeId)} />
      </Card>

      <Card title="Matérias-primas" subtitle="Saldo por movimentação; custos e cadastros podem ser editados sem alterar o histórico." icon="layers">
        {items.filter((item) => item.ativo).length === 0 && <Text style={styles.emptyText}>Nenhum insumo ativo cadastrado.</Text>}
        {items.filter((item) => item.ativo).map((item) => {
          const low = item.saldoAtual <= item.estoqueMinimo;
          return (
            <React.Fragment key={item.id}>
              <View style={styles.inventoryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.nome}</Text>
                  <Text style={styles.rowMeta}>{item.categoria} · custo {brl(item.custoUnitario)}/{item.unidade} · mínimo {item.estoqueMinimo.toLocaleString('pt-BR')} {item.unidade}</Text>
                  <Text style={[styles.stockValue, low && { color: COLORS.rust }]}>{item.saldoAtual.toLocaleString('pt-BR')} {item.unidade}{low ? ' · REPOSIÇÃO' : ''}</Text>
                </View>
                <View style={styles.inventoryActions}>
                  <Pressable accessibilityLabel={`Editar ${item.nome}`} style={styles.smallAction} onPress={() => beginEdit(item)}><Feather name="edit-2" size={14} color={COLORS.gold} /></Pressable>
                  <Pressable accessibilityLabel={`Entrada em ${item.nome}`} style={styles.smallAction} onPress={() => { setMovement({ id: item.id, name: item.nome, type: 'entrada' }); setMovementQty(''); setEditing(null); setArchiveCandidate(null); }}><Feather name="plus" size={14} color={COLORS.sage} /></Pressable>
                  <Pressable accessibilityLabel={`Saída de ${item.nome}`} style={styles.smallAction} onPress={() => { setMovement({ id: item.id, name: item.nome, type: 'saida' }); setMovementQty(''); setEditing(null); setArchiveCandidate(null); }}><Feather name="minus" size={14} color={COLORS.rust} /></Pressable>
                  <Pressable accessibilityLabel={`Arquivar ${item.nome}`} style={styles.smallAction} onPress={() => { setArchiveCandidate(item); setEditing(null); setMovement(null); }}><Feather name="archive" size={14} color={COLORS.muted} /></Pressable>
                </View>
              </View>

              {editing?.id === item.id && (
                <View style={styles.inlineForm}>
                  <View style={styles.inlineHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>Editar · {item.nome}</Text>
                      <Text style={styles.rowMeta}>Categoria: {item.categoria} · saldo atual preservado: {item.saldoAtual.toLocaleString('pt-BR')} {item.unidade}</Text>
                    </View>
                    <Feather name="edit-3" size={16} color={COLORS.gold} />
                  </View>
                  <Field label="Nome"><TInput value={editForm.nome} onChangeText={(nome) => setEditForm((c) => ({ ...c, nome }))} /></Field>
                  {item.categoria === 'essencia' && (
                    <>
                      <Field label="Vincular a um perfume"><TInput value={editPerfumeSearch} onChangeText={(v) => { setEditPerfumeSearch(v); setEditForm((c) => ({ ...c, perfumeId: '' })); }} placeholder="Digite o nome do perfume" /></Field>
                      {editMatchingPerfumes.map((p) => (
                        <Pressable key={p.id} onPress={() => { setEditForm((c) => ({ ...c, perfumeId: p.id })); setEditPerfumeSearch(p.nome); }} style={[styles.searchOption, editForm.perfumeId === p.id && styles.searchOptionActive]}>
                          <Text style={styles.searchOptionText}>{p.nome}</Text>
                        </Pressable>
                      ))}
                    </>
                  )}
                  <View style={styles.fieldGrid}>
                    <View style={styles.fieldHalf}><Field label={`Custo por ${item.unidade} (R$)`}><TInput keyboardType="decimal-pad" value={editForm.custoUnitario} onChangeText={(v) => setEditForm((c) => ({ ...c, custoUnitario: v }))} /></Field></View>
                    <View style={styles.fieldHalf}><Field label={`Estoque mínimo (${item.unidade})`}><TInput keyboardType="decimal-pad" value={editForm.estoqueMinimo} onChangeText={(v) => setEditForm((c) => ({ ...c, estoqueMinimo: v }))} /></Field></View>
                    {item.categoria === 'frasco' && <View style={styles.fieldHalf}><Field label="Tamanho do frasco (ml)"><TInput keyboardType="numeric" value={editForm.tamanhoMl} onChangeText={(v) => setEditForm((c) => ({ ...c, tamanhoMl: v }))} /></Field></View>}
                  </View>
                  <Field label="Observações"><TInput value={editForm.observacoes} onChangeText={(observacoes) => setEditForm((c) => ({ ...c, observacoes }))} placeholder="Código do fornecedor, lote, observações…" /></Field>
                  <Text style={styles.helper}>O saldo não é editado aqui. Para corrigir ou repor quantidade, use os botões + e − para manter o histórico.</Text>
                  <View style={styles.buttonRow}><SecondaryButton label="Cancelar" onPress={() => { setEditing(null); setEditPerfumeSearch(''); }} /><PrimaryButton label={busy ? 'Salvando…' : 'Salvar alterações'} onPress={() => void saveEdit()} disabled={busy || !editForm.nome.trim() || (item.categoria === 'essencia' && !editForm.perfumeId)} /></View>
                </View>
              )}

              {archiveCandidate?.id === item.id && (
                <View style={styles.archiveConfirm}>
                  <Feather name="alert-circle" size={17} color={COLORS.rust} />
                  <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Arquivar {item.nome}?</Text><Text style={styles.rowMeta}>Ele sairá da lista ativa, mas movimentações e saldo histórico serão preservados.</Text></View>
                  <View style={styles.buttonRow}><SecondaryButton label="Cancelar" onPress={() => setArchiveCandidate(null)} /><PrimaryButton label={busy ? 'Arquivando…' : 'Arquivar'} onPress={() => void archive(item)} disabled={busy} /></View>
                </View>
              )}
            </React.Fragment>
          );
        })}
        {movement && (
          <View style={styles.inlineForm}>
            <Text style={styles.rowTitle}>{movement.type === 'entrada' ? 'Entrada' : 'Saída'} · {movement.name}</Text>
            <TInput keyboardType="decimal-pad" value={movementQty} onChangeText={setMovementQty} placeholder="Quantidade" />
            <View style={styles.buttonRow}><SecondaryButton label="Cancelar" onPress={() => setMovement(null)} /><PrimaryButton label="Registrar" onPress={() => void applyMovement()} disabled={busy || parseNumber(movementQty) <= 0} /></View>
          </View>
        )}
        {items.some((item) => !item.ativo) && (
          <View style={styles.archivedSection}>
            <Text style={styles.sectionCaption}>ARQUIVADOS</Text>
            {items.filter((item) => !item.ativo).map((item) => (
              <View key={item.id} style={styles.archivedRow}>
                <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.nome}</Text><Text style={styles.rowMeta}>{item.categoria} · saldo histórico {item.saldoAtual.toLocaleString('pt-BR')} {item.unidade}</Text></View>
                <Pressable accessibilityLabel={`Restaurar ${item.nome}`} style={styles.restoreAction} onPress={() => void restore(item)} disabled={busy}><Feather name="rotate-ccw" size={14} color={COLORS.sage} /><Text style={styles.restoreText}>Restaurar</Text></Pressable>
              </View>
            ))}
          </View>
        )}
      </Card>

      <Card title="Ordem de produção" subtitle="Simula consumo e custo antes de baixar matéria-prima." icon="tool">
        <Field label="Perfume"><TInput value={productionSearch} onChangeText={(v) => { setProductionSearch(v); setProductionPerfumeId(''); setPlan(null); }} placeholder="Buscar perfume" /></Field>
        {productionMatches.map((p) => (
          <Pressable key={p.id} onPress={() => { setProductionPerfumeId(p.id); setProductionSearch(p.nome); setPlan(null); }} style={[styles.searchOption, productionPerfumeId === p.id && styles.searchOptionActive]}><Text style={styles.searchOptionText}>{p.nome}</Text></Pressable>
        ))}
        <View style={styles.fieldGrid}>
          <View style={styles.fieldHalf}><Field label="Tamanho (ml)"><TInput keyboardType="numeric" value={productionMl} onChangeText={(v) => { setProductionMl(v); setPlan(null); }} /></Field></View>
          <View style={styles.fieldHalf}><Field label="Quantidade de frascos"><TInput keyboardType="numeric" value={productionQty} onChangeText={(v) => { setProductionQty(v); setPlan(null); }} /></Field></View>
        </View>
        <PrimaryButton label={busy ? 'Calculando…' : 'Simular produção'} onPress={() => void simulate()} disabled={busy || !productionPerfumeId} />
        {plan && (
          <View style={styles.productionPlan}>
            <View style={styles.statsRow}>
              <MiniStat label="Volume" value={`${plan.volumeTotalMl} ml`} />
              <MiniStat label="Custo lote" value={brl(plan.custoTotal)} />
              <MiniStat label="Custo / frasco" value={brl(plan.custoPorFrasco)} />
            </View>
            {plan.requisitos.map((req) => (
              <View key={req.insumoId} style={styles.row}>
                <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{req.nome}</Text><Text style={styles.rowMeta}>Precisa {req.necessario} {req.unidade} · tem {req.disponivel} {req.unidade}</Text></View>
                <Feather name={req.suficiente ? 'check-circle' : 'x-circle'} size={17} color={req.suficiente ? COLORS.sage : COLORS.rust} />
              </View>
            ))}
            {plan.faltantesConfiguracao.length > 0 && <InlineNotice error text={`Cadastre antes: ${plan.faltantesConfiguracao.join(', ')}.`} />}
            <PrimaryButton label={busy ? 'Registrando…' : 'Registrar produção e dar baixa'} onPress={() => void produce()} disabled={busy || !plan.podeProduzir} />
          </View>
        )}
      </Card>
    </View>
  );
}

export function FornecedoresView({ perfumes, onChanged }: { perfumes: Perfume[]; onChanged?: () => void }) {
  const [suppliers, setSuppliers] = useState<Fornecedor[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [quotes, setQuotes] = useState<CotacaoFornecedor[]>([]);
  const [comparisons, setComparisons] = useState<CotacaoFornecedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [supplier, setSupplier] = useState({ nome: '', site: '', contato: '', whatsapp: '', email: '', documento: '', pedidoMinimo: '0', prazoDias: '0', observacoes: '' });
  const [quote, setQuote] = useState({ produto: '', codigo: '', quantidade: '50', unidade: 'ml' as 'ml' | 'g' | 'kg' | 'un', precoTotal: '0', frete: '0', link: '', observacoes: '', perfumeId: '', aplicarAoPerfume: true });
  const [perfumeSearch, setPerfumeSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listFornecedores(); setSuppliers(result);
      if (!selected && result.length) setSelected(result[0].id);
      setError('');
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Não foi possível carregar fornecedores.'); }
    finally { setLoading(false); }
  }, [selected]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) { setQuotes([]); return; }
    void listCotacoes(selected).then(setQuotes).catch(() => setQuotes([]));
  }, [selected]);
  useEffect(() => {
    if (!quote.perfumeId) { setComparisons([]); return; }
    void compareFornecedores(quote.perfumeId).then(setComparisons).catch(() => setComparisons([]));
  }, [quote.perfumeId, quotes]);

  const matches = useMemo(() => {
    const q = perfumeSearch.trim().toLowerCase();
    if (!q) return [];
    return perfumes.filter((p) => p.nome.toLowerCase().includes(q)).slice(0, 8);
  }, [perfumeSearch, perfumes]);

  const addSupplier = async () => {
    if (!supplier.nome.trim()) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const created = await createFornecedor({
        nome: supplier.nome.trim(), site: supplier.site.trim(), contato: supplier.contato.trim(), whatsapp: supplier.whatsapp.trim(), email: supplier.email.trim(), documento: supplier.documento.trim(),
        pedidoMinimo: parseNumber(supplier.pedidoMinimo), prazoDias: Math.max(0, Number(supplier.prazoDias) || 0), observacoes: supplier.observacoes.trim(), ativo: true,
      });
      setSupplier({ nome: '', site: '', contato: '', whatsapp: '', email: '', documento: '', pedidoMinimo: '0', prazoDias: '0', observacoes: '' });
      setSelected(created.id); setMessage('Fornecedor cadastrado.'); await load(); onChanged?.();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Não foi possível cadastrar o fornecedor.'); }
    finally { setBusy(false); }
  };

  const addQuote = async () => {
    if (!selected || !quote.produto.trim() || parseNumber(quote.quantidade) <= 0) return;
    setBusy(true); setError(''); setMessage('');
    try {
      await createCotacao(selected, {
        perfumeId: quote.perfumeId || undefined, produto: quote.produto.trim(), codigo: quote.codigo.trim(), quantidade: parseNumber(quote.quantidade), unidade: quote.unidade,
        precoTotal: parseNumber(quote.precoTotal), frete: parseNumber(quote.frete), link: quote.link.trim(), observacoes: quote.observacoes.trim(), aplicarAoPerfume: quote.aplicarAoPerfume,
      });
      setMessage(quote.aplicarAoPerfume && quote.perfumeId ? 'Cotação salva e custo da essência aplicado ao perfume.' : 'Cotação salva no histórico.');
      setQuote((current) => ({ ...current, produto: '', codigo: '', precoTotal: '0', frete: '0', link: '', observacoes: '', perfumeId: '' }));
      setPerfumeSearch(''); setQuotes(await listCotacoes(selected)); await load(); onChanged?.();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a cotação.'); }
    finally { setBusy(false); }
  };

  if (loading) return <ActivityIndicator color={COLORS.gold} style={{ margin: SPACING.xl }} />;
  const selectedSupplier = suppliers.find((item) => item.id === selected);
  return (
    <View style={styles.page}>
      <InlineNotice text={message} /><InlineNotice text={error} error />
      <Card title="Novo fornecedor" subtitle="Contato, condições comerciais e prazo de reposição." icon="briefcase">
        <Field label="Razão/Nome"><TInput value={supplier.nome} onChangeText={(v) => setSupplier((c) => ({ ...c, nome: v }))} placeholder="Ex.: Karph" /></Field>
        <View style={styles.fieldGrid}>
          <View style={styles.fieldHalf}><Field label="WhatsApp"><TInput value={supplier.whatsapp} onChangeText={(v) => setSupplier((c) => ({ ...c, whatsapp: v }))} /></Field></View>
          <View style={styles.fieldHalf}><Field label="E-mail"><TInput value={supplier.email} onChangeText={(v) => setSupplier((c) => ({ ...c, email: v }))} autoCapitalize="none" /></Field></View>
          <View style={styles.fieldHalf}><Field label="Pedido mínimo (R$)"><TInput keyboardType="decimal-pad" value={supplier.pedidoMinimo} onChangeText={(v) => setSupplier((c) => ({ ...c, pedidoMinimo: v }))} /></Field></View>
          <View style={styles.fieldHalf}><Field label="Prazo médio (dias)"><TInput keyboardType="numeric" value={supplier.prazoDias} onChangeText={(v) => setSupplier((c) => ({ ...c, prazoDias: v }))} /></Field></View>
        </View>
        <Field label="Site"><TInput value={supplier.site} onChangeText={(v) => setSupplier((c) => ({ ...c, site: v }))} autoCapitalize="none" /></Field>
        <PrimaryButton label={busy ? 'Salvando…' : 'Cadastrar fornecedor'} onPress={() => void addSupplier()} disabled={busy || !supplier.nome.trim()} />
      </Card>

      <Card title="Fornecedores" subtitle="Selecione um para consultar e registrar cotações." icon="archive">
        {suppliers.length === 0 && <Text style={styles.emptyText}>Nenhum fornecedor cadastrado.</Text>}
        {suppliers.filter((item) => item.ativo).map((item) => (
          <Pressable key={item.id} onPress={() => setSelected(item.id)} style={[styles.supplierRow, selected === item.id && styles.supplierRowActive]}>
            <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.nome}</Text><Text style={styles.rowMeta}>Pedido mín. {brl(item.pedidoMinimo)} · {item.prazoDias || '—'} dias · {item.cotacoes || 0} cotação(ões)</Text></View>
            {selected === item.id && <Feather name="check-circle" size={18} color={COLORS.sage} />}
          </Pressable>
        ))}
      </Card>

      {selectedSupplier && (
        <Card title={`Nova cotação · ${selectedSupplier.nome}`} subtitle="O histórico preserva preço, frete e custo unitário por compra." icon="file-text">
          <Field label="Produto / essência"><TInput value={quote.produto} onChangeText={(v) => setQuote((c) => ({ ...c, produto: v }))} placeholder="Ex.: Essência Vibrato" /></Field>
          <Field label="Vincular ao perfume (opcional)"><TInput value={perfumeSearch} onChangeText={(v) => { setPerfumeSearch(v); setQuote((c) => ({ ...c, perfumeId: '' })); }} placeholder="Buscar perfume" /></Field>
          {matches.map((p) => <Pressable key={p.id} onPress={() => { setQuote((c) => ({ ...c, perfumeId: p.id, produto: c.produto || p.nome })); setPerfumeSearch(p.nome); }} style={[styles.searchOption, quote.perfumeId === p.id && styles.searchOptionActive]}><Text style={styles.searchOptionText}>{p.nome}</Text></Pressable>)}
          {comparisons.length > 0 && (
            <View style={styles.comparisonBox}>
              <Text style={styles.sectionCaption}>COMPARATIVO · ÚLTIMA COTAÇÃO POR FORNECEDOR</Text>
              {comparisons.slice(0, 5).map((item, index) => (
                <View key={`cmp-${item.id}`} style={styles.comparisonRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{index === 0 && item.unidade === 'ml' ? '★ ' : ''}{item.fornecedorNome}</Text>
                    <Text style={styles.rowMeta}>{item.quantidade} {item.unidade} · frete {brl(item.frete)}</Text>
                  </View>
                  <Text style={[styles.profit, index === 0 && item.unidade === 'ml' && { color: COLORS.sage }]}>{brl(item.custoUnitario)}/{item.unidade}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.fieldGrid}>
            <View style={styles.fieldHalf}><Field label="Código"><TInput value={quote.codigo} onChangeText={(v) => setQuote((c) => ({ ...c, codigo: v }))} /></Field></View>
            <View style={styles.fieldHalf}><Field label="Quantidade"><TInput keyboardType="decimal-pad" value={quote.quantidade} onChangeText={(v) => setQuote((c) => ({ ...c, quantidade: v }))} /></Field></View>
            <View style={styles.fieldHalf}>
              <Field label="Unidade">
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {(['ml', 'g', 'kg', 'un'] as const).map((unit) => (
                    <Pressable key={unit} onPress={() => setQuote((c) => ({ ...c, unidade: unit, aplicarAoPerfume: unit === 'ml' ? c.aplicarAoPerfume : false }))} style={[styles.chip, quote.unidade === unit && styles.chipActive]}>
                      <Text style={[styles.chipText, quote.unidade === unit && styles.chipTextActive]}>{unit}</Text>
                    </Pressable>
                  ))}
                </View>
              </Field>
            </View>
            <View style={styles.fieldHalf}><Field label="Preço total (R$)"><TInput keyboardType="decimal-pad" value={quote.precoTotal} onChangeText={(v) => setQuote((c) => ({ ...c, precoTotal: v }))} /></Field></View>
            <View style={styles.fieldHalf}><Field label="Frete (R$)"><TInput keyboardType="decimal-pad" value={quote.frete} onChangeText={(v) => setQuote((c) => ({ ...c, frete: v }))} /></Field></View>
          </View>
          <Pressable onPress={() => setQuote((c) => ({ ...c, aplicarAoPerfume: !c.aplicarAoPerfume }))} style={styles.toggleRow}>
            <View style={[styles.checkbox, quote.aplicarAoPerfume && styles.checkboxActive]}>{quote.aplicarAoPerfume && <Feather name="check" size={12} color={COLORS.ink} />}</View>
            <View style={{ flex: 1 }}><Text style={styles.rowTitle}>Aplicar custo ao perfume</Text><Text style={styles.rowMeta}>Quando a unidade é ml, atualiza automaticamente o custo da essência por ml.</Text></View>
          </Pressable>
          <PrimaryButton label={busy ? 'Salvando…' : 'Salvar cotação'} onPress={() => void addQuote()} disabled={busy || !quote.produto.trim()} />
          {quotes.length > 0 && <Text style={[styles.sectionCaption, { marginTop: SPACING.lg }]}>HISTÓRICO</Text>}
          {quotes.slice(0, 12).map((item) => (
            <View key={item.id} style={styles.row}>
              <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.produto}</Text><Text style={styles.rowMeta}>{item.quantidade} {item.unidade} · {item.perfumeNome || 'sem vínculo'} </Text></View>
              <View style={{ alignItems: 'flex-end' }}><Text style={styles.profit}>{brl(item.custoUnitario)}/{item.unidade}</Text><Text style={styles.rowMeta}>total {brl(item.precoTotal + item.frete)}</Text></View>
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: SPACING.md },
  card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, padding: SPACING.lg, gap: SPACING.sm },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.sm },
  cardHeaderCollapsed: { marginBottom: 0 },
  cardIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceRaised },
  cardTitle: { color: COLORS.bone, fontSize: FONT_SIZES.subtitle, fontWeight: '700' },
  cardSubtitle: { color: COLORS.muted, fontSize: FONT_SIZES.bodySmall, marginTop: 2 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  miniStat: { minWidth: 120, flex: 1, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, padding: SPACING.md },
  miniStatLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  miniStatValue: { color: COLORS.bone, fontSize: FONT_SIZES.heading, fontWeight: '700', marginTop: 3 },
  fieldGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  fieldHalf: { flexGrow: 1, flexBasis: 220 },
  fieldThird: { flexGrow: 1, flexBasis: 120 },
  helper: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: SPACING.sm },
  sectionCaption: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '700', letterSpacing: 1.1, marginBottom: SPACING.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  perfumeGroup: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  perfumeHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.md },
  perfumeHeaderExpanded: { paddingBottom: SPACING.sm },
  bottleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginLeft: SPACING.md, paddingVertical: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  rowTitle: { color: COLORS.bone, fontSize: FONT_SIZES.body, fontWeight: '600' },
  rowMeta: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  profit: { color: COLORS.sage, fontSize: FONT_SIZES.body, fontWeight: '700' },
  emptyText: { color: COLORS.muted, fontSize: FONT_SIZES.bodySmall, paddingVertical: SPACING.md, textAlign: 'center' },
  notice: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', padding: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.sage, borderRadius: RADIUS.md },
  noticeError: { borderColor: COLORS.rust },
  noticeText: { color: COLORS.sage, fontSize: FONT_SIZES.bodySmall, flex: 1 },
  chipRow: { gap: SPACING.sm, paddingBottom: SPACING.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceRaised },
  chipActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  chipText: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  chipTextActive: { color: COLORS.ink, fontWeight: '700' },
  searchOption: { paddingHorizontal: SPACING.md, paddingVertical: 9, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm, marginBottom: 4 },
  searchOptionActive: { borderColor: COLORS.gold, backgroundColor: COLORS.surfaceRaised },
  searchOptionText: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall },
  inventoryRow: { flexDirection: 'row', gap: SPACING.sm, paddingVertical: SPACING.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  inventoryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, alignItems: 'center', justifyContent: 'flex-end' },
  smallAction: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceRaised },
  stockValue: { color: COLORS.sage, fontSize: FONT_SIZES.bodySmall, fontWeight: '700', marginTop: 4 },
  inlineForm: { gap: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceRaised, marginTop: SPACING.sm },
  inlineHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  archiveConfirm: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.rust, backgroundColor: COLORS.surfaceRaised, marginTop: SPACING.sm },
  archivedSection: { marginTop: SPACING.lg, paddingTop: SPACING.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  archivedRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: SPACING.sm, opacity: 0.72 },
  restoreAction: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceRaised },
  restoreText: { color: COLORS.sage, fontSize: FONT_SIZES.caption, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  productionPlan: { marginTop: SPACING.md, gap: SPACING.sm },
  supplierRow: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, marginBottom: SPACING.sm },
  supplierRowActive: { borderColor: COLORS.gold, backgroundColor: COLORS.surfaceRaised },
  comparisonBox: { marginBottom: SPACING.md, padding: SPACING.sm, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  comparisonRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  toggleRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center', paddingVertical: SPACING.sm },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
});
