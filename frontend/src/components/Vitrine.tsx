import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, FlatList, ActivityIndicator, RefreshControl, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { COLORS, SPACING, RADIUS, brl, familiasDoPerfume, nomeConcentracao, padSeq } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Field, TInput, PrimaryButton, SecondaryButton, EmptyState, Chip, Stars } from './atoms';
import { createOpiniao, createSugestao, getOrdersResetVersion, getVitrine } from '../api';
import { CartItem, CheckoutSheet } from './CheckoutSheet';
import { OrdersSheet, PerfumeDetailSheet, QuizSheet } from './CustomerSheets';
import { storage } from '../utils/storage';
import { createManualPixPayload } from '../utils/pix';
import type { Acompanhamento, Compra, Perfume } from '../types';

type VitrineItem = Perfume;
const FAVORITES_KEY = 'favorite-perfumes-v1';
const ORDERS_KEY_PREFIX = 'customer-orders-v';
const ORDERS_INITIAL_VERSION = 2;
const CART_KEY = 'customer-cart-v1';
type SavedCartLine = { perfumeId: string; ml: number; quantidade: number };
const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

const resumirCategorias = (valores: string[], limite: number, singular: string, plural: string) => {
  if (!valores.length) return '';
  const visiveis = valores.slice(0, limite);
  const restantes = valores.length - visiveis.length;
  if (restantes <= 0) return visiveis.join(' · ');
  return `${visiveis.join(' · ')} · +${restantes} ${restantes === 1 ? singular : plural}`;
};

