import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { COLORS, SPACING, RADIUS, brl, padSeq } from '../theme';
import { PyramidBar } from './PyramidBar';
import { BottomSheet } from './BottomSheet';
import { Field, TInput, PrimaryButton, SecondaryButton, EmptyState, Chip } from './atoms';
import { createCompra, createSugestao, getVitrine } from '../api';

type VitrineItem = {
  id: string; seq: number; nome: string; inspiracao: string; familia: string; concentracao: string;
  notasSaida: string; notasCoracao: string; notasFundo: string;
  precos: { ml: number; preco: number }[]; disponivel: boolean;
};

function VitrineCard({ item, onBuy }: { item: VitrineItem; onBuy: (ml: number, preco: number) => void }) {
  const [expandido, setExpandido] = useState(false);
  const temNotas = item.notasSaida || item.notasCoracao || item.notasFundo;
  return (
    <View style={styles.card} testID={`vitrine-card-${item.id}`}>
      <PyramidBar />
      <View style={{ flex: 1, padding: SPACING.lg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.seq}>Nº {padSeq(item.seq)}</Text>
            <Text style={styles.cardTitle}>{item.nome}</Text>
            <Text style={styles.cardSub}>inspirado em {item.inspiracao || '—'}</Text>
          </View>
          <View style={[styles.pill, { borderColor: item.disponivel ? COLORS.sage : COLORS.rust }]}>
            <Text style={{ color: item.disponivel ? COLORS.sage : COLORS.rust, fontSize: 11 }}>
              {item.disponivel ? 'disponível' : 'em falta'}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: SPACING.sm }}>
          <View style={styles.tag}><Text style={{ color: COLORS.gold, fontSize: 11 }}>{item.familia}</Text></View>
          <View style={styles.tag}><Text style={{ color: COLORS.muted, fontSize: 11 }}>{item.concentracao}</Text></View>
        </View>
        {temNotas ? (
          <Pressable onPress={() => setExpandido((v) => !v)} testID={`toggle-notas-${item.id}`}>
            <Text style={{ color: COLORS.gold, fontSize: 12, marginTop: SPACING.sm }}>{expandido ? 'ocultar notas' : 'ver pirâmide olfativa'}</Text>
          </Pressable>
        ) : null}
        {expandido ? (
          <View style={{ marginTop: SPACING.sm }}>
            {!!item.notasSaida && <Text style={{ color: COLORS.topNote, fontSize: 12 }}>Saída: {item.notasSaida}</Text>}
            {!!item.notasCoracao && <Text style={{ color: COLORS.heartNote, fontSize: 12 }}>Coração: {item.notasCoracao}</Text>}
            {!!item.notasFundo && <Text style={{ color: COLORS.baseNote, fontSize: 12 }}>Fundo: {item.notasFundo}</Text>}
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: SPACING.md }}>
          {item.precos.map((pr, i) => (
            <Pressable
              key={i}
              disabled={!item.disponivel}
              onPress={() => onBuy(pr.ml, pr.preco)}
              testID={`buy-${item.id}-${pr.ml}`}
              style={{
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                backgroundColor: item.disponivel ? COLORS.gold : COLORS.ink,
                borderWidth: 1, borderColor: item.disponivel ? COLORS.gold : COLORS.border,
                opacity: item.disponivel ? 1 : 0.7,
              }}
            >
              <Text style={{ color: item.disponivel ? COLORS.ink : COLORS.bone, fontSize: 12, fontWeight: item.disponivel ? '600' : '400' }}>
                {pr.ml}ml · {brl(pr.preco)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

export function Vitrine({ onAtelieClick }: { onAtelieClick: () => void }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<{ atualizadoEm: string | null; itens: VitrineItem[] } | null>(null);
  const [search, setSearch] = useState('');
  const [familiaAtiva, setFamiliaAtiva] = useState('Todas');
  const [buyItem, setBuyItem] = useState<{ item: VitrineItem; ml: number; preco: number } | null>(null);
  const [sugestaoOpen, setSugestaoOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const [buyForm, setBuyForm] = useState({ cliente: '', contato: '', observacoes: '' });
  const [sugForm, setSugForm] = useState({ cliente: '', contato: '', mensagem: '' });
  const [enviando, setEnviando] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getVitrine();
      setSnapshot(r);
    } catch (e) {
      setSnapshot({ atualizadoEm: null, itens: [] });
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const itens = snapshot?.itens || [];
  const familias = useMemo(() => ['Todas', ...Array.from(new Set(itens.map((i) => i.familia)))], [itens]);
  const filtrados = useMemo(() => itens.filter((i) => {
    const okBusca = (i.nome + ' ' + (i.inspiracao || '')).toLowerCase().includes(search.toLowerCase());
    const okFam = familiaAtiva === 'Todas' || i.familia === familiaAtiva;
    return okBusca && okFam;
  }), [itens, search, familiaAtiva]);

  const submitCompra = async () => {
    if (!buyItem || !buyForm.cliente.trim() || !buyForm.contato.trim()) return;
    setEnviando(true);
    try {
      await createCompra({
        perfumeId: buyItem.item.id, perfumeNome: buyItem.item.nome,
        ml: buyItem.ml, preco: buyItem.preco,
        cliente: buyForm.cliente, contato: buyForm.contato, observacoes: buyForm.observacoes,
      });
      setBuyItem(null); setBuyForm({ cliente: '', contato: '', observacoes: '' });
      setInfo('Pedido de compra enviado! Vamos entrar em contato em breve.');
    } catch (e) { setInfo('Não foi possível enviar. Tente novamente.'); }
    finally { setEnviando(false); }
  };

  const submitSugestao = async () => {
    if (!sugForm.mensagem.trim()) return;
    setEnviando(true);
    try {
      await createSugestao({ cliente: sugForm.cliente, contato: sugForm.contato, mensagem: sugForm.mensagem });
      setSugestaoOpen(false); setSugForm({ cliente: '', contato: '', mensagem: '' });
      setInfo('Sugestão enviada! Obrigado por compartilhar.');
    } catch (e) { setInfo('Não foi possível enviar. Tente novamente.'); }
    finally { setEnviando(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.gold} />
          <Text style={{ color: COLORS.gold, marginTop: 12 }}>Preparando as fragrâncias…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const showEmpty = !snapshot || itens.length === 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {/* Discrete Ateliê access */}
      <Pressable
        onLongPress={onAtelieClick}
        delayLongPress={800}
        style={styles.atelieAccess}
        testID="atelie-access-button"
        hitSlop={12}
      >
        <Feather name="lock" size={13} color={COLORS.gold} />
      </Pressable>

      <FlatList
        data={filtrados}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <VitrineCard item={item} onBuy={(ml, preco) => setBuyItem({ item, ml, preco })} />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.gold} />}
        ListHeaderComponent={
          <View>
            <View style={{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl, paddingBottom: SPACING.md }}>
              <Text style={styles.eyebrow}>VITRINE</Text>
              <Text style={styles.h1}>Coleção de Contratipos</Text>
              <Text style={styles.subtitle}>Inspirados nos grandes nomes da perfumaria de luxo e nicho.</Text>
            </View>
            {!showEmpty && (
              <View style={{ paddingHorizontal: SPACING.lg }}>
                <View style={styles.searchBox}>
                  <Feather name="search" size={16} color={COLORS.muted} />
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Buscar por nome ou inspiração"
                    placeholderTextColor={COLORS.muted + 'BB'}
                    style={styles.searchInput}
                    testID="vitrine-search"
                  />
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6, paddingHorizontal: 2 }} style={{ height: 56, marginBottom: SPACING.sm }}>
                  {familias.map((f) => (
                    <Chip key={f} label={f} active={familiaAtiva === f} onPress={() => setFamiliaAtiva(f)} testID={`chip-familia-${f}`} />
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          showEmpty ? (
            <View style={{ padding: SPACING.xl, alignItems: 'center' }}>
              <Text style={[styles.h1, { fontSize: 22, marginTop: 32 }]}>Vitrine em preparação</Text>
              <Text style={{ color: COLORS.muted, marginTop: 6, textAlign: 'center' }}>Volte em breve para conferir a coleção.</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: SPACING.lg }}><EmptyState text="Nenhum contratipo encontrado." /></View>
          )
        }
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 120 }}
      />

      {/* Floating suggestion button */}
      <Pressable
        onPress={() => setSugestaoOpen(true)}
        style={styles.fabSuggestion}
        testID="sugestao-fab"
      >
        <Feather name="message-circle" size={22} color={COLORS.ink} />
      </Pressable>

      {/* Compra sheet */}
      <BottomSheet visible={!!buyItem} onClose={() => setBuyItem(null)} title="Confirmar pedido de compra" testID="buy-sheet">
        {buyItem && (
          <View>
            <View style={{ padding: SPACING.md, borderRadius: 12, backgroundColor: COLORS.ink, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md }}>
              <Text style={{ color: COLORS.gold, fontSize: 11 }}>Nº {padSeq(buyItem.item.seq)}</Text>
              <Text style={{ color: COLORS.bone, fontSize: 16, fontWeight: '500' }}>{buyItem.item.nome}</Text>
              <Text style={{ color: COLORS.muted, fontSize: 12 }}>inspirado em {buyItem.item.inspiracao || '—'}</Text>
              <Text style={{ color: COLORS.bone, fontSize: 14, marginTop: 6 }}>{buyItem.ml}ml · {brl(buyItem.preco)}</Text>
            </View>
            <Field label="Seu nome"><TInput value={buyForm.cliente} onChangeText={(v) => setBuyForm({ ...buyForm, cliente: v })} placeholder="Nome completo" testID="buy-cliente" /></Field>
            <Field label="WhatsApp ou e-mail"><TInput value={buyForm.contato} onChangeText={(v) => setBuyForm({ ...buyForm, contato: v })} placeholder="(00) 00000-0000" testID="buy-contato" /></Field>
            <Field label="Observações (opcional)"><TInput value={buyForm.observacoes} onChangeText={(v) => setBuyForm({ ...buyForm, observacoes: v })} multiline style={{ minHeight: 80, textAlignVertical: 'top' }} /></Field>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: SPACING.sm }}>
              <SecondaryButton label="Cancelar" onPress={() => setBuyItem(null)} />
              <PrimaryButton label={enviando ? 'Enviando…' : 'Enviar pedido'} onPress={submitCompra} disabled={enviando || !buyForm.cliente.trim() || !buyForm.contato.trim()} testID="buy-submit" />
            </View>
          </View>
        )}
      </BottomSheet>

      {/* Sugestão sheet */}
      <BottomSheet visible={sugestaoOpen} onClose={() => setSugestaoOpen(false)} title="Enviar sugestão" testID="sugestao-sheet">
        <View>
          <Text style={{ color: COLORS.muted, fontSize: 13, marginBottom: SPACING.md }}>Que fragrância você gostaria de ver na nossa vitrine? Escreva aqui.</Text>
          <Field label="Seu nome (opcional)"><TInput value={sugForm.cliente} onChangeText={(v) => setSugForm({ ...sugForm, cliente: v })} testID="sug-cliente" /></Field>
          <Field label="Contato (opcional)"><TInput value={sugForm.contato} onChangeText={(v) => setSugForm({ ...sugForm, contato: v })} /></Field>
          <Field label="Sugestão"><TInput value={sugForm.mensagem} onChangeText={(v) => setSugForm({ ...sugForm, mensagem: v })} placeholder="Ex: gostaria de um contratipo do..." multiline style={{ minHeight: 100, textAlignVertical: 'top' }} testID="sug-mensagem" /></Field>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: SPACING.sm }}>
            <SecondaryButton label="Cancelar" onPress={() => setSugestaoOpen(false)} />
            <PrimaryButton label={enviando ? 'Enviando…' : 'Enviar'} onPress={submitSugestao} disabled={enviando || !sugForm.mensagem.trim()} testID="sug-submit" />
          </View>
        </View>
      </BottomSheet>

      {/* Info sheet */}
      <BottomSheet visible={!!info} onClose={() => setInfo(null)} title="Aviso">
        <Text style={{ color: COLORS.bone, marginBottom: SPACING.lg }}>{info}</Text>
        <PrimaryButton label="Entendi" onPress={() => setInfo(null)} testID="info-ok" />
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.ink },
  eyebrow: { color: COLORS.gold, fontSize: 11, letterSpacing: 2, fontWeight: '500' },
  h1: { color: COLORS.bone, fontSize: 28, fontWeight: '500', marginTop: 6 },
  subtitle: { color: COLORS.muted, fontSize: 13, marginTop: 6 },
  atelieAccess: { position: 'absolute', top: 58, right: SPACING.lg, zIndex: 40, width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, marginBottom: SPACING.sm },
  searchInput: { flex: 1, color: COLORS.bone, paddingVertical: 10, fontSize: 14 },
  card: { flexDirection: 'row', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.md, overflow: 'hidden' },
  seq: { color: COLORS.gold, fontSize: 11, letterSpacing: 1 },
  cardTitle: { color: COLORS.bone, fontSize: 17, fontWeight: '500', marginTop: 2 },
  cardSub: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, backgroundColor: COLORS.ink, flexShrink: 0 },
  tag: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.ink },
  fabSuggestion: { position: 'absolute', right: 20, bottom: 30, width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
});
