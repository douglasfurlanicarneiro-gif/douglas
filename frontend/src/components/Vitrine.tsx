import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Pressable, FlatList, ActivityIndicator, RefreshControl, Share, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, FontAwesome } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { COLORS, SPACING, RADIUS, FONT_SIZES, brl, familiasDoPerfume, nomeConcentracao, padSeq } from '../theme';
import { BottomSheet } from './BottomSheet';
import { AppText as Text, AppTextInput as TextInput } from './Typography';
import { Field, TInput, PrimaryButton, SecondaryButton, Chip, Stars } from './atoms';
import { ApiError, confirmarPagamentoInfinitePay, createOpiniao, createSugestao, getOrdersResetVersion, getVitrine } from '../api';
import { CartItem, CheckoutSheet } from './CheckoutSheet';
import { OrdersSheet, PerfumeDetailSheet, QuizSheet } from './CustomerSheets';
import { storage } from '../utils/storage';
import { tamanhoDisponivel } from '../utils/availability';
import { useWebPullToRefresh } from '../hooks/use-web-pull-to-refresh';
import {
  instagramLink,
  publicStoreConfig,
  storeNameParts,
  whatsappNumber,
} from '../storeConfig';
import type { Acompanhamento, Compra, ConfiguracoesLojaPublicas, Perfume } from '../types';

type VitrineItem = Perfume;
type AvailabilityFilter = 'pronta' | 'encomenda' | 'todas';
const FAVORITES_KEY = 'favorite-perfumes-v1';
const ORDERS_KEY_PREFIX = 'customer-orders-v';
const ORDERS_INITIAL_VERSION = 2;
const CART_KEY = 'customer-cart-v1';
const VITRINE_CACHE_KEY = 'storefront-snapshot-v1';
type SavedCartLine = { perfumeId: string; ml: number; quantidade: number };
type ContactFallback = {
  channel: 'WhatsApp' | 'Instagram';
  webUrl: string;
  copyValue: string;
};
type FeatherIconName = React.ComponentProps<typeof Feather>['name'];
const FAQ_ITEMS: { question: string; answer: string; icon: FeatherIconName }[] = [
  {
    question: 'O que é um perfume inspirado (contratipo)?',
    answer: 'Nossos perfumes são criações inspiradas no perfil olfativo de fragrâncias mundialmente conhecidas, desenvolvidas de forma independente. Não comercializamos produtos originais das marcas de referência e não possuímos qualquer vínculo com elas.',
    icon: 'droplet',
  },
  {
    question: 'Qual é o prazo de preparação e envio?',
    answer: 'Cada perfume é preparado com cuidado para garantir qualidade e desempenho. O prazo de produção é de até 3 dias úteis. Após a postagem, o prazo de entrega depende da transportadora e do CEP informado. Em períodos promocionais ou datas comemorativas, a produção poderá levar mais tempo.',
    icon: 'clock',
  },
  {
    question: 'Como o frete é calculado?',
    answer: 'O valor é calculado automaticamente no checkout conforme o CEP de destino, os itens do pedido e a modalidade de envio escolhida. Você verá o valor antes de finalizar a compra.',
    icon: 'truck',
  },
  {
    question: 'Como acompanho meu pedido?',
    answer: 'Abra a opção Pedidos na vitrine para consultar o andamento. Quando houver código de rastreamento, nossa equipe também poderá enviá-lo pelo WhatsApp informado na compra.',
    icon: 'package',
  },
  {
    question: 'Como funciona a retirada combinada?',
    answer: 'Caso prefira, você pode retirar seu pedido pessoalmente mediante agendamento. Após a confirmação do pagamento, entraremos em contato para combinar local, data e horário.',
    icon: 'map-pin',
  },
  {
    question: 'Quais formas de pagamento são aceitas?',
    answer: 'Aceitamos PIX e os cartões disponíveis no checkout. As condições de pagamento e parcelamento serão exibidas antes da confirmação do pedido.',
    icon: 'credit-card',
  },
  {
    question: 'Preciso solicitar uma troca ou devolução. O que faço?',
    answer: 'Caso receba um produto com defeito ou avaria, entre em contato conosco em até 7 dias corridos após o recebimento. Após a análise do caso, realizaremos a substituição ou o reembolso conforme as regras aplicáveis. Em casos de desistência, o produto deverá estar sem uso e em perfeitas condições.',
    icon: 'refresh-cw',
  },
  {
    question: 'Os perfumes têm boa fixação?',
    answer: 'A duração pode variar conforme a pele, o clima e o ambiente. Utilizamos matérias-primas selecionadas para proporcionar ótimo desempenho e projeção.',
    icon: 'activity',
  },
  {
    question: 'Os perfumes são originais?',
    answer: 'Não. São fragrâncias autorais inspiradas em perfumes conhecidos, produzidas de forma independente e sem vínculo com as marcas de referência.',
    icon: 'info',
  },
  {
    question: 'Posso encomendar um perfume personalizado?',
    answer: 'Sim. Desenvolvemos fragrâncias personalizadas para criar uma identidade olfativa exclusiva. Nossa equipe orientará você sobre acordes, intensidade e possibilidades de criação.',
    icon: 'sliders',
  },
  {
    question: 'Como devo armazenar meu perfume?',
    answer: 'Mantenha o frasco em local fresco, seco e protegido da luz solar direta. Assim, a fragrância preserva suas características por mais tempo.',
    icon: 'sun',
  },
  {
    question: 'Os perfumes já vêm prontos para uso?',
    answer: 'Sim. Todos os perfumes passam pelo período adequado de maturação antes do envio, buscando oferecer o melhor desempenho olfativo.',
    icon: 'check-circle',
  },
];
const PRODUCT_CARD_COLORS = {
  background: COLORS.surface,
  imageBackground: COLORS.surfaceRaised,
  border: COLORS.border,
  ink: COLORS.bone,
  text: COLORS.bone,
  muted: COLORS.muted,
  gold: COLORS.gold,
};
const STOREFRONT_COLORS = {
  background: COLORS.background,
  surface: COLORS.surface,
  surfaceRaised: COLORS.surfaceRaised,
  border: COLORS.border,
  ink: COLORS.bone,
  muted: COLORS.muted,
  gold: COLORS.gold,
};
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
      <Pressable onPress={onToggleFavorite} style={styles.cardFavorite} hitSlop={8} testID={`favorite-${item.id}`}>
        {favorite ? (
          <FontAwesome name="heart" size={18} color={COLORS.favorite} />
        ) : (
          <Feather name="heart" size={18} color={PRODUCT_CARD_COLORS.gold} />
        )}
      </Pressable>
      <View style={styles.productTop}>
        <Pressable style={styles.imageFrame} onPress={onDetails} testID={`details-image-${item.id}`}>
          {item.imagemUrl ? (
            <Image source={{ uri: item.imagemUrl }} style={styles.productImage} contentFit="cover" transition={180} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Feather name="image" size={25} color={PRODUCT_CARD_COLORS.muted} />
              <Text style={styles.imagePlaceholderText}>Adicionar foto</Text>
            </View>
          )}
        </Pressable>
        <View style={styles.productInfo}>
          <Pressable onPress={onDetails} testID={`details-title-${item.id}`}>
            <Text style={styles.cardTitle} numberOfLines={2}>{item.nome}</Text>
          </Pressable>
          <Text style={styles.occasionLabel}>CLIMA & OCASIÃO</Text>
          <Text style={styles.cardSub} numberOfLines={2}>{climaOcasiao}</Text>
          {!!familiasResumo && <Text style={styles.familySummary} numberOfLines={2}>{familiasResumo}</Text>}
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{nomeConcentracao(item.concentracao)}</Text>
            <View style={[styles.availabilityDot, { backgroundColor: item.prontaEntrega ? (item.disponivel ? COLORS.sage : COLORS.rust) : PRODUCT_CARD_COLORS.gold }]} />
            <Text style={[styles.metaText, { color: item.prontaEntrega ? (item.disponivel ? COLORS.sage : COLORS.rust) : PRODUCT_CARD_COLORS.gold }]}>
              {item.prontaEntrega ? (item.disponivel ? 'Pronta entrega' : 'Indisponível') : 'Sob encomenda'}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.sizeRow}>
          {item.precos.map((pr, i) => {
            const disponivel = tamanhoDisponivel(item, pr.ml);
            return (
              <Pressable
                key={i}
                disabled={!disponivel}
                onPress={() => onBuy(pr.ml, pr.preco)}
                testID={`buy-${item.id}-${pr.ml}`}
                style={({ pressed }) => [
                  styles.sizeButton,
                  pressed && disponivel && styles.sizeButtonPressed,
                  !disponivel && styles.sizeButtonDisabled,
                ]}
              >
                <Text style={[styles.sizeButtonText, !disponivel && { color: PRODUCT_CARD_COLORS.muted }]}>{pr.ml} ml</Text>
                <Text style={[styles.sizePrice, !disponivel && { color: PRODUCT_CARD_COLORS.muted }]}>
                  {disponivel ? (item.prontaEntrega ? brl(pr.preco) : 'Solicitar') : 'Indisponível'}
                </Text>
              </Pressable>
            );
          })}
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
      <Text style={styles.noteLabel} numberOfLines={1}>{label}</Text>
      <Text style={styles.noteValue}>{value}</Text>
    </View>
  );
}