function VitrineCard({
  item,
  favorite,
  onBuy,
  onReview,
  onDetails,
  onToggleFavorite,
}: {
  item: VitrineItem;
  favorite: boolean;
  onBuy: (ml: number, preco: number) => void;
  onReview: () => void;
  onDetails: () => void;
  onToggleFavorite: () => void;
}) {
  const temNotas = item.notasSaida || item.notasCoracao || item.notasFundo;
  const ocasioes = item.ocasioes || [];
  const familias = familiasDoPerfume(item);
  const climaOcasiao = ocasioes.length ? resumirCategorias(ocasioes, 2, 'ocasião', 'ocasiões') : 'Versátil · Todas as ocasiões';
  const familiasResumo = resumirCategorias(familias, 2, 'família', 'famílias');
  return (
    <View style={styles.card} testID={`vitrine-card-${item.id}`}>
      <Pressable onPress={onToggleFavorite} style={styles.cardFavorite} hitSlop={8}>
        <Feather name="heart" size={18} color={favorite ? COLORS.wine : COLORS.gold} />
      </Pressable>
      <View style={styles.productTop}>
        <Pressable style={styles.imageFrame} onPress={onDetails}>
          {item.imagemUrl ? (
            <Image source={{ uri: item.imagemUrl }} style={styles.productImage} contentFit="cover" transition={180} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Feather name="image" size={25} color={COLORS.muted} />
              <Text style={styles.imagePlaceholderText}>Adicionar foto</Text>
            </View>
          )}
        </Pressable>
        <View style={styles.productInfo}>
          <Pressable onPress={onDetails}>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.nome}</Text>
          </Pressable>
          <Text style={styles.occasionLabel}>CLIMA & OCASIÃO</Text>
          <Text style={styles.cardSub} numberOfLines={2}>{climaOcasiao}</Text>
          {!!familiasResumo && <Text style={styles.familySummary} numberOfLines={2}>{familiasResumo}</Text>}
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{nomeConcentracao(item.concentracao)}</Text>
            <View style={[styles.availabilityDot, { backgroundColor: item.disponivel ? COLORS.sage : COLORS.rust }]} />
            <Text style={[styles.metaText, { color: item.disponivel ? COLORS.sage : COLORS.rust }]}>
              {item.disponivel ? 'Disponível' : 'Em falta'}
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
              <Text style={[styles.sizeButtonText, !item.disponivel && { color: COLORS.muted }]}>{pr.ml} ml</Text>
              <Text style={[styles.sizePrice, !item.disponivel && { color: COLORS.muted }]}>{brl(pr.preco)}</Text>
            </Pressable>
          ))}
      </View>

      {temNotas ? (
        <View style={styles.notes}>
          {!!item.notasSaida && <NoteRow label="TOPO" value={item.notasSaida} />}
          {!!item.notasCoracao && <NoteRow label="CORAÇÃO" value={item.notasCoracao} />}
          {!!item.notasFundo && <NoteRow label="FUNDO" value={item.notasFundo} />}
        </View>
      ) : (
        <View style={styles.notesEmpty}>
          <Text style={styles.notesEmptyText}>Notas olfativas em atualização</Text>
        </View>
      )}

      <View style={styles.cardActions}>
        <Pressable onPress={onReview} style={styles.reviewButton} testID={`review-trigger-${item.id}`}>
          <Feather name="star" size={13} color={COLORS.gold} />
          <Text style={styles.reviewText}>Avaliar</Text>
        </Pressable>
        <Pressable onPress={onDetails} style={styles.detailsButton}>
          <Text style={styles.detailsText}>Conhecer a fragrância</Text>
          <Feather name="arrow-right" size={13} color={COLORS.gold} />
        </Pressable>
      </View>
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
  const [ocasiaoAtiva, setOcasiaoAtiva] = useState('Todas');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [sugestaoOpen, setSugestaoOpen] = useState(false);
  const [reviewItem, setReviewItem] = useState<VitrineItem | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);
  const [suggestionSuccess, setSuggestionSuccess] = useState(false);
  const [detailItem, setDetailItem] = useState<VitrineItem | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [orderCodes, setOrderCodes] = useState<string[]>([]);
  const [successOrder, setSuccessOrder] = useState<Compra | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  const cartRestored = useRef(false);
  const ordersKeyRef = useRef(`${ORDERS_KEY_PREFIX}${ORDERS_INITIAL_VERSION}`);

  const [sugForm, setSugForm] = useState({ cliente: '', contato: '', mensagem: '' });
  const [reviewForm, setReviewForm] = useState({ cliente: '', nota: 5, comentario: '' });
  const [enviando, setEnviando] = useState(false);
  const manualPixCode = successOrder?.pagamento?.metodo === 'pix'
    ? successOrder.pagamento.pixCopiaECola || createManualPixPayload(
      successOrder.pagamento.referencia || successOrder.id,
      successOrder.pagamento.valor || successOrder.total || 0,
    )
    : '';

  const load = useCallback(async () => {
    try {
      const r = await getVitrine();
      setSnapshot(r);
    } catch {
      setSnapshot({ atualizadoEm: null, itens: [] });
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const syncOrdersStorage = useCallback(async (loadSaved = false) => {
    let version = ORDERS_INITIAL_VERSION;
    try {
      const response = await getOrdersResetVersion();
      version = Math.max(ORDERS_INITIAL_VERSION, Number(response.version) || ORDERS_INITIAL_VERSION);
    } catch {
      // Mantém a versão conhecida se o aparelho estiver temporariamente offline.
    }

    const nextKey = `${ORDERS_KEY_PREFIX}${version}`;
    const changed = ordersKeyRef.current !== nextKey;
    ordersKeyRef.current = nextKey;

    if (changed) {
      setOrderCodes([]);
      await Promise.all(
        Array.from({ length: Math.max(0, version - 1) }, (_, index) => (
          storage.removeItem(`${ORDERS_KEY_PREFIX}${index + 1}`)
        )),
      );
    }

    if (!loadSaved) return;
    const savedOrders = await storage.getItem(nextKey, '');
    try {
      setOrderCodes(savedOrders ? JSON.parse(savedOrders) : []);
    } catch {
      setOrderCodes([]);
      storage.removeItem(nextKey);
    }
  }, []);

  useEffect(() => {
    Promise.all([
      storage.getItem(FAVORITES_KEY, ''),
      syncOrdersStorage(true),
    ]).then(([savedFavorites]) => {
      try {
        if (savedFavorites) setFavorites(new Set(JSON.parse(savedFavorites)));
      } catch { storage.removeItem(FAVORITES_KEY); }
    });
  }, [syncOrdersStorage]);

  const itens = useMemo(() => snapshot?.itens || [], [snapshot?.itens]);

  useEffect(() => {
    if (!itens.length || cartRestored.current) return;
    storage.getItem(CART_KEY, '')
      .then((saved) => {
        if (!saved || cartRestored.current) return;
        const lines = JSON.parse(saved) as SavedCartLine[];
        const restored = lines.flatMap((line) => {
          const perfume = itens.find((item) => item.id === line.perfumeId && item.disponivel);
          const option = perfume?.precos.find((price) => price.ml === line.ml);
          if (!perfume || !option || option.preco <= 0) return [];
          return [{
            perfume,
            option,
            quantidade: Math.max(1, Math.min(Number(line.quantidade) || 1, 20)),
          }];
        });
        setCart(restored);
      })
      .catch(() => storage.removeItem(CART_KEY))
      .finally(() => { cartRestored.current = true; });
  }, [itens]);

  useEffect(() => {
    if (!cartRestored.current) return;
    if (!cart.length) {
      storage.removeItem(CART_KEY);
      return;
    }
    const lines: SavedCartLine[] = cart.map((line) => ({
      perfumeId: line.perfume.id,
      ml: line.option.ml,
      quantidade: line.quantidade,
    }));
    storage.setItem(CART_KEY, JSON.stringify(lines));
  }, [cart]);

  const familias = useMemo(
    () => ['Todas', 'Favoritos', ...Array.from(new Set(itens.flatMap(familiasDoPerfume))).sort((a, b) => a.localeCompare(b, 'pt-BR'))],
    [itens],
  );
  const ocasioes = useMemo(
    () => ['Todas', ...Array.from(new Set(itens.flatMap((i) => i.ocasioes || []))).sort((a, b) => a.localeCompare(b, 'pt-BR'))],
    [itens],
  );
  const filtrados = useMemo(() => itens.filter((i) => {
    const searchable = [
      i.nome,
      ...familiasDoPerfume(i),
      ...(i.ocasioes || []),
      i.notasSaida,
      i.notasCoracao,
      i.notasFundo,
    ].filter(Boolean).join(' ');
    const okBusca = normalize(searchable).includes(normalize(search.trim()));
    const okFam = familiaAtiva === 'Todas'
      || (familiaAtiva === 'Favoritos' ? favorites.has(i.id) : familiasDoPerfume(i).includes(familiaAtiva));
    const okOcasiao = ocasiaoAtiva === 'Todas' || i.ocasioes?.includes(ocasiaoAtiva);
    return okBusca && okFam && okOcasiao;
  }), [itens, search, familiaAtiva, ocasiaoAtiva, favorites]);

  const toggleFavorite = (id: string) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      storage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };

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
  const filtrosAtivos = (familiaAtiva !== 'Todas' && familiaAtiva !== 'Favoritos' ? 1 : 0)
    + (ocasiaoAtiva !== 'Todas' ? 1 : 0);

  const saveOrderCode = (order: Compra) => {
    if (!order.codigoAcompanhamento) return;
    setOrderCodes((current) => {
      const next = [order.codigoAcompanhamento!, ...current.filter((code) => code !== order.codigoAcompanhamento)].slice(0, 30);
      storage.setItem(ordersKeyRef.current, JSON.stringify(next));
      return next;
    });
  };

  const addOrderCode = (code: string) => {
    setOrderCodes((current) => {
      const next = [code, ...current.filter((saved) => saved !== code)].slice(0, 30);
      storage.setItem(ordersKeyRef.current, JSON.stringify(next));
      return next;
    });
  };

  const removeOrderCode = (code: string) => {
    setOrderCodes((current) => {
      const next = current.filter((saved) => saved !== code);
      storage.setItem(ordersKeyRef.current, JSON.stringify(next));
      return next;
    });
  };

  const openOrders = async () => {
    await syncOrdersStorage();
    setOrdersOpen(true);
  };

  const rebuy = (order: Acompanhamento) => {
    const lines: CartItem[] = [];
    order.itens.forEach((orderItem) => {
      const perfume = itens.find((item) => item.id === orderItem.perfumeId && item.disponivel);
      const option = perfume?.precos.find((price) => price.ml === orderItem.ml);
      if (perfume && option) {
        lines.push({ perfume, option, quantidade: Math.min(orderItem.quantidade || 1, 20) });
      }
    });
    if (!lines.length) {
      setInfo('Os itens desse pedido não estão disponíveis no momento.');
      return;
    }
    setCart(lines);
    setOrdersOpen(false);
    setCartOpen(true);
  };

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
        <Feather name="user" size={14} color={COLORS.muted} />
      </Pressable>

      <FlatList
        data={filtrados}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <VitrineCard
            item={item}
            favorite={favorites.has(item.id)}
            onBuy={(ml, preco) => addToCart(item, ml, preco)}
            onReview={() => setReviewItem(item)}
            onDetails={() => setDetailItem(item)}
            onToggleFavorite={() => toggleFavorite(item.id)}
          />
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
                    placeholderTextColor={COLORS.muted}
                    style={styles.searchInput}
                    testID="vitrine-search"
                  />
                </View>
                <Pressable onPress={() => setQuizOpen(true)} style={styles.quizBanner} testID="quiz-open">
                  <View style={styles.quizIcon}>
                    <Feather name="compass" size={19} color={COLORS.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.quizTitle}>Encontre sua essência</Text>
                    <Text style={styles.quizSubtitle}>Uma seleção personalizada em poucos passos</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={COLORS.gold} />
                </Pressable>
                <View style={styles.quickFilters}>
                  <Pressable
                    onPress={() => { setFamiliaAtiva('Todas'); setOcasiaoAtiva('Todas'); }}
                    style={[styles.quickFilterButton, familiaAtiva === 'Todas' && ocasiaoAtiva === 'Todas' && styles.quickFilterButtonActive]}
                    testID="filter-all"
                  >
                    <Text style={[styles.quickFilterText, familiaAtiva === 'Todas' && ocasiaoAtiva === 'Todas' && styles.quickFilterTextActive]}>Todas</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => { setFamiliaAtiva('Favoritos'); setOcasiaoAtiva('Todas'); }}
                    style={[styles.quickFilterButton, styles.quickFilterGrow, familiaAtiva === 'Favoritos' && styles.quickFilterButtonActive]}
                    testID="filter-favorites"
                  >
                    <Feather name="heart" size={14} color={familiaAtiva === 'Favoritos' ? COLORS.ink : COLORS.gold} />
                    <Text style={[styles.quickFilterText, familiaAtiva === 'Favoritos' && styles.quickFilterTextActive]}>Favoritos</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (familiaAtiva === 'Favoritos') setFamiliaAtiva('Todas');
                      setFiltersOpen(true);
                    }}
                    style={[styles.quickFilterButton, styles.quickFilterGrow, filtrosAtivos > 0 && styles.quickFilterButtonActive]}
                    testID="filter-open"
                  >
                    <Feather name="sliders" size={14} color={filtrosAtivos > 0 ? COLORS.ink : COLORS.gold} />
                    <Text style={[styles.quickFilterText, filtrosAtivos > 0 && styles.quickFilterTextActive]}>Filtros</Text>
                    {filtrosAtivos > 0 && (
                      <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{filtrosAtivos}</Text></View>
                    )}
                  </Pressable>
                </View>
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
        <Pressable
          onPress={openOrders}
          style={styles.navItem}
          testID="orders-button"
        >
          <View>
            <Feather name="package" size={22} color={COLORS.muted} />
            {orderCodes.length > 0 && (
              <View style={styles.cartBadge}><Text style={styles.cartBadgeText}>{Math.min(orderCodes.length, 9)}</Text></View>
            )}
          </View>
          <Text style={styles.navText}>Pedidos</Text>
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
        onSuccess={(order, message) => {
          setCart([]);
          setCartOpen(false);
          saveOrderCode(order);
          setSuccessOrder(order);
          setPixCopied(false);
          setOrderSuccess(message);
          load();
        }}
      />

      <PerfumeDetailSheet
        perfume={detailItem}
        favorite={!!detailItem && favorites.has(detailItem.id)}
        onClose={() => setDetailItem(null)}
        onToggleFavorite={() => detailItem && toggleFavorite(detailItem.id)}
        onBuy={(ml, preco) => {
          if (!detailItem) return;
          addToCart(detailItem, ml, preco);
          setDetailItem(null);
        }}
      />
      <QuizSheet
        visible={quizOpen}
        perfumes={itens}
        onClose={() => setQuizOpen(false)}
        onDetails={(perfume) => {
          setQuizOpen(false);
          setDetailItem(perfume);
        }}
      />
      <OrdersSheet
        visible={ordersOpen}
        codes={orderCodes}
        onClose={() => setOrdersOpen(false)}
        onRebuy={rebuy}
        onAddCode={addOrderCode}
        onRemoveCode={removeOrderCode}
      />

      <BottomSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtrar fragrâncias" compact testID="filters-sheet">
        <View>
          <Text style={styles.filterSheetLabel}>FAMÍLIA OLFATIVA</Text>
          <View style={styles.filterSheetChips}>
            {familias.filter((item) => item !== 'Favoritos').map((item) => (
              <Chip
                key={item}
                label={item === 'Todas' ? 'Todas as famílias' : item}
                active={familiaAtiva === item}
                onPress={() => setFamiliaAtiva(item)}
              />
            ))}
          </View>
          <Text style={styles.filterSheetLabel}>OCASIÃO</Text>
          <View style={styles.filterSheetChips}>
            {ocasioes.map((item) => (
              <Chip
                key={item}
                label={item === 'Todas' ? 'Todas as ocasiões' : item}
                active={ocasiaoAtiva === item}
                onPress={() => setOcasiaoAtiva(item)}
              />
            ))}
          </View>
          <View style={styles.filterSheetActions}>
            <SecondaryButton
              label="Limpar"
              onPress={() => { setFamiliaAtiva('Todas'); setOcasiaoAtiva('Todas'); }}
            />
            <PrimaryButton label="Aplicar filtros" onPress={() => setFiltersOpen(false)} />
          </View>
        </View>
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
      <BottomSheet visible={!!info} onClose={() => setInfo(null)} title="Aviso" compact>
        <Text style={{ color: COLORS.bone, marginBottom: SPACING.lg }}>{info}</Text>
        <PrimaryButton label="Entendi" onPress={() => setInfo(null)} testID="info-ok" />
      </BottomSheet>

      <BottomSheet visible={!!orderSuccess} onClose={() => setOrderSuccess(null)} title="Pedido recebido" compact testID="order-success-sheet">
        <View style={styles.successContent}>
          <View style={styles.successIcon}>
            <Feather name="check" size={30} color={COLORS.ink} />
          </View>
          <Text style={styles.successEyebrow}>
            {manualPixCode ? 'PEDIDO REGISTRADO' : 'OBRIGADO PELA SUA COMPRA'}
          </Text>
          <Text style={styles.successTitle}>
            {manualPixCode ? 'Agora, conclua o pagamento' : 'Seu pedido foi recebido!'}
          </Text>
          {!!successOrder?.seq && (
            <Text style={styles.successOrderNumber}>PEDIDO Nº {padSeq(successOrder.seq)}</Text>
          )}
          <Text style={styles.successText}>A L’Essence Furlani agradece por fazer parte deste momento.</Text>
          {!!manualPixCode && (
            <View style={styles.pixCard}>
              <View style={styles.pixHeading}>
                <View>
                  <Text style={styles.pixEyebrow}>PIX · {successOrder.pagamento.instituicao || 'PicPay'}</Text>
                  <Text style={styles.pixValue}>{brl(successOrder.pagamento.valor || successOrder.total || 0)}</Text>
                </View>
                <View style={styles.pixPendingPill}>
                  <View style={styles.pixPendingDot} />
                  <Text style={styles.pixPendingText}>Aguardando</Text>
                </View>
              </View>
              <View style={styles.qrFrame}>
                <QRCode
                  value={manualPixCode}
                  size={176}
                  color="#15130F"
                  backgroundColor="#FFFFFF"
                />
              </View>
              <Text style={styles.pixHint}>Escaneie o QR Code ou copie o código para pagar pelo aplicativo do seu banco.</Text>
              <Pressable
                onPress={async () => {
                  await Clipboard.setStringAsync(manualPixCode);
                  setPixCopied(true);
                }}
                style={({ pressed }) => [styles.copyPixButton, pressed && { opacity: 0.82 }]}
                testID="copy-pix-code"
              >
                <Feather name={pixCopied ? 'check' : 'copy'} size={16} color={COLORS.ink} />
                <Text style={styles.copyPixText}>{pixCopied ? 'Código Pix copiado' : 'Copiar código Pix'}</Text>
              </Pressable>
              <Text style={styles.manualConfirmation}>A confirmação será feita manualmente após o recebimento.</Text>
            </View>
          )}
          <View style={styles.successNextStep}>
            <Feather name="message-circle" size={18} color={COLORS.gold} />
            <Text style={styles.successNextText}>{orderSuccess}</Text>
          </View>
          {!!successOrder?.codigoAcompanhamento && (
            <View style={styles.trackingCodeCard}>
              <Text style={styles.trackingCodeLabel}>CÓDIGO PARA ACESSAR EM OUTRO APARELHO</Text>
              <Text selectable style={styles.trackingCode}>{successOrder.codigoAcompanhamento}</Text>
              <Pressable
                onPress={() => {
                  void Share.share({
                    message: `Meu pedido L’Essence Furlani pode ser acompanhado com este código: ${successOrder.codigoAcompanhamento}`,
                  });
                }}
                style={styles.shareCodeButton}
                testID="share-tracking-code"
              >
                <Feather name="share-2" size={14} color={COLORS.gold} />
                <Text style={styles.shareCodeText}>Compartilhar código</Text>
              </Pressable>
            </View>
          )}
          <View style={{ width: '100%', gap: 8 }}>
            {!!successOrder?.codigoAcompanhamento && (
              <SecondaryButton
                label="Acompanhar meu pedido"
                onPress={() => {
                  setOrderSuccess(null);
                  setOrdersOpen(true);
                }}
              />
            )}
            <PrimaryButton label="Voltar à vitrine" onPress={() => setOrderSuccess(null)} testID="success-close" />
          </View>
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
  brandHeader: { alignItems: 'center', paddingHorizontal: 56, paddingTop: 26, paddingBottom: 20 },
  eyebrow: { color: COLORS.gold, fontSize: 11, letterSpacing: 5, fontWeight: '500' },
  h1: { color: COLORS.bone, fontSize: 26, lineHeight: 30, letterSpacing: 1.5, fontWeight: '700', marginTop: 7 },
  subtitle: { color: COLORS.muted, fontSize: 9, letterSpacing: 2.2, marginTop: 5 },
  atelieAccess: { position: 'absolute', top: 51, right: SPACING.lg, zIndex: 40, width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surface + '99', borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 56, paddingHorizontal: 18, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, marginBottom: 12 },
  searchInput: { flex: 1, color: COLORS.bone, paddingVertical: 15, fontSize: 14 },
  quizBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.gold + '70', marginBottom: SPACING.sm },
  quizIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  quizTitle: { color: COLORS.bone, fontSize: 14, fontWeight: '700' },
  quizSubtitle: { color: COLORS.muted, fontSize: 10, marginTop: 2 },
  quickFilters: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, marginBottom: SPACING.sm },
  quickFilterButton: { minHeight: 40, paddingHorizontal: 14, borderRadius: RADIUS.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  quickFilterGrow: { flex: 1 },
  quickFilterButtonActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  quickFilterText: { color: COLORS.muted, fontSize: 11, fontWeight: '600' },
  quickFilterTextActive: { color: COLORS.ink },
  filterBadge: { minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, backgroundColor: COLORS.ink, alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { color: COLORS.gold, fontSize: 8, fontWeight: '700' },
  filterSheetLabel: { color: COLORS.gold, fontSize: 9, letterSpacing: 1.2, marginBottom: 9 },
  filterSheetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.lg },
  filterSheetActions: { flexDirection: 'row', gap: 8, marginTop: SPACING.sm },
  card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: 12, padding: SPACING.md, overflow: 'hidden' },
  cardFavorite: { position: 'absolute', right: 10, top: 9, zIndex: 4, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.ink + 'DD' },
  productTop: { flexDirection: 'row', gap: SPACING.md },
  imageFrame: { width: 108, height: 116, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: COLORS.ink, borderWidth: 1, borderColor: COLORS.border },
  productImage: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  imagePlaceholderText: { color: COLORS.muted, fontSize: 9 },
  productInfo: { flex: 1, minWidth: 0, paddingTop: 2 },
  cardTitle: { color: COLORS.bone, fontSize: 17, lineHeight: 21, fontWeight: '700' },
  occasionLabel: { color: COLORS.gold, fontSize: 9, letterSpacing: 1.1, marginTop: 9 },
  cardSub: { color: COLORS.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  familySummary: { color: COLORS.bone, fontSize: 10, lineHeight: 14, marginTop: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 5 },
  metaText: { color: COLORS.muted, fontSize: 9 },
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
  cardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 },
  reviewButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  reviewText: { color: COLORS.gold, fontSize: 10 },
  detailsButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  detailsText: { color: COLORS.gold, fontSize: 10, fontWeight: '600' },
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
  successOrderNumber: { color: COLORS.gold, fontSize: 11, letterSpacing: 1.2, marginTop: 7 },
  successText: { color: COLORS.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 7, marginBottom: SPACING.lg, maxWidth: 330 },
  successNextStep: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.ink, marginBottom: SPACING.lg },
  pixCard: { width: '100%', padding: SPACING.lg, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.gold + '66', backgroundColor: COLORS.ink, marginBottom: SPACING.md },
  pixHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  pixEyebrow: { color: COLORS.gold, fontSize: 10, letterSpacing: 1.2 },
  pixValue: { color: COLORS.bone, fontSize: 22, fontWeight: '700', marginTop: 2 },
  pixPendingPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: COLORS.gold + '66', borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 5 },
  pixPendingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.gold },
  pixPendingText: { color: COLORS.gold, fontSize: 10 },
  qrFrame: { alignSelf: 'center', backgroundColor: '#FFFFFF', padding: 12, borderRadius: RADIUS.md, marginBottom: SPACING.md },
  pixHint: { color: COLORS.muted, fontSize: 12, lineHeight: 17, textAlign: 'center', marginBottom: SPACING.md },
  copyPixButton: { minHeight: 46, borderRadius: RADIUS.md, backgroundColor: COLORS.gold, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  copyPixText: { color: COLORS.ink, fontSize: 14, fontWeight: '700' },
  manualConfirmation: { color: COLORS.muted, fontSize: 10, textAlign: 'center', marginTop: 10 },
  successNextText: { flex: 1, color: COLORS.bone, fontSize: 12, lineHeight: 18 },
  trackingCodeCard: { width: '100%', alignItems: 'center', padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.gold + '55', backgroundColor: COLORS.gold + '0C', marginBottom: SPACING.lg },
  trackingCodeLabel: { color: COLORS.gold, fontSize: 9, letterSpacing: 1.1, textAlign: 'center' },
  trackingCode: { color: COLORS.bone, fontSize: 17, fontWeight: '700', letterSpacing: 1.2, marginTop: 8 },
  shareCodeButton: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 36, paddingHorizontal: 12, marginTop: 7 },
  shareCodeText: { color: COLORS.gold, fontSize: 11, fontWeight: '600' },
});
