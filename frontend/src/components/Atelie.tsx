import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, STATUS, FAMILIAS, CONCENTRACOES, brl, fmtDate, padSeq } from '../theme';
import { PyramidBar } from './PyramidBar';
import { BottomSheet } from './BottomSheet';
import { Field, TInput, PrimaryButton, SecondaryButton, EmptyState, Stars } from './atoms';
import {
  listPerfumes, createPerfume, updatePerfume, deletePerfume, bulkImport, padronizarTamanhos,
  listMovimentos, createMovimento, getEstoqueMap,
  listPedidos, createPedido, updatePedido, deletePedido,
  listOpinioes, createOpiniao, deleteOpiniao,
  publishVitrine, listSugestoes, deleteSugestao, listCompras, deleteCompra,
} from '../api';
import { PRESET_FORNECEDOR } from '../data/preset-fornecedor';

type Perfume = any; type Movimento = any; type Pedido = any; type Opiniao = any; type Sugestao = any; type Compra = any;
type SheetType = null | { type: 'perfume'; data?: Perfume } | { type: 'movimento' } | { type: 'pedido'; data?: Pedido }
  | { type: 'opiniao'; data?: Opiniao } | { type: 'confirm'; label: string; onConfirm: () => void; confirmLabel?: string; danger?: boolean }
  | { type: 'info'; label: string };