export function Vitrine({
  onAtelieClick,
  storeConfig,
  onRefreshStoreConfig,
  onReady,
}: {
  onAtelieClick: () => void;
  storeConfig?: ConfiguracoesLojaPublicas;
  onRefreshStoreConfig?: () => Promise<ConfiguracoesLojaPublicas>;
  onReady?: () => void;
}) {
  const currentStore = publicStoreConfig(storeConfig);
  const brand = storeNameParts(currentStore.nomeLoja);
  const supportNumber = whatsappNumber(currentStore.whatsapp);
  const instagramUrl = instagramLink(currentStore.instagram);
  const instagramUsername = currentStore.instagram
    .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];
  const [loading, setLoading] = useState(true);
  const [storeLogoFailed, setStoreLogoFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<{ atualizadoEm: string | null; itens: VitrineItem[] } | null>(null);
  const [search, setSearch] = useState('');
  const [familiaAtiva, setFamiliaAtiva] = useState('Todas');
  const [ocasiaoAtiva, setOcasiaoAtiva] = useState('Todas');
  const [disponibilidadeAtiva, setDisponibilidadeAtiva] = useState<AvailabilityFilter>('pronta');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactFallback, setContactFallback] = useState<ContactFallback | null>(null);
  const [sugestaoOpen, setSugestaoOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [faqExpanded, setFaqExpanded] = useState<number | null>(0);
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
  const [trackingCodeOpen, setTrackingCodeOpen] = useState(false);
  const cartRestored = useRef(false);
  const ordersKeyRef = useRef(`${ORDERS_KEY_PREFIX}${ORDERS_INITIAL_VERSION}`);
  const hasCatalogRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRef = useRef<() => Promise<void>>(async () => undefined);

  const [sugForm, setSugForm] = useState({ cliente: '', contato: '', mensagem: '' });
  const [reviewForm, setReviewForm] = useState({ cliente: '', nota: 5, comentario: '' });
  const [enviando, setEnviando] = useState(false);
  const manualPixCode = successOrder?.pagamento?.metodo === 'pix'
    ? successOrder.pagamento.pixCopiaECola || ''
    : '';
  const automaticCheckoutUrl = successOrder?.pagamento?.checkoutUrl || '';
  const successTrackingCode = successOrder?.codigoAcompanhamento || '';
  const pagamentoAutomaticoPendente = Boolean(
    automaticCheckoutUrl
    && successOrder?.pagamento?.status !== 'pago'
  );
  const pagamentoConfirmado = Boolean(
    successOrder?.pagamento?.status === 'pago'
    || successOrder?.status === 'pagamento_confirmado'
  );

  useEffect(() => {
    if (!orderSuccess || !pagamentoConfirmado) return;
    const timer = setTimeout(() => {
      setOrderSuccess(null);
      setTrackingCodeOpen(false);
    }, 4500);
    return () => clearTimeout(timer);
  }, [orderSuccess, pagamentoConfirmado]);

  const load = useCallback(async (forceRefresh = false) => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    try {
      // A identidade da loja é atualizada sem bloquear o catálogo.
      onRefreshStoreConfig?.().catch(() => undefined);
      const r = await getVitrine(forceRefresh);
      hasCatalogRef.current = true;
      retryAttemptRef.current = 0;
      setSnapshot(r);
      setLoading(false);
      storage.setItem(VITRINE_CACHE_KEY, JSON.stringify(r));
    } catch {
      // Com catálogo salvo, o cliente continua navegando normalmente. Sem
      // catálogo, a abertura permanece visível e a conexão é refeita sozinha.
      if (!hasCatalogRef.current) {
        setLoading(true);
        const retryDelays = [1500, 3000, 5000, 8000, 12000, 15000];
        const delay = retryDelays[Math.min(retryAttemptRef.current, retryDelays.length - 1)];
        retryAttemptRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null;
          void loadRef.current();
        }, delay);
      }
    } finally { setRefreshing(false); }
  }, [onRefreshStoreConfig]);
  loadRef.current = load;

  useEffect(() => {
    const start = async () => {
      const cached = await storage.getItem(VITRINE_CACHE_KEY, '');
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as { atualizadoEm: string | null; itens: VitrineItem[] };
          if (Array.isArray(parsed.itens) && parsed.itens.length > 0) {
            hasCatalogRef.current = true;
            setSnapshot(parsed);
            setLoading(false);
          }
        } catch {
          storage.removeItem(VITRINE_CACHE_KEY);
        }
      }
      await load();
    };
    start();
  }, [load]);
  useEffect(() => () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return;
    const refreshOnFocus = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', refreshOnFocus);
    document.addEventListener('visibilitychange', refreshOnFocus);
    return () => {
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnFocus);
    };
  }, [load]);
  useEffect(() => {
    if (!loading) onReady?.();
  }, [loading, onReady]);
  useEffect(() => setStoreLogoFailed(false), [currentStore.logoUrl]);

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

  const itens = useMemo(() => [...(snapshot?.itens || [])], [snapshot?.itens]);

  useEffect(() => {
    if (!itens.length || cartRestored.current) return;
    storage.getItem(CART_KEY, '')
      .then((saved) => {
        if (!saved || cartRestored.current) return;
        const lines = JSON.parse(saved) as SavedCartLine[];
        const restored = lines.flatMap((line) => {
          const perfume = itens.find((item) => item.id === line.perfumeId && tamanhoDisponivel(item, line.ml));
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

  useEffect(() => {
    if (!cartRestored.current || !itens.length) return;
    setCart((current) => {
      let changed = false;
      const reconciled = current.flatMap((line) => {
        const perfume = itens.find((item) => (
          item.id === line.perfume.id
          && tamanhoDisponivel(item, line.option.ml)
        ));
        const option = perfume?.precos.find((price) => price.ml === line.option.ml);
        if (!perfume || !option || option.preco <= 0) {
          changed = true;
          return [];
        }
        if (perfume !== line.perfume || option.preco !== line.option.preco) {
          changed = true;
          return [{ ...line, perfume, option }];
        }
        return [line];
      });
      return changed ? reconciled : current;
    });
  }, [itens]);

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
    const okDisponibilidade = disponibilidadeAtiva === 'todas'
      || (disponibilidadeAtiva === 'pronta' ? i.prontaEntrega === true : i.prontaEntrega !== true);
    return okBusca && okFam && okOcasiao && okDisponibilidade;
  }), [itens, search, familiaAtiva, ocasiaoAtiva, disponibilidadeAtiva, favorites]);

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
    + (ocasiaoAtiva !== 'Todas' ? 1 : 0)
    + (disponibilidadeAtiva === 'encomenda' ? 1 : 0);

  const saveOrderCode = async (order: Compra) => {
    if (!order.codigoAcompanhamento) return;
    const next = [
      order.codigoAcompanhamento,
      ...orderCodes.filter((code) => code !== order.codigoAcompanhamento),
    ].slice(0, 30);
    setOrderCodes(next);
    await storage.setItem(ordersKeyRef.current, JSON.stringify(next));
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('pagamento') !== 'infinitepay') return;
    const orderNsu = params.get('order_nsu') || '';
    const transactionNsu = params.get('transaction_nsu') || '';
    const slug = params.get('slug') || '';
    if (!orderNsu || !transactionNsu || !slug) {
      setInfo('O retorno da InfinitePay veio incompleto. Seu pedido continua salvo e pode ser consultado em Pedidos.');
      return;
    }

    let cancelled = false;
    const confirmar = async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await confirmarPagamentoInfinitePay({ orderNsu, transactionNsu, slug });
          if (cancelled) return;
          const order = response.pedido;
          await syncOrdersStorage(false);
          if (order.codigoAcompanhamento) {
            const saved = await storage.getItem(ordersKeyRef.current, '');
            let current: string[] = [];
            try { current = saved ? JSON.parse(saved) : []; } catch { current = []; }
            const next = [order.codigoAcompanhamento, ...current.filter((code) => code !== order.codigoAcompanhamento)].slice(0, 30);
            setOrderCodes(next);
            await storage.setItem(ordersKeyRef.current, JSON.stringify(next));
          }
          setSuccessOrder(order);
          setOrderSuccess('Pagamento confirmado pela InfinitePay. Seu pedido já está liberado para o preparo.');
          const cleaned = new URL(window.location.href);
          ['pagamento', 'receipt_url', 'order_nsu', 'slug', 'capture_method', 'transaction_nsu']
            .forEach((key) => cleaned.searchParams.delete(key));
          window.history.replaceState({}, '', `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
          return;
        } catch (cause) {
          lastError = cause;
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
          }
        }
      }
      if (!cancelled) {
        setInfo(lastError instanceof ApiError
          ? `O pagamento ainda não pôde ser confirmado: ${lastError.message} Você pode atualizar a página ou consultar Pedidos.`
          : 'O pagamento ainda não pôde ser confirmado. Atualize a página ou consulte Pedidos em instantes.');
      }
    };
    void confirmar();
    return () => { cancelled = true; };
  }, [syncOrdersStorage]);

  const addOrderCode = (code: string) => {
    setOrderCodes((current) => {
      const next = [code, ...current.filter((saved) => saved !== code)].slice(0, 30);
      void storage.setItem(ordersKeyRef.current, JSON.stringify(next));
      return next;
    });
  };

  const removeOrderCode = (code: string) => {
    setOrderCodes((current) => {
      const next = current.filter((saved) => saved !== code);
      void storage.setItem(ordersKeyRef.current, JSON.stringify(next));
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
      const perfume = itens.find((item) => item.id === orderItem.perfumeId && tamanhoDisponivel(item, orderItem.ml));
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

  const openContactUrl = (url: string) => {
    setContactOpen(false);
    Linking.openURL(url).catch(() => setInfo('Não foi possível abrir este canal de contato.'));
  };

  const openContactApp = (fallback: ContactFallback, appUrl: string) => {
    setContactOpen(false);
    setContactFallback(fallback);

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        window.location.assign(appUrl);
      } catch {
        window.location.assign(fallback.webUrl);
      }
      return;
    }

    Linking.openURL(appUrl)
      .catch(() => Linking.openURL(fallback.webUrl))
      .catch(() => {
        setContactFallback(null);
        setInfo('Não foi possível abrir este canal de contato.');
      });
  };

  const retryContactRedirect = () => {
    if (!contactFallback) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.assign(contactFallback.webUrl);
      return;
    }
    Linking.openURL(contactFallback.webUrl)
      .catch(() => {
        setContactFallback(null);
        setInfo('Não foi possível abrir este canal de contato.');
      });
  };

  const copyContact = async () => {
    if (!contactFallback) return;
    try {
      await Clipboard.setStringAsync(contactFallback.copyValue);
      const channel = contactFallback.channel;
      setContactFallback(null);
      setInfo(`Contato do ${channel} copiado.`);
    } catch {
      setContactFallback(null);
      setInfo('Não foi possível copiar o contato.');
    }
  };

  const openStoreWhatsapp = () => {
    if (!supportNumber) return;
    const message = `Olá! Gostaria de falar com a ${currentStore.nomeLoja}.`;
    const encodedMessage = encodeURIComponent(message);
    openContactApp(
      {
        channel: 'WhatsApp',
        webUrl: `https://wa.me/${supportNumber}?text=${encodedMessage}`,
        copyValue: currentStore.whatsapp || supportNumber,
      },
      `whatsapp://send?phone=${supportNumber}&text=${encodedMessage}`,
    );
  };

  const openStoreInstagram = () => {
    if (!instagramUrl) return;
    if (!instagramUsername) {
      openContactUrl(instagramUrl);
      return;
    }
    openContactApp(
      {
        channel: 'Instagram',
        webUrl: instagramUrl,
        copyValue: `@${instagramUsername}`,
      },
      `instagram://user?username=${encodeURIComponent(instagramUsername)}`,
    );
  };

  const refreshCatalog = useCallback(async () => {
    setRefreshing(true);
    await load(true);
  }, [load]);
  const pullToRefresh = useWebPullToRefresh(refreshing, refreshCatalog);

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.gold} />
          <Text style={{ color: COLORS.gold, marginTop: 12 }}>Conectando à vitrine…</Text>
          <Text style={{ color: COLORS.muted, marginTop: 6, textAlign: 'center', paddingHorizontal: 32 }}>
            No primeiro acesso, o servidor gratuito pode levar alguns instantes para acordar.
          </Text>
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
        <Feather name="user" size={14} color={STOREFRONT_COLORS.muted} />
      </Pressable>

      <View style={{ flex: 1 }} {...pullToRefresh.panHandlers}>
        {(refreshing || pullToRefresh.pullDistance > 0) && Platform.OS === 'web' && (
          <View style={styles.pullRefreshIndicator} pointerEvents="none">
            <ActivityIndicator size="small" color={COLORS.gold} animating={refreshing} />
            <Text style={styles.pullRefreshText}>
              {refreshing
                ? 'Atualizando vitrine…'
                : pullToRefresh.pullDistance >= pullToRefresh.releaseDistance
                  ? 'Solte para atualizar'
                  : 'Puxe para atualizar'}
            </Text>
          </View>
        )}
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshCatalog} tintColor={COLORS.gold} />}
        onScroll={pullToRefresh.onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View>
            <View style={styles.brandHeader}>
              {!!currentStore.logoUrl && !storeLogoFailed && (
                <Image
                  source={{ uri: currentStore.logoUrl }}
                  style={styles.storeLogo}
                  contentFit="contain"
                  transition={180}
                  onError={() => setStoreLogoFailed(true)}
                  accessibilityLabel={`Logo ${currentStore.nomeLoja}`}
                />
              )}
              {(!currentStore.logoUrl || storeLogoFailed) && !!brand.eyebrow && <Text style={styles.eyebrow}>{brand.eyebrow}</Text>}
              {(!currentStore.logoUrl || storeLogoFailed) && <Text style={styles.h1}>{brand.title}</Text>}
              <Text style={styles.subtitle}>PERFUMARIA AUTORAL</Text>
            </View>
            {!showEmpty && (
              <View style={{ paddingHorizontal: SPACING.lg }}>
                <View style={styles.searchBox}>
                  <Feather name="search" size={16} color={STOREFRONT_COLORS.muted} />
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Buscar fragrância, nota ou ocasião…"
                    placeholderTextColor={STOREFRONT_COLORS.muted}
                    style={styles.searchInput}
                    testID="vitrine-search"
                  />
                </View>
                <Pressable onPress={() => setQuizOpen(true)} style={styles.quizBanner} testID="quiz-open">
                  <View style={styles.quizIcon}>
                    <Feather name="compass" size={19} color={COLORS.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.quizTitle}>Encontre seu perfume</Text>
                    <Text style={styles.quizSubtitle}>Uma seleção personalizada em poucos passos</Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={COLORS.gold} />
                </Pressable>
                <View style={styles.quickFilters}>
                  <View style={styles.quickFilterRow}>
                    <Pressable
                      onPress={() => {
                        setFamiliaAtiva('Todas');
                        setOcasiaoAtiva('Todas');
                        setDisponibilidadeAtiva('pronta');
                      }}
                      style={[
                        styles.quickFilterButton,
                        styles.quickFilterGrow,
                        familiaAtiva === 'Todas'
                          && ocasiaoAtiva === 'Todas'
                          && disponibilidadeAtiva === 'pronta'
                          && styles.quickFilterButtonActive,
                      ]}
                      testID="filter-ready-delivery"
                    >
                      <Feather
                        name="package"
                        size={13}
                        color={
                          disponibilidadeAtiva === 'pronta'
                            && familiaAtiva === 'Todas'
                            && ocasiaoAtiva === 'Todas'
                            ? COLORS.ink
                            : COLORS.gold
                        }
                      />
                      <Text style={[
                        styles.quickFilterText,
                        disponibilidadeAtiva === 'pronta'
                          && familiaAtiva === 'Todas'
                          && ocasiaoAtiva === 'Todas'
                          && styles.quickFilterTextActive,
                      ]}>Pronta entrega</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setFamiliaAtiva('Todas');
                        setOcasiaoAtiva('Todas');
                        setDisponibilidadeAtiva('encomenda');
                      }}
                      style={[
                        styles.quickFilterButton,
                        styles.quickFilterGrow,
                        familiaAtiva === 'Todas'
                          && ocasiaoAtiva === 'Todas'
                          && disponibilidadeAtiva === 'encomenda'
                          && styles.quickFilterButtonActive,
                      ]}
                      testID="filter-made-to-order"
                    >
                      <Feather
                        name="clock"
                        size={13}
                        color={
                          disponibilidadeAtiva === 'encomenda'
                            && familiaAtiva === 'Todas'
                            && ocasiaoAtiva === 'Todas'
                            ? COLORS.ink
                            : COLORS.gold
                        }
                      />
                      <Text style={[
                        styles.quickFilterText,
                        disponibilidadeAtiva === 'encomenda'
                          && familiaAtiva === 'Todas'
                          && ocasiaoAtiva === 'Todas'
                          && styles.quickFilterTextActive,
                      ]}>Sob encomenda</Text>
                    </Pressable>
                  </View>
                  <View style={styles.quickFilterRow}>
                    <Pressable
                      onPress={() => {
                        setFamiliaAtiva('Favoritos');
                        setOcasiaoAtiva('Todas');
                        setDisponibilidadeAtiva('todas');
                      }}
                      style={[styles.quickFilterButton, styles.quickFilterGrow, familiaAtiva === 'Favoritos' && styles.quickFilterButtonActive]}
                      testID="filter-favorites"
                    >
                      {familiaAtiva === 'Favoritos' ? (
                        <FontAwesome name="heart" size={14} color={COLORS.favorite} />
                      ) : (
                        <Feather name="heart" size={14} color={COLORS.gold} />
                      )}
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
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          showEmpty ? (
            <View style={{ padding: SPACING.xl, alignItems: 'center' }}>
              <Text style={[styles.h1, { fontSize: FONT_SIZES.titleLarge, marginTop: 32 }]}>
                Vitrine em preparação
              </Text>
              <Text style={{ color: COLORS.muted, marginTop: 6, textAlign: 'center' }}>
                Volte em breve para conferir a coleção.
              </Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: SPACING.lg }}>
              <View style={styles.storefrontEmpty}>
                <Text style={styles.storefrontEmptyTitle}>Nenhuma fragrância encontrada</Text>
                <Text style={styles.storefrontEmptyText}>
                  {disponibilidadeAtiva === 'pronta'
                    ? 'Esta fragrância pode estar sob encomenda. Abra os filtros para ver todo o catálogo.'
                    : 'Ajuste os filtros para descobrir outras opções.'}
                </Text>
              </View>
            </View>
          )
        }
        contentContainerStyle={{ paddingHorizontal: SPACING.lg, paddingBottom: 160 }}
        />
      </View>

      {/* Atendimento e sugestões em um único ponto de contato */}
      <Pressable
        onPress={() => setContactOpen(true)}
        style={styles.fabSuggestion}
        testID="contact-fab"
        accessibilityRole="button"
        accessibilityLabel="Abrir atendimento"
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
            <Feather name="shopping-cart" size={23} color={STOREFRONT_COLORS.muted} />
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
            <Feather name="package" size={22} color={STOREFRONT_COLORS.muted} />
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
        cartaoOnlineAtivo={currentStore.cartaoOnlineAtivo}
        pixManualAtivo={currentStore.pixManualAtivo}
        onClose={() => setCartOpen(false)}
        onChangeQuantity={(index, quantity) => setCart((current) => (
          quantity <= 0
            ? current.filter((_, lineIndex) => lineIndex !== index)
            : current.map((line, lineIndex) => lineIndex === index ? { ...line, quantidade: Math.min(quantity, 20) } : line)
        ))}
        onRemove={(index) => setCart((current) => current.filter((_, lineIndex) => lineIndex !== index))}
        onStockConflict={load}
        onSuccess={async (order, message) => {
          setCart([]);
          setCartOpen(false);
          await saveOrderCode(order);
          setSuccessOrder(order);
          setPixCopied(false);
          setTrackingCodeOpen(false);
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
        supportWhatsapp={currentStore.whatsapp}
        storeName={currentStore.nomeLoja}
      />

      <BottomSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtrar fragrâncias" compact testID="filters-sheet">
        <View>
          <Text style={styles.filterSheetLabel}>DISPONIBILIDADE</Text>
          <View style={styles.filterSheetChips}>
            {([
              { id: 'pronta', label: 'Pronta entrega' },
              { id: 'encomenda', label: 'Sob encomenda' },
              { id: 'todas', label: 'Todo o catálogo' },
            ] as { id: AvailabilityFilter; label: string }[]).map((item) => (
              <Chip
                key={item.id}
                label={item.label}
                active={disponibilidadeAtiva === item.id}
                onPress={() => setDisponibilidadeAtiva(item.id)}
              />
            ))}
          </View>
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
              onPress={() => {
                setFamiliaAtiva('Todas');
                setOcasiaoAtiva('Todas');
                setDisponibilidadeAtiva('todas');
              }}
            />
            <PrimaryButton label="Aplicar filtros" onPress={() => setFiltersOpen(false)} />
          </View>
        </View>
      </BottomSheet>

      <BottomSheet visible={contactOpen} onClose={() => setContactOpen(false)} title="Fale Conosco" compact testID="contact-sheet">
        <View>
          <Text style={styles.contactIntro}>
            Escolha o melhor canal para conversar com a {currentStore.nomeLoja}.
          </Text>
          {!!supportNumber && (
            <Pressable onPress={openStoreWhatsapp} style={styles.contactAction} testID="contact-whatsapp">
              <View style={styles.contactActionIcon}><Feather name="message-circle" size={17} color={COLORS.gold} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactActionTitle}>WhatsApp</Text>
                <Text style={styles.contactActionSubtitle}>Atendimento e informações sobre pedidos</Text>
              </View>
              <Feather name="arrow-up-right" size={15} color={COLORS.muted} />
            </Pressable>
          )}
          {!!instagramUrl && (
            <Pressable onPress={openStoreInstagram} style={styles.contactAction} testID="contact-instagram">
              <View style={styles.contactActionIcon}><Feather name="instagram" size={17} color={COLORS.gold} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactActionTitle}>Instagram</Text>
                <Text style={styles.contactActionSubtitle}>{currentStore.instagram}</Text>
              </View>
              <Feather name="arrow-up-right" size={15} color={COLORS.muted} />
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              setContactOpen(false);
              setSugestaoOpen(true);
            }}
            style={styles.contactAction}
            testID="contact-suggestion"
          >
            <View style={styles.contactActionIcon}><Feather name="star" size={17} color={COLORS.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactActionTitle}>Sugestões</Text>
              <Text style={styles.contactActionSubtitle}>Conte qual perfume você gostaria de encontrar</Text>
            </View>
            <Feather name="chevron-right" size={15} color={COLORS.muted} />
          </Pressable>
          <Pressable
            onPress={() => {
              setContactOpen(false);
              setFaqOpen(true);
            }}
            style={styles.contactAction}
            testID="contact-faq"
          >
            <View style={styles.contactActionIcon}><Feather name="help-circle" size={17} color={COLORS.gold} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.contactActionTitle}>Dúvidas e prazos</Text>
              <Text style={styles.contactActionSubtitle}>Entrega, pagamento, acompanhamento e trocas</Text>
            </View>
            <Feather name="chevron-right" size={15} color={COLORS.muted} />
          </Pressable>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={faqOpen}
        onClose={() => setFaqOpen(false)}
        title="Central de Ajuda"
        testID="faq-sheet"
      >
        <View>
          <Text style={styles.faqIntro}>Tudo o que você precisa saber antes da sua compra.</Text>
          {FAQ_ITEMS.map((item, index) => {
            const expanded = faqExpanded === index;
            return (
              <Pressable
                key={item.question}
                onPress={() => setFaqExpanded(expanded ? null : index)}
                style={[styles.faqItem, expanded && styles.faqItemExpanded]}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                testID={`faq-item-${index}`}
              >
                <View style={styles.faqQuestionRow}>
                  <View style={styles.faqQuestionIcon}>
                    <Feather name={item.icon} size={15} color={COLORS.gold} />
                  </View>
                  <Text style={styles.faqQuestion}>{item.question}</Text>
                  <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.gold} />
                </View>
                {expanded && <Text style={styles.faqAnswer}>{item.answer}</Text>}
              </Pressable>
            );
          })}
          {!!supportNumber && (
            <Pressable
              onPress={() => {
                setFaqOpen(false);
                openStoreWhatsapp();
              }}
              style={[styles.contactAction, styles.faqWhatsapp]}
              testID="faq-whatsapp"
            >
              <View style={styles.contactActionIcon}><Feather name="message-circle" size={17} color={COLORS.gold} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.contactActionTitle}>Ainda ficou com alguma dúvida?</Text>
                <Text style={styles.contactActionSubtitle}>Nossa equipe responde pelo WhatsApp</Text>
              </View>
              <Feather name="arrow-up-right" size={15} color={COLORS.muted} />
            </Pressable>
          )}
        </View>
      </BottomSheet>

      <BottomSheet
        visible={!!contactFallback}
        onClose={() => setContactFallback(null)}
        title="Não abriu?"
        compact
        testID="contact-fallback-sheet"
      >
        <View>
          <Text style={styles.contactFallbackText}>
            Se o redirecionamento para o {contactFallback?.channel} não aconteceu, tente novamente ou copie o contato.
          </Text>
          <View style={styles.contactFallbackActions}>
            <SecondaryButton label="Copiar contato" onPress={() => { void copyContact(); }} />
            <PrimaryButton label="Tentar novamente" onPress={retryContactRedirect} testID="contact-retry" />
          </View>
        </View>
      </BottomSheet>

      {/* Sugestão sheet */}
      <BottomSheet visible={sugestaoOpen} onClose={() => setSugestaoOpen(false)} title="Enviar sugestão" testID="sugestao-sheet">
        <View>
          <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.bodySmall, marginBottom: SPACING.md }}>Que fragrância você gostaria de ver na nossa vitrine? Escreva aqui.</Text>
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

      <BottomSheet
        visible={!!orderSuccess}
        onClose={() => {
          setOrderSuccess(null);
          setTrackingCodeOpen(false);
        }}
        title={pagamentoConfirmado
          ? 'Pagamento confirmado'
          : pagamentoAutomaticoPendente
            ? 'Pagamento pendente'
            : 'Pedido recebido'}
        compact
        contentContainerStyle={styles.successSheetBody}
        testID="order-success-sheet"
      >
        <View style={styles.successContent}>
          <View style={styles.successIcon}>
            <Feather name={pagamentoAutomaticoPendente ? 'credit-card' : 'check'} size={30} color={COLORS.ink} />
          </View>
          <Text style={styles.successEyebrow}>
            {pagamentoConfirmado
              ? 'PAGAMENTO APROVADO'
              : pagamentoAutomaticoPendente
                ? 'PAGAMENTO PENDENTE'
                : manualPixCode
                  ? 'PEDIDO REGISTRADO'
                  : 'OBRIGADO PELA SUA COMPRA'}
          </Text>
          <Text style={styles.successTitle}>
            {pagamentoConfirmado
              ? 'Tudo certo com seu pagamento!'
              : pagamentoAutomaticoPendente
                ? 'Finalize seu pagamento'
                : manualPixCode
                  ? 'Agora, conclua o pagamento'
                  : 'Seu pedido foi recebido!'}
          </Text>
          {!!successOrder?.seq && (
            <Text style={styles.successOrderNumber}>PEDIDO Nº {padSeq(successOrder.seq)}</Text>
          )}
          <Text style={styles.successText}>
            {pagamentoAutomaticoPendente
              ? 'Escolha Pix ou cartão na InfinitePay. A confirmação do pedido será automática.'
              : pagamentoConfirmado
                ? `A ${currentStore.nomeLoja} já recebeu a confirmação e dará continuidade ao pedido.`
                : `A ${currentStore.nomeLoja} agradece por fazer parte deste momento.`}
          </Text>
          {!!manualPixCode && (
            <View style={styles.pixCard}>
              <View style={styles.pixHeading}>
                <View>
                  <Text style={styles.pixEyebrow}>PIX · {successOrder?.pagamento?.instituicao || 'PicPay'}</Text>
                  <Text style={styles.pixValue}>{brl(successOrder?.pagamento?.valor || successOrder?.total || 0)}</Text>
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
                  color={COLORS.ink}
                  backgroundColor={COLORS.white}
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
          {!manualPixCode && !pagamentoAutomaticoPendente && !pagamentoConfirmado && (
            <View style={styles.successNextStep}>
              <Feather name="message-circle" size={18} color={COLORS.gold} />
              <Text style={styles.successNextText}>{orderSuccess}</Text>
            </View>
          )}
          {pagamentoAutomaticoPendente && (
            <Pressable
              onPress={() => void Linking.openURL(automaticCheckoutUrl)}
              style={[styles.copyPixButton, styles.paymentContinueButton]}
              testID="continue-infinitepay"
            >
              <Feather name="external-link" size={16} color={COLORS.ink} />
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} style={styles.copyPixText}>Pagar na InfinitePay</Text>
            </Pressable>
          )}
          {!!successTrackingCode && !pagamentoAutomaticoPendente && !pagamentoConfirmado && (
            <View style={styles.trackingAccess}>
              <Pressable
                onPress={() => setTrackingCodeOpen((open) => !open)}
                style={({ pressed }) => [styles.trackingAccessButton, pressed && { opacity: 0.82 }]}
                accessibilityRole="button"
                accessibilityLabel="Acessar pedido em outro aparelho"
                testID="tracking-code-toggle"
              >
                <View style={styles.trackingKeyIcon}>
                  <Feather name="key" size={16} color={COLORS.gold} />
                </View>
                <View style={styles.trackingAccessCopy}>
                  <Text style={styles.trackingAccessTitle}>Acessar em outro aparelho</Text>
                  <Text style={styles.trackingAccessHint}>Use o código exclusivo deste pedido</Text>
                </View>
                <Feather name={trackingCodeOpen ? 'chevron-up' : 'chevron-down'} size={17} color={COLORS.muted} />
              </Pressable>
              {trackingCodeOpen && (
                <View style={styles.trackingCodeCard}>
                  <Text style={styles.trackingCodeLabel}>CÓDIGO PARA ACESSAR EM OUTRO APARELHO</Text>
                  <Text selectable style={styles.trackingCode}>{successTrackingCode}</Text>
                  <Pressable
                    onPress={() => {
                      void Share.share({
                        message: `Meu pedido ${currentStore.nomeLoja} pode ser acompanhado com este código: ${successTrackingCode}`,
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
            </View>
          )}
          <View style={{ width: '100%', gap: 8 }}>
            {!!successOrder?.codigoAcompanhamento && !pagamentoAutomaticoPendente && (
              <SecondaryButton
                label="Acompanhar meu pedido"
                onPress={() => {
                  setOrderSuccess(null);
                  setTrackingCodeOpen(false);
                  setOrdersOpen(true);
                }}
              />
            )}
            {pagamentoAutomaticoPendente ? (
              <SecondaryButton
                label="Voltar à vitrine"
                onPress={() => {
                  setOrderSuccess(null);
                  setTrackingCodeOpen(false);
                }}
                testID="success-close"
              />
            ) : (
              <PrimaryButton
                label={pagamentoConfirmado ? 'Fechar agora' : 'Voltar à vitrine'}
                onPress={() => {
                  setOrderSuccess(null);
                  setTrackingCodeOpen(false);
                }}
                testID="success-close"
              />
            )}
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
          <Text style={styles.successText}>Recebemos sua sugestão com carinho e vamos trabalhar em cima do seu feedback para tornar a experiência {currentStore.nomeLoja} ainda mais especial.</Text>
          <PrimaryButton label="Continuar explorando" onPress={() => setSuggestionSuccess(false)} testID="suggestion-success-close" />
        </View>
      </BottomSheet>

      {/* Review (avaliação do cliente) */}
      <BottomSheet visible={!!reviewItem} onClose={() => setReviewItem(null)} title="Deixar avaliação" testID="review-sheet">
        {reviewItem && (
          <View>
            <View style={{ padding: SPACING.md, borderRadius: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md }}>
              <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.subtitle, fontWeight: '600', textAlign: 'center' }}>{reviewItem.nome}</Text>
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
  screen: { flex: 1, backgroundColor: STOREFRONT_COLORS.background },
  pullRefreshIndicator: { position: 'absolute', zIndex: 20, top: 6, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, minHeight: 34, borderRadius: RADIUS.pill, backgroundColor: STOREFRONT_COLORS.surface, borderWidth: 1, borderColor: STOREFRONT_COLORS.border },
  pullRefreshText: { color: STOREFRONT_COLORS.muted, fontSize: FONT_SIZES.caption },
  brandHeader: { alignItems: 'center', paddingHorizontal: 56, paddingTop: 26, paddingBottom: 20 },
  storeLogo: { width: 118, height: 86, marginBottom: 4 },
  eyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 5, fontWeight: '500' },
  h1: { color: STOREFRONT_COLORS.ink, fontSize: FONT_SIZES.display, lineHeight: 30, letterSpacing: 1.5, fontWeight: '700', marginTop: 7 },
  subtitle: { color: STOREFRONT_COLORS.muted, fontSize: FONT_SIZES.caption, letterSpacing: 2.2, marginTop: 5 },
  atelieAccess: { position: 'absolute', top: 51, right: SPACING.lg, zIndex: 40, width: 32, height: 32, borderRadius: 16, backgroundColor: STOREFRONT_COLORS.surface, borderWidth: 1, borderColor: STOREFRONT_COLORS.border, alignItems: 'center', justifyContent: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 11, height: 60, paddingHorizontal: 18, backgroundColor: STOREFRONT_COLORS.surface, borderWidth: 1, borderColor: STOREFRONT_COLORS.border, borderRadius: RADIUS.md, marginBottom: 12 },
  searchInput: { flex: 1, color: STOREFRONT_COLORS.ink, paddingVertical: 15, fontSize: FONT_SIZES.body },
  quizBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 60, paddingHorizontal: 18, paddingVertical: 6, borderRadius: RADIUS.md, backgroundColor: STOREFRONT_COLORS.surfaceRaised, borderWidth: 1, borderColor: STOREFRONT_COLORS.gold + '88', marginBottom: 12 },
  quizIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  quizTitle: { color: STOREFRONT_COLORS.ink, fontSize: FONT_SIZES.body, fontWeight: '700' },
  quizSubtitle: { color: STOREFRONT_COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  quickFilters: { gap: 8, paddingVertical: 8, marginBottom: SPACING.sm },
  quickFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quickFilterButton: { minHeight: 40, paddingHorizontal: 14, borderRadius: RADIUS.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: STOREFRONT_COLORS.border, backgroundColor: STOREFRONT_COLORS.surface },
  quickFilterGrow: { flex: 1 },
  quickFilterButtonActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  quickFilterText: { color: STOREFRONT_COLORS.muted, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  quickFilterTextActive: { color: COLORS.ink },
  storefrontEmpty: { alignItems: 'center', padding: SPACING.xl, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: STOREFRONT_COLORS.border, backgroundColor: STOREFRONT_COLORS.surface },
  storefrontEmptyTitle: { color: STOREFRONT_COLORS.ink, fontSize: FONT_SIZES.body, fontWeight: '700' },
  storefrontEmptyText: { color: STOREFRONT_COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 5, textAlign: 'center' },
  filterBadge: { minWidth: 17, height: 17, paddingHorizontal: 4, borderRadius: 9, backgroundColor: COLORS.ink, alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '700' },
  filterSheetLabel: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.2, marginBottom: 9 },
  filterSheetChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.lg },
  filterSheetActions: { flexDirection: 'row', gap: 8, marginTop: SPACING.sm },
  contactIntro: { color: COLORS.muted, fontSize: FONT_SIZES.label, lineHeight: 18, marginBottom: SPACING.md },
  contactAction: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, marginBottom: 8, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  contactActionIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.gold + '55', backgroundColor: COLORS.surfaceRaised },
  contactActionTitle: { color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '700' },
  contactActionSubtitle: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 13, marginTop: 2 },
  faqIntro: { color: COLORS.muted, fontSize: FONT_SIZES.label, lineHeight: 18, marginBottom: SPACING.md },
  faqItem: { padding: 13, marginBottom: 8, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  faqItemExpanded: { borderColor: COLORS.gold + '99', backgroundColor: COLORS.surface },
  faqQuestionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  faqQuestionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.gold + '55', backgroundColor: COLORS.surfaceRaised },
  faqQuestion: { flex: 1, color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '700' },
  faqAnswer: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 17, marginTop: 10, marginLeft: 42, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  faqWhatsapp: { marginTop: SPACING.sm },
  contactFallbackText: { color: COLORS.bone, fontSize: FONT_SIZES.label, lineHeight: 18, marginBottom: SPACING.lg },
  contactFallbackActions: { flexDirection: 'row', gap: 8 },
  card: {
    backgroundColor: PRODUCT_CARD_COLORS.background,
    borderWidth: 1,
    borderColor: PRODUCT_CARD_COLORS.border,
    borderRadius: RADIUS.lg,
    marginBottom: 14,
    padding: SPACING.md,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  cardFavorite: { position: 'absolute', right: 10, top: 9, zIndex: 4, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: PRODUCT_CARD_COLORS.border },
  productTop: { flexDirection: 'row', gap: SPACING.md },
  imageFrame: { width: 108, height: 116, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: PRODUCT_CARD_COLORS.imageBackground, borderWidth: 1, borderColor: PRODUCT_CARD_COLORS.border },
  productImage: { width: '100%', height: '100%' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  imagePlaceholderText: { color: PRODUCT_CARD_COLORS.muted, fontSize: FONT_SIZES.caption },
  productInfo: { flex: 1, minWidth: 0, paddingTop: 2 },
  cardTitle: { color: PRODUCT_CARD_COLORS.ink, fontSize: FONT_SIZES.subtitle, lineHeight: 21, fontWeight: '700' },
  occasionLabel: { color: PRODUCT_CARD_COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.1, marginTop: 9 },
  cardSub: { color: PRODUCT_CARD_COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15, marginTop: 2 },
  familySummary: { color: PRODUCT_CARD_COLORS.text, fontSize: FONT_SIZES.caption, lineHeight: 14, marginTop: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 5 },
  metaText: { color: PRODUCT_CARD_COLORS.muted, fontSize: FONT_SIZES.caption },
  availabilityDot: { width: 6, height: 6, borderRadius: 3, marginLeft: 2 },
  sizeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: SPACING.md },
  sizeButton: { flexGrow: 1, minWidth: 86, paddingHorizontal: 9, paddingVertical: 7, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: PRODUCT_CARD_COLORS.gold, alignItems: 'center', backgroundColor: COLORS.surface },
  sizeButtonPressed: { backgroundColor: COLORS.surfaceRaised },
  sizeButtonDisabled: { borderColor: PRODUCT_CARD_COLORS.border, opacity: 0.65 },
  sizeButtonText: { color: PRODUCT_CARD_COLORS.ink, fontSize: FONT_SIZES.label, lineHeight: 15, fontWeight: '700' },
  sizePrice: { color: PRODUCT_CARD_COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 12, marginTop: 1 },
  notes: { borderTopWidth: 1, borderTopColor: PRODUCT_CARD_COLORS.border, marginTop: SPACING.md, paddingTop: 10, gap: 6 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  noteLabel: { width: 72, flexShrink: 0, color: PRODUCT_CARD_COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15, letterSpacing: 0.8 },
  noteValue: { flex: 1, color: PRODUCT_CARD_COLORS.text, fontSize: FONT_SIZES.caption, lineHeight: 15, fontStyle: 'italic' },
  notesEmpty: { borderTopWidth: 1, borderTopColor: PRODUCT_CARD_COLORS.border, marginTop: SPACING.md, paddingTop: 10 },
  notesEmptyText: { color: PRODUCT_CARD_COLORS.muted, fontSize: FONT_SIZES.caption, fontStyle: 'italic' },
  cardActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 },
  reviewButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  reviewText: { color: PRODUCT_CARD_COLORS.gold, fontSize: FONT_SIZES.caption },
  detailsButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  detailsText: { color: PRODUCT_CARD_COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  fabSuggestion: { position: 'absolute', right: 20, bottom: 92, width: 50, height: 50, borderRadius: 25, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', paddingTop: 10, paddingBottom: 18, backgroundColor: STOREFRONT_COLORS.surface, borderTopWidth: 1, borderTopColor: STOREFRONT_COLORS.border },
  navItem: { flex: 1, minHeight: 47, alignItems: 'center', justifyContent: 'center' },
  navTextActive: { color: COLORS.gold, fontSize: FONT_SIZES.caption, marginTop: 3 },
  navText: { color: STOREFRONT_COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 3 },
  cartBadge: { position: 'absolute', top: -7, right: -10, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  cartBadgeText: { color: COLORS.ink, fontSize: FONT_SIZES.caption, fontWeight: '700' },
  successSheetBody: { paddingTop: SPACING.md, paddingBottom: SPACING.xl },
  successContent: { alignItems: 'center', paddingTop: 0 },
  successIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.md },
  successEyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.6, textAlign: 'center' },
  successTitle: { color: COLORS.bone, fontSize: FONT_SIZES.title, lineHeight: 25, fontWeight: '700', textAlign: 'center', marginTop: 5 },
  successOrderNumber: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.2, marginTop: 7 },
  successText: { width: '100%', color: COLORS.muted, fontSize: FONT_SIZES.label, lineHeight: 18, textAlign: 'center', marginTop: 7, marginBottom: SPACING.md },
  successNextStep: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, marginBottom: SPACING.lg },
  pixCard: { width: '100%', padding: SPACING.lg, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.gold + '66', backgroundColor: COLORS.surface, marginBottom: SPACING.md },
  pixHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  pixEyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.2 },
  pixValue: { color: COLORS.bone, fontSize: FONT_SIZES.titleLarge, fontWeight: '700', marginTop: 2 },
  pixPendingPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: COLORS.gold + '66', borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 5 },
  pixPendingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.gold },
  pixPendingText: { color: COLORS.gold, fontSize: FONT_SIZES.caption },
  qrFrame: { alignSelf: 'center', backgroundColor: COLORS.white, padding: 12, borderRadius: RADIUS.md, marginBottom: SPACING.md },
  pixHint: { color: COLORS.muted, fontSize: FONT_SIZES.label, lineHeight: 17, textAlign: 'center', marginBottom: SPACING.md },
  copyPixButton: { minHeight: 46, borderRadius: RADIUS.md, backgroundColor: COLORS.gold, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  paymentContinueButton: { width: '100%', minHeight: 50, paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  copyPixText: { color: COLORS.ink, fontSize: FONT_SIZES.body, fontWeight: '700' },
  manualConfirmation: { color: COLORS.muted, fontSize: FONT_SIZES.caption, textAlign: 'center', marginTop: 10 },
  successNextText: { flex: 1, color: COLORS.bone, fontSize: FONT_SIZES.label, lineHeight: 18 },
  trackingAccess: { width: '100%', marginBottom: SPACING.lg },
  trackingAccessButton: { width: '100%', minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SPACING.md, paddingVertical: 10, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  trackingKeyIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.gold + '70', backgroundColor: COLORS.surface },
  trackingAccessCopy: { flex: 1 },
  trackingAccessTitle: { color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '700' },
  trackingAccessHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  trackingCodeCard: { width: '100%', alignItems: 'center', padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.gold + '55', backgroundColor: COLORS.gold + '0C', marginTop: 8 },
  trackingCodeLabel: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.1, textAlign: 'center' },
  trackingCode: { color: COLORS.bone, fontSize: FONT_SIZES.subtitle, fontWeight: '700', letterSpacing: 1.2, marginTop: 8 },
  shareCodeButton: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 36, paddingHorizontal: 12, marginTop: 7 },
  shareCodeText: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600' },
});
