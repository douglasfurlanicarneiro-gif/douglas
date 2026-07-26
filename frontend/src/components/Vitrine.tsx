import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { COLORS, SPACING, RADIUS, brl, padSeq } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Field, TInput, PrimaryButton, SecondaryButton, EmptyState, Chip, Stars } from './atoms';
import { createOpiniao, createSugestao, getVitrine } from '../api';
import { CartItem, CheckoutSheet } from './CheckoutSheet';
import type { Perfume } from '../types';

type VitrineItem = Perfume;

function VitrineCard({ item, onBuy, onReview }: { item: VitrineItem; onBuy: (ml: number, preco: number) => void; onReview: () => void }) {
  const temNotas = item.notasSaida || item.notasCoracao || item.notasFundo;
  const climaOcasiao = item.ocasioes?.length ? item.ocasioes.join(' · ') : 'Versátil · Todas as ocasiões';
  return (
    <View style={styles.card} testID={`vitrine-card-${item.id}`}>
      <View style={styles.productTop}>
        <View style={styles.imageFrame}>
          {item.imagemUrl ? (
            <Image source={{ uri: item.imagemUrl }} style={styles.productImage} contentFit="cover" transition={180} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Feather name="image" size={25} color={COLORS.muted} />
              <Text style={styles.imagePlaceholderText}>Adicionar foto</Text>
            </View>
          )}
        </View>
        <View style={styles.productInfo}>
          <Text style={styles.cardTitle}>{item.nome}</Text>
          <Text style={styles.occasionLabel}>CLIMA & OCASIÃO</Text>
          <Text style={styles.cardSub}>{climaOcasiao}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{item.familia}</Text>
            <View style={styles.metaDot} />
            <Text style={styles.metaText}>{item.concentracao}</Text>
            <View style={[styles.availabilityDot, { backgroundColor: item.disponivel ? COLORS.sage : COLORS.rust }]} />
            <Text style={[styles.metaText, { color: item.disponivel ? COLORS.sage : COLORS.rust }]}>
              {item.disponivel ? 'disponível' : 'em falta'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.sizeRow}>
          {item.precos.map((pr, i) => (
            <Pressable
              key={i}
              disabled={!item.disponivel}
              onPress={() => onBuy(pr.ml, pr.preco)}
              testID={`buy-${item.id}-${pr.ml}`}
              style={[styles.sizeButton, !item.disponivel && styles.sizeButtonDisabled]}
            >
              <Text style={[styles.sizeButtonText, !item.disponivel && { color: COLORS.muted }]}>+ {pr.ml}ml</Text>
              <Text style={[styles.sizePrice, !item.disponivel && { color: COLORS.muted }]}>{brl(pr.preco)}</Text>
            </Pressable>
          ))}
      </View>

      {temNotas ? (
        <View style={styles.notes}>
          {!!item.notasSaida && <NoteRow label="TOPO" value={item.notasSaida} />}
          {!!item.notasCoracao && <NoteRow label="CORAÇÃO" value={item.notasCoracao} />}
          {!!item.notasFundo && <NoteRow label="BASE" value={item.notasFundo} />}
        </View>
      ) : (
        <View style={styles.notesEmpty}>
          <Text style={styles.notesEmptyText}>Notas olfativas em atualização</Text>
        </View>
      )}

      <Pressable onPress={onReview} style={styles.reviewButton} testID={`review-trigger-${item.id}`}>
        <Feather name="star" size={13} color={COLORS.gold} />
        <Text style={styles.reviewText}>Avaliar fragrância</Text>
      </Pressable>
    </View>
  );
}

function NoteRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.noteRow}>
      <Text style={styles.noteLabel}>{label}</Text>
      <Text style={styles.noteValue}>{value}</Text>
    </View>
  );
}