const TABS = [
  { id: 'dashboard', label: 'Início', icon: 'home' as const },
  { id: 'catalogo', label: 'Catálogo', icon: 'droplet' as const },
  { id: 'estoque', label: 'Estoque', icon: 'package' as const },
  { id: 'pedidos', label: 'Pedidos', icon: 'clipboard' as const },
  { id: 'opinioes', label: 'Opiniões', icon: 'star' as const },
  { id: 'mensagens', label: 'Mensagens', icon: 'inbox' as const },
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

function PerfumeForm({ initial, onSave, onCancel }: any) {
  const [f, setF] = useState<any>(initial || {
    nome: '', inspiracao: '', familia: FAMILIAS[0], concentracao: 'EDP',
    notasSaida: '', notasCoracao: '', notasFundo: '',
    precos: [{ ml: 30, preco: 0 }], estoqueMinimoMl: 100, publicavel: true,
  });
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const setPreco = (i: number, k: string, v: any) => setF((s: any) => ({ ...s, precos: s.precos.map((p: any, idx: number) => idx === i ? { ...p, [k]: v } : p) }));
  const addPreco = () => setF((s: any) => ({ ...s, precos: [...s.precos, { ml: 10, preco: 0 }] }));
  const rmPreco = (i: number) => setF((s: any) => ({ ...s, precos: s.precos.filter((_: any, idx: number) => idx !== i) }));
  return (
    <View>
      <Field label="Nome do contratipo"><TInput value={f.nome} onChangeText={(v) => set('nome', v)} placeholder="Ex: Âmbar Noturno" testID="perfume-nome" /></Field>
      <Field label="Inspirado em"><TInput value={f.inspiracao} onChangeText={(v) => set('inspiracao', v)} placeholder="Ex: Baccarat Rouge 540 - MFK" /></Field>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Field label="Família">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {FAMILIAS.map((fam) => (
                <Pressable key={fam} onPress={() => set('familia', fam)} style={[styles.miniChip, f.familia === fam && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}>
                  <Text style={{ color: f.familia === fam ? COLORS.ink : COLORS.muted, fontSize: 11 }}>{fam}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Field>
        </View>
      </View>
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
        <PrimaryButton label="Salvar" onPress={() => f.nome.trim() && onSave(f)} disabled={!f.nome.trim()} testID="perfume-save" />
      </View>
    </View>
  );
}

function MovimentoForm({ perfumes, onSave, onCancel }: any) {
  const [f, setF] = useState({ perfumeId: perfumes[0]?.id || '', tipo: 'entrada', quantidadeMl: 100, motivo: '' });
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
      <Field label="Tipo">
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {['entrada', 'saida'].map((t) => (
            <Pressable key={t} onPress={() => setF({ ...f, tipo: t })} style={[styles.miniChip, f.tipo === t && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}>
              <Text style={{ color: f.tipo === t ? COLORS.ink : COLORS.muted, fontSize: 11 }}>{t === 'entrada' ? 'Entrada' : 'Saída'}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label="Quantidade (ml)"><TInput keyboardType="numeric" value={String(f.quantidadeMl)} onChangeText={(v) => setF({ ...f, quantidadeMl: Number(v) || 0 })} testID="mov-qtd" /></Field>
      <Field label="Motivo"><TInput value={f.motivo} onChangeText={(v) => setF({ ...f, motivo: v })} placeholder="Ex: compra de insumo" /></Field>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: SPACING.sm }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton label="Lançar" onPress={() => f.perfumeId && f.quantidadeMl > 0 && onSave(f)} testID="mov-save" />
      </View>
    </View>
  );
}

function PedidoForm({ perfumes, initial, onSave, onCancel }: any) {
  const [f, setF] = useState<any>(initial || { cliente: '', contato: '', status: 'pendente', observacoes: '', itens: [] });
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  const addItem = () => {
    if (!perfumes[0]) return;
    setF((s: any) => ({ ...s, itens: [...s.itens, { perfumeId: perfumes[0].id, ml: perfumes[0].precos?.[0]?.ml || 30, quantidade: 1 }] }));
  };
  const setItem = (i: number, k: string, v: any) => setF((s: any) => ({ ...s, itens: s.itens.map((it: any, idx: number) => idx === i ? { ...it, [k]: v } : it) }));
  const rmItem = (i: number) => setF((s: any) => ({ ...s, itens: s.itens.filter((_: any, idx: number) => idx !== i) }));
  const precoDo = (it: any) => {
    const p = perfumes.find((pf: any) => pf.id === it.perfumeId);
    return p?.precos.find((pr: any) => pr.ml === Number(it.ml))?.preco || 0;
  };
  const total = f.itens.reduce((s: number, it: any) => s + precoDo(it) * it.quantidade, 0);
  return (
    <View>
      <Field label="Cliente"><TInput value={f.cliente} onChangeText={(v) => set('cliente', v)} testID="pedido-cliente" /></Field>
      <Field label="Contato (opcional)"><TInput value={f.contato} onChangeText={(v) => set('contato', v)} /></Field>
      <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 6 }}>Itens do pedido</Text>
      {f.itens.map((it: any, i: number) => {
        const p = perfumes.find((pf: any) => pf.id === it.perfumeId);
        return (
          <View key={i} style={{ padding: SPACING.md, backgroundColor: COLORS.ink, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {perfumes.map((p2: any) => (
                    <Pressable key={p2.id} onPress={() => setItem(i, 'perfumeId', p2.id)} style={[styles.miniChip, { flexShrink: 0 }, it.perfumeId === p2.id && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}>
                      <Text style={{ color: it.perfumeId === p2.id ? COLORS.ink : COLORS.muted, fontSize: 11 }} numberOfLines={1}>{p2.nome}</Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <Pressable onPress={() => rmItem(i)} hitSlop={8}><Feather name="x" size={14} color={COLORS.rust} /></Pressable>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {(p?.precos || []).map((pr: any) => (
                <Pressable key={pr.ml} onPress={() => setItem(i, 'ml', pr.ml)} style={[styles.miniChip, Number(it.ml) === pr.ml && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}>
                  <Text style={{ color: Number(it.ml) === pr.ml ? COLORS.ink : COLORS.muted, fontSize: 11 }}>{pr.ml}ml · {brl(pr.preco)}</Text>
                </Pressable>
              ))}
              <TInput style={{ width: 60 }} keyboardType="numeric" value={String(it.quantidade)} onChangeText={(v) => setItem(i, 'quantidade', Number(v) || 1)} />
            </View>
          </View>
        );
      })}
      <Pressable onPress={addItem}><Text style={{ color: COLORS.gold, fontSize: 12, marginBottom: SPACING.md }}>+ adicionar item</Text></Pressable>
      <Field label="Status">
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {STATUS.map((s) => (
            <Pressable key={s.id} onPress={() => set('status', s.id)} style={[styles.miniChip, f.status === s.id && { backgroundColor: s.color, borderColor: s.color }]}>
              <Text style={{ color: f.status === s.id ? COLORS.ink : COLORS.muted, fontSize: 11 }}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      <Field label="Observações"><TInput value={f.observacoes} onChangeText={(v) => set('observacoes', v)} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} /></Field>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md }}>
        <Text style={{ color: COLORS.muted, fontSize: 13 }}>Total</Text>
        <Text style={{ color: COLORS.bone, fontSize: 16 }}>{brl(total)}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton label="Salvar pedido" onPress={() => f.cliente.trim() && f.itens.length > 0 && onSave({ ...f, total })} disabled={!f.cliente.trim() || f.itens.length === 0} testID="pedido-save" />
      </View>
    </View>
  );
}

function OpiniaoForm({ perfumes, initial, onSave, onCancel }: any) {
  const [f, setF] = useState<any>(initial || { perfumeId: perfumes[0]?.id || '', cliente: '', nota: 5, comentario: '' });
  const set = (k: string, v: any) => setF((s: any) => ({ ...s, [k]: v }));
  return (
    <View>
      <Field label="Perfume">
        <ScrollView style={{ maxHeight: 180 }}>
          {perfumes.map((p: any) => (
            <Pressable key={p.id} onPress={() => set('perfumeId', p.id)} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border }}>
              <Text style={{ color: f.perfumeId === p.id ? COLORS.gold : COLORS.bone, fontSize: 13 }}>{p.nome}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Field>
      <Field label="Cliente (opcional)"><TInput value={f.cliente} onChangeText={(v) => set('cliente', v)} /></Field>
      <Field label="Nota"><Stars value={f.nota} onChange={(n) => set('nota', n)} size={24} /></Field>
      <Field label="Comentário"><TInput value={f.comentario} onChangeText={(v) => set('comentario', v)} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} /></Field>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: SPACING.sm }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton label="Salvar" onPress={() => f.perfumeId && onSave(f)} testID="opiniao-save" />
      </View>
    </View>
  );
}

export function Atelie({ onSair }: { onSair: () => void }) {
  const [tab, setTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [perfumes, setPerfumes] = useState<Perfume[]>([]);
  const [movimentos, setMovimentos] = useState<Movimento[]>([]);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [opinioes, setOpinioes] = useState<Opiniao[]>([]);
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [estoqueMap, setEstoqueMap] = useState<Record<string, number>>({});
  const [sheet, setSheet] = useState<SheetType>(null);
  const [search, setSearch] = useState('');
  const [publicando, setPublicando] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, m, pe, o, s, c, e] = await Promise.all([
        listPerfumes(), listMovimentos(), listPedidos(), listOpinioes(), listSugestoes(), listCompras(), getEstoqueMap(),
      ]);
      setPerfumes(p); setMovimentos(m); setPedidos(pe); setOpinioes(o); setSugestoes(s); setCompras(c); setEstoqueMap(e);
    } catch (err) { console.error(err); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const estoqueDe = (id: string) => estoqueMap[id] || 0;
  const estoqueBaixo = perfumes.filter((p) => estoqueDe(p.id) <= (p.estoqueMinimoMl || 0)).length;
  const pendentes = pedidos.filter((p) => p.status === 'pendente').length;
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
    setSheet({ type: 'info', label: `Tamanhos 30/50/100ml aplicados a ${r.atualizados} contratipo(s).` });
    load();
  };
  const doMov = async (data: any) => { await createMovimento(data); setSheet(null); load(); };
  const doSavePedido = async (data: any) => {
    if (data.id) await updatePedido(data.id, data);
    else await createPedido(data);
    setSheet(null); load();
  };
  const doDelPedido = async (id: string) => { await deletePedido(id); setSheet(null); load(); };
  const doSaveOpiniao = async (data: any) => { await createOpiniao(data); setSheet(null); load(); };
  const doDelOpiniao = async (id: string) => { await deleteOpiniao(id); setSheet(null); load(); };
  const doPublish = async () => {
    setPublicando(true);
    try { await publishVitrine(); setSheet({ type: 'info', label: 'Vitrine publicada! Quem abrir o app vê a nova versão.' }); }
    catch (e) { setSheet({ type: 'info', label: 'Erro ao publicar. Tente de novo.' }); }
    finally { setPublicando(false); }
  };
  const doDelSugestao = async (id: string) => { await deleteSugestao(id); load(); };
  const doDelCompra = async (id: string) => { await deleteCompra(id); load(); };

  const perfumesFiltrados = perfumes.filter((p) => (p.nome + (p.inspiracao || '')).toLowerCase().includes(search.toLowerCase()));

  const sheetTitle = !sheet ? '' :
    sheet.type === 'perfume' ? (sheet.data ? 'Editar contratipo' : 'Novo contratipo') :
    sheet.type === 'movimento' ? 'Lançar estoque' :
    sheet.type === 'pedido' ? (sheet.data ? 'Editar pedido' : 'Novo pedido') :
    sheet.type === 'opiniao' ? 'Nova opinião' :
    sheet.type === 'confirm' ? 'Confirmar' : 'Aviso';

  const openCreate = () => {
    if (tab === 'catalogo') { setSheet({ type: 'perfume' }); return; }
    if (perfumes.length === 0) { setSheet({ type: 'info', label: 'Cadastre um contratipo no Catálogo antes.' }); return; }
    if (tab === 'estoque') setSheet({ type: 'movimento' });
    else if (tab === 'pedidos') setSheet({ type: 'pedido' });
    else if (tab === 'opinioes') setSheet({ type: 'opiniao' });
  };

  const renderContent = () => {
    if (loading) return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={COLORS.gold} /></View>;

    if (tab === 'dashboard') {
      return (
        <View style={{ padding: SPACING.lg }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: SPACING.lg }}>
            <View style={{ width: '48%' }}><StatCard label="Contratipos" value={perfumes.length} icon="droplet" /></View>
            <View style={{ width: '48%' }}><StatCard label="Estoque baixo" value={estoqueBaixo} icon="alert-triangle" alert={estoqueBaixo > 0} /></View>
            <View style={{ width: '48%' }}><StatCard label="Pedidos pendentes" value={pendentes} icon="clipboard" /></View>
            <View style={{ width: '48%' }}><StatCard label="Nota média" value={notaMedia} icon="star" /></View>
          </View>
          <Text style={styles.sectionLabel}>ÚLTIMOS PEDIDOS</Text>
          {pedidos.length === 0 && <EmptyState text="Nenhum pedido lançado ainda." />}
          {[...pedidos].sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime()).slice(0, 5).map((p) => {
            const st = STATUS.find((s) => s.id === p.status) || STATUS[0];
            return (
              <Pressable key={p.id} onPress={() => setSheet({ type: 'pedido', data: p })} style={styles.rowCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={{ color: COLORS.gold, fontSize: 11 }}>Nº {padSeq(p.seq)}</Text>
                    <Text style={{ color: COLORS.bone, fontSize: 15, fontWeight: '500' }}>{p.cliente}</Text>
                  </View>
                  <View style={[styles.pill, { borderColor: st.color }]}><Text style={{ color: st.color, fontSize: 11 }}>{st.label}</Text></View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ color: COLORS.muted, fontSize: 12 }}>{p.itens.length} item(ns) · {fmtDate(p.criadoEm)}</Text>
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
          <Pressable
            onPress={() => setSheet({ type: 'confirm', label: `Importar ${PRESET_FORNECEDOR.length} contratipos do fornecedor?`, onConfirm: doImport, confirmLabel: 'Importar' })}
            style={styles.actionBtn}
            testID="import-btn"
          >
            <Text style={{ color: COLORS.gold, fontSize: 12 }}>Importar lista do fornecedor ({PRESET_FORNECEDOR.length})</Text>
          </Pressable>
          {perfumes.length > 0 && (
            <Pressable
              onPress={() => setSheet({ type: 'confirm', label: `Padronizar tamanhos 30/50/100ml em ${perfumes.length} contratipo(s)?`, onConfirm: doPadronizar, confirmLabel: 'Aplicar' })}
              style={styles.actionBtn}
            >
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>Padronizar tamanhos (30/50/100ml)</Text>
            </Pressable>
          )}
          {perfumesFiltrados.length === 0 && <EmptyState text="Nenhum contratipo. Toque em + para começar." />}
          {perfumesFiltrados.map((p) => {
            const baixo = estoqueDe(p.id) <= (p.estoqueMinimoMl || 0);
            return (
              <View key={p.id} style={styles.perfumeCard} testID={`perfume-card-${p.id}`}>
                <PyramidBar />
                <View style={{ flex: 1, padding: SPACING.md }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: COLORS.gold, fontSize: 11 }}>Nº {padSeq(p.seq)}</Text>
                      <Text style={{ color: COLORS.bone, fontSize: 15, fontWeight: '500' }}>{p.nome}</Text>
                      <Text style={{ color: COLORS.muted, fontSize: 11 }}>inspirado em {p.inspiracao || '—'}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <Pressable onPress={() => setSheet({ type: 'perfume', data: p })} hitSlop={8} testID={`edit-${p.id}`}><Feather name="edit-2" size={16} color={COLORS.muted} /></Pressable>
                      <Pressable onPress={() => setSheet({ type: 'confirm', label: `Excluir "${p.nome}"?`, onConfirm: () => doDeletePerfume(p.id), danger: true })} hitSlop={8} testID={`del-${p.id}`}><Feather name="trash-2" size={16} color={COLORS.muted} /></Pressable>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    <View style={styles.tag}><Text style={{ color: COLORS.gold, fontSize: 10 }}>{p.familia}</Text></View>
                    <View style={styles.tag}><Text style={{ color: COLORS.muted, fontSize: 10 }}>{p.concentracao}</Text></View>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                    {p.precos.map((pr: any, i: number) => (
                      <Text key={i} style={{ color: COLORS.bone, fontSize: 11 }}>{pr.ml}ml · {brl(pr.preco)}</Text>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                    {baixo && <Feather name="alert-triangle" size={11} color={COLORS.rust} />}
                    <Text style={{ color: baixo ? COLORS.rust : COLORS.sage, fontSize: 11 }}>{estoqueDe(p.id)}ml em estoque{baixo ? ' · baixo' : ''}</Text>
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
          {perfumes.length === 0 && <EmptyState text="Cadastre um contratipo antes." />}
          {perfumes.map((p) => {
            const atual = estoqueDe(p.id);
            const baixo = atual <= (p.estoqueMinimoMl || 0);
            return (
              <View key={p.id} style={styles.rowCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: COLORS.gold, fontSize: 11 }}>Nº{padSeq(p.seq)}</Text>
                    <Text style={{ color: COLORS.bone, fontSize: 14, fontWeight: '500' }}>{p.nome}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: baixo ? COLORS.rust : COLORS.sage, fontSize: 15 }}>{atual}ml</Text>
                    {baixo && <Text style={{ color: COLORS.rust, fontSize: 11 }}>baixo</Text>}
                  </View>
                </View>
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
          {pedidos.length === 0 && <EmptyState text="Nenhum pedido lançado ainda." />}
          {[...pedidos].sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime()).map((p) => {
            const st = STATUS.find((s) => s.id === p.status) || STATUS[0];
            return (
              <Pressable key={p.id} onPress={() => setSheet({ type: 'pedido', data: p })} style={styles.rowCard} testID={`pedido-${p.id}`}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View><Text style={{ color: COLORS.gold, fontSize: 11 }}>Nº {padSeq(p.seq)}</Text><Text style={{ color: COLORS.bone, fontSize: 15, fontWeight: '500' }}>{p.cliente}</Text></View>
                  <View style={[styles.pill, { borderColor: st.color }]}><Text style={{ color: st.color, fontSize: 11 }}>{st.label}</Text></View>
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ color: COLORS.muted, fontSize: 12 }}>{p.itens.length} item(ns) · {fmtDate(p.criadoEm)}</Text>
                  <Text style={{ color: COLORS.bone, fontSize: 13 }}>{brl(p.total)}</Text>
                </View>
                <Pressable onPress={() => setSheet({ type: 'confirm', label: `Excluir pedido de ${p.cliente}?`, onConfirm: () => doDelPedido(p.id), danger: true })} hitSlop={4}>
                  <Text style={{ color: COLORS.rust, fontSize: 11, marginTop: 4 }}>excluir</Text>
                </Pressable>
              </Pressable>
            );
          })}
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
        </View>
      );
    }

    if (tab === 'mensagens') {
      return (
        <View style={{ padding: SPACING.lg }}>
          <Text style={styles.sectionLabel}>PEDIDOS DE COMPRA (VITRINE)</Text>
          {compras.length === 0 && <EmptyState text="Nenhum pedido de compra recebido." />}
          {[...compras].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()).map((c) => (
            <View key={c.id} style={styles.rowCard} testID={`compra-${c.id}`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: COLORS.bone, fontSize: 15, fontWeight: '500' }}>{c.cliente}</Text>
                <Pressable onPress={() => doDelCompra(c.id)} hitSlop={8}><Feather name="trash-2" size={14} color={COLORS.muted} /></Pressable>
              </View>
              <Text style={{ color: COLORS.gold, fontSize: 12, marginTop: 2 }}>{c.perfumeNome} · {c.ml}ml · {brl(c.preco)}</Text>
              <Text style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>Contato: {c.contato}</Text>
              {!!c.observacoes && <Text style={{ color: COLORS.bone, fontSize: 12, marginTop: 4 }}>{c.observacoes}</Text>}
              <Text style={{ color: COLORS.muted, fontSize: 11, marginTop: 4 }}>{fmtDate(c.data)}</Text>
            </View>
          ))}
          <Text style={[styles.sectionLabel, { marginTop: SPACING.lg }]}>SUGESTÕES</Text>
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
    return null;
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topbar}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: COLORS.gold, fontSize: 11, letterSpacing: 2 }}>ATELIÊ</Text>
          <Text style={{ color: COLORS.bone, fontSize: 22, fontWeight: '500' }}>Painel</Text>
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

      {tab !== 'dashboard' && tab !== 'mensagens' && (
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
        {sheet?.type === 'pedido' && <PedidoForm perfumes={perfumes} initial={sheet.data} onSave={doSavePedido} onCancel={() => setSheet(null)} />}
        {sheet?.type === 'opiniao' && <OpiniaoForm perfumes={perfumes} onSave={doSaveOpiniao} onCancel={() => setSheet(null)} />}
        {sheet?.type === 'confirm' && (
          <View>
            <Text style={{ color: COLORS.bone, marginBottom: SPACING.lg }}>{sheet.label}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <SecondaryButton label="Cancelar" onPress={() => setSheet(null)} />
              <Pressable
                onPress={sheet.onConfirm}
                testID="confirm-ok"
                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: sheet.danger ? COLORS.rust : COLORS.gold }}
              >
                <Text style={{ color: sheet.danger ? COLORS.bone : COLORS.ink, fontWeight: '600' }}>{sheet.confirmLabel || (sheet.danger ? 'Excluir' : 'Confirmar')}</Text>
              </Pressable>
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
  screen: { flex: 1, backgroundColor: COLORS.ink },
  topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, paddingBottom: SPACING.md },
  topBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  statCard: { padding: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg },
  statValue: { color: COLORS.bone, fontSize: 24, fontWeight: '500', marginTop: 6 },
  statLabel: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  sectionLabel: { color: COLORS.muted, fontSize: 11, marginBottom: SPACING.sm, letterSpacing: 1 },
  rowCard: { padding: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.sm },
  perfumeCard: { flexDirection: 'row', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.sm, overflow: 'hidden' },
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