export function Vitrine({ onAtelieClick }: { onAtelieClick: () => void }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<{ atualizadoEm: string | null; itens: VitrineItem[] } | null>(null);
  const [search, setSearch] = useState('');
  const [familiaAtiva, setFamiliaAtiva] = useState('Todas');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [sugestaoOpen, setSugestaoOpen] = useState(false);
  const [reviewItem, setReviewItem] = useState<VitrineItem | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [suggestionSuccess, setSuggestionSuccess] = useState(false);

  const [sugForm, setSugForm] = useState({ cliente: '', contato: '', mensagem: '' });
  const [reviewForm, setReviewForm] = useState({ cliente: '', nota: 5, comentario: '' });
  const [enviando, setEnviando] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getVitrine();
      setSnapshot(r);
    } catch {
      setSnapshot({ atualizadoEm: null, itens: [] });
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const itens = useMemo(() => snapshot?.itens || [], [snapshot?.itens]);
  const familias = useMemo(() => ['Todas', ...Array.from(new Set(itens.map((i) => i.familia)))], [itens]);
  const filtrados = useMemo(() => itens.filter((i) => {
    const searchable = [
      i.nome,
      i.familia,
      ...(i.ocasioes || []),
      i.notasSaida,
      i.notasCoracao,
      i.notasFundo,
    ].filter(Boolean).join(' ').toLowerCase();
    const okBusca = searchable.includes(search.trim().toLowerCase());
    const okFam = familiaAtiva === 'Todas' || i.familia === familiaAtiva;
    return okBusca && okFam;
  }), [itens, search, familiaAtiva]);

  const addToCart = (item: VitrineItem, ml: number, preco: number) => {
    setCart((current) => {
      const index = current.findIndex((line) => line.perfume.id === item.id && line.option.ml === ml);
      if (index < 0) return [...current, { perfume: item, option: { ml, preco }, quantidade: 1 }];
      return current.map((line, lineIndex) => lineIndex === index
        ? { ...line, quantidade: Math.min(line.quantidade + 1, 20) }
        : line);
    });
    setCartOpen(true);
  };

  const cartCount = cart.reduce((total, item) => total + item.quantidade, 0);

  const submitSugestao = async () => {
    if (!sugForm.mensagem.trim()) return;
    setEnviando(true);
    try {
      await createSugestao({ cliente: sugForm.cliente, contato: sugForm.contato, mensagem: sugForm.mensagem });
      setSugestaoOpen(false); setSugForm({ cliente: '', contato: '', mensagem: '' });
      setSuggestionSuccess(true);
    } catch { setInfo('Não foi possível enviar. Tente novamente.'); }
    finally { setEnviando(false); }
  };

  const submitReview = async () => {
    if (!reviewItem || !reviewForm.comentario.trim()) return;
    setEnviando(true);
    try {
      await createOpiniao({
        perfumeId: reviewItem.id,
        cliente: reviewForm.cliente,
        nota: reviewForm.nota,
        comentario: reviewForm.comentario,
      });
      setReviewItem(null); setReviewForm({ cliente: '', nota: 5, comentario: '' });
      setInfo('Avaliação enviada! Obrigado.');
    } catch { setInfo('Não foi possível enviar. Tente novamente.'); }
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
      {/* Discrete Ateliê access (toque simples, protegido por senha) */}
      <Pressable
        onPress={onAtelieClick}
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
          <VitrineCard item={item} onBuy={(ml, preco) => addToCart(item, ml, preco)} onReview={() => setReviewItem(item)} />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={COLORS.gold} />}
        ListHeaderComponent={
          <View>
            <View style={styles.brandHeader}>
              <Text style={styles.eyebrow}>L’ESSENCE</Text>
              <Text style={styles.h1}>FURLANI</Text>
              <Text style={styles.subtitle}>PERFUMARIA AUTORAL</Text>
            </View>
            {!showEmpty && (
              <View style={{ paddingHorizontal: SPACING.lg }}>
                <View style={styles.searchBox}>
                  <Feather name="search" size={16} color={COLORS.muted} />
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Buscar fragrância, nota ou ocasião…"
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
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 160 }}
      />

      {/* Floating suggestion button */}
      <Pressable
        onPress={() => setSugestaoOpen(true)}
        style={styles.fabSuggestion}
        testID="sugestao-fab"
      >
        <Feather name="message-circle" size={22} color={COLORS.ink} />
      </Pressable>

      <View style={styles.bottomNav}>
        <View style={styles.navItem}>
          <Feather name="home" size={22} color={COLORS.gold} />
          <Text style={styles.navTextActive}>Vitrine</Text>
        </View>
        <Pressable
          onPress={() => cartCount ? setCartOpen(true) : setInfo('Seu carrinho está vazio. Escolha um tamanho para começar.')}
          style={styles.navItem}
          testID="cart-button"
        >
          <View>
            <Feather name="shopping-cart" size={23} color={COLORS.muted} />
            {cartCount > 0 && <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{cartCount}</Text></View>}
          </View>
          <Text style={styles.navText}>Carrinho</Text>
        </Pressable>
      </View>

      <CheckoutSheet
        visible={cartOpen}
        items={cart}
        onClose={() => setCartOpen(false)}
        onChangeQuantity={(index, quantity) => setCart((current) => (
          quantity <= 0
            ? current.filter((_, lineIndex) => lineIndex !== index)
            : current.map((line, lineIndex) => lineIndex === index ? { ...line, quantidade: Math.min(quantity, 20) } : line)
        ))}
        onRemove={(index) => setCart((current) => current.filter((_, lineIndex) => lineIndex !== index))}
        onSuccess={(message) => {
          setCart([]);
          setCartOpen(false);
          setOrderSuccess(message);
          load();
        }}
      />

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
      <BottomSheet visible={!!info} onClose={() => setInfo(null)} title="Aviso" compact>
        <Text style={{ color: COLORS.bone, marginBottom: SPACING.lg }}>{info}</Text>
        <PrimaryButton label="Entendi" onPress={() => setInfo(null)} testID="info-ok" />
      </BottomSheet>

      <BottomSheet visible={!!orderSuccess} onClose={() => setOrderSuccess(null)} title="Pedido confirmado" compact testID="order-success-sheet">
        <View style={styles.successContent}>
          <View style={styles.successIcon}>
            <Feather name="check" size={30} color={COLORS.ink} />
          </View>
          <Text style={styles.successEyebrow}>OBRIGADO PELA SUA COMPRA</Text>
          <Text style={styles.successTitle}>Seu pedido foi recebido!</Text>
          <Text style={styles.successText}>A L’Essence Furlani agradece por fazer parte deste momento.</Text>
          <View style={styles.successNextStep}>
            <Feather name="message-circle" size={18} color={COLORS.gold} />
            <Text style={styles.successNextText}>{orderSuccess}</Text>
          </View>
          <PrimaryButton label="Voltar à vitrine" onPress={() => setOrderSuccess(null)} testID="success-close" />
        </View>
      </BottomSheet>

      <BottomSheet visible={suggestionSuccess} onClose={() => setSuggestionSuccess(false)} title="Sugestão recebida" compact testID="suggestion-success-sheet">
        <View style={styles.successContent}>
          <View style={styles.successIcon}>
            <Feather name="message-circle" size={28} color={COLORS.ink} />
          </View>
          <Text style={styles.successEyebrow}>OBRIGADO POR COMPARTILHAR</Text>
          <Text style={styles.successTitle}>Sua opinião é muito importante!</Text>
          <Text style={styles.successText}>Recebemos sua sugestão com carinho e vamos trabalhar em cima do seu feedback para tornar a experiência L’Essence Furlani ainda mais especial.</Text>
          <PrimaryButton label="Continuar explorando" onPress={() => setSuggestionSuccess(false)} testID="suggestion-success-close" />
        </View>
      </BottomSheet>

      {/* Review (avaliação do cliente) */}
      <BottomSheet visible={!!reviewItem} onClose={() => setReviewItem(null)} title="Deixar avaliação" testID="review-sheet">
        {reviewItem && (
          <View>
            <View style={{ padding: SPACING.md, borderRadius: 12, backgroundColor: COLORS.ink, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md }}>
              <Text style={{ color: COLORS.gold, fontSize: 11 }}>Nº {padSeq(reviewItem.seq)}</Text>
              <Text style={{ color: COLORS.bone, fontSize: 16, fontWeight: '500' }}>{reviewItem.nome}</Text>
            </View>
            <Field label="Seu nome (opcional)"><TInput value={reviewForm.cliente} onChangeText={(v) => setReviewForm({ ...reviewForm, cliente: v })} testID="review-cliente" /></Field>
            <Field label="Nota"><Stars value={reviewForm.nota} onChange={(n) => setReviewForm({ ...reviewForm, nota: n })} size={26} /></Field>
            <Field label="Comentário"><TInput value={reviewForm.comentario} onChangeText={(v) => setReviewForm({ ...reviewForm, comentario: v })} multiline style={{ minHeight: 100, textAlignVertical: 'top' }} placeholder="Conte o que achou do perfume..." testID="review-comentario" /></Field>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: SPACING.sm }}>
              <SecondaryButton label="Cancelar" onPress={() => setReviewItem(null)} />
              <PrimaryButton label={enviando ? 'Enviando…' : 'Enviar avaliação'} onPress={submitReview} disabled={enviando || !reviewForm.comentario.trim()} testID="review-submit" />
            </View>
          </View>
        )}
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.ink },
  brandHeader: { alignItems: 'center', paddingHorizontal: 56, paddingTop: SPACING.xl, paddingBottom: SPACING.lg },
  eyebrow: { color: COLORS.gold, fontSize: 11, letterSpacing: 5, fontWeight: '500' },
  h1: { color: COLORS.bone, fontSize: 26, lineHeight: 30, letterSpacing: 1.5, fontWeight: '700', marginTop: 2 },
  subtitle: { color: COLORS.muted, fontSize: 9, letterSpacing: 2.2, marginTop: 5 },
  atelieAccess: { position: 'absolute', top: 48, right: SPACING.lg, zIndex: 40, width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 16, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, marginBottom: SPACING.sm },
  searchInput: { flex: 1, color: COLORS.bone, paddingVertical: 12, fontSize: 14 },
  card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.lg, padding: SPACING.md, overflow: 'hidden' },
  productTop: { flexDirection: 'row', gap: SPACING.md },
  imageFrame: { width: 108, height: 116, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: COLORS.ink, borderWidth: 1, borderColor: COLORS.border },
  productImage: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  imagePlaceholderText: { color: COLORS.muted, fontSize: 9 },
  productInfo: { flex: 1, minWidth: 0, paddingTop: 2 },
  cardTitle: { color: COLORS.bone, fontSize: 17, lineHeight: 21, fontWeight: '700' },
  occasionLabel: { color: COLORS.gold, fontSize: 9, letterSpacing: 1.1, marginTop: 9 },
  cardSub: { color: COLORS.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 9 },
  metaText: { color: COLORS.muted, fontSize: 9 },
  metaDot: { width: 2, height: 2, borderRadius: 1, backgroundColor: COLORS.muted },
  availabilityDot: { width: 6, height: 6, borderRadius: 3, marginLeft: 2 },
  sizeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: SPACING.md },
  sizeButton: { flexGrow: 1, minWidth: 86, paddingHorizontal: 9, paddingVertical: 7, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: COLORS.gold, alignItems: 'center', backgroundColor: COLORS.ink },
  sizeButtonDisabled: { borderColor: COLORS.border, opacity: 0.65 },
  sizeButtonText: { color: COLORS.gold, fontSize: 12, lineHeight: 15, fontWeight: '700' },
  sizePrice: { color: COLORS.bone, fontSize: 9, lineHeight: 12, marginTop: 1 },
  notes: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: SPACING.md, paddingTop: 10, gap: 6 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noteLabel: { width: 58, color: COLORS.muted, fontSize: 9, lineHeight: 15, letterSpacing: 0.8 },
  noteValue: { flex: 1, color: COLORS.bone, fontSize: 11, lineHeight: 15, fontStyle: 'italic' },
  notesEmpty: { borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: SPACING.md, paddingTop: 10 },
  notesEmptyText: { color: COLORS.muted, fontSize: 10, fontStyle: 'italic' },
  reviewButton: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, paddingVertical: 3 },
  reviewText: { color: COLORS.gold, fontSize: 10 },
  fabSuggestion: { position: 'absolute', right: 20, bottom: 92, width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', paddingTop: 10, paddingBottom: 18, backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border },
  navItem: { flex: 1, minHeight: 47, alignItems: 'center', justifyContent: 'center' },
  navTextActive: { color: COLORS.gold, fontSize: 11, marginTop: 3 },
  navText: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  cartBadge: { position: 'absolute', top: -7, right: -10, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  cartBadgeText: { color: COLORS.ink, fontSize: 9, fontWeight: '700' },
  successContent: { alignItems: 'center', paddingTop: 4 },
  successIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  successEyebrow: { color: COLORS.gold, fontSize: 10, letterSpacing: 1.6, textAlign: 'center' },
  successTitle: { color: COLORS.bone, fontSize: 21, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  successText: { color: COLORS.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7, marginBottom: SPACING.lg, maxWidth: 330 },
  successNextStep: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.ink, marginBottom: SPACING.lg },
  successNextText: { flex: 1, color: COLORS.bone, fontSize: 12, lineHeight: 18 },
});
