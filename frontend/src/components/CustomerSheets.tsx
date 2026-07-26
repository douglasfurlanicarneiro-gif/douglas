import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { acompanharPedido } from '../api';
import { brl, COLORS, fmtDate, OCASIOES, RADIUS, SPACING, STATUS } from '../theme';
import type { Acompanhamento, Perfume } from '../types';
import { BottomSheet } from './BottomSheet';
import { Chip, PrimaryButton, SecondaryButton } from './atoms';

export function PerfumeDetailSheet({
  perfume,
  favorite,
  onClose,
  onToggleFavorite,
  onBuy,
}: {
  perfume: Perfume | null;
  favorite: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
  onBuy: (ml: number, preco: number) => void;
}) {
  return (
    <BottomSheet visible={!!perfume} onClose={onClose} title="Detalhes da fragrância">
      {perfume && (
        <View>
          <View style={styles.detailHero}>
            {perfume.imagemUrl ? (
              <Image source={{ uri: perfume.imagemUrl }} style={styles.detailImage} contentFit="contain" transition={150} />
            ) : (
              <View style={[styles.detailImage, styles.placeholder]}>
                <Feather name="image" size={34} color={COLORS.muted} />
              </View>
            )}
            <Pressable onPress={onToggleFavorite} style={styles.heartButton}>
              <Feather name="heart" size={20} color={favorite ? COLORS.wine : COLORS.gold} />
            </Pressable>
          </View>
          <Text style={styles.eyebrow}>FRAGRÂNCIA Nº {String(perfume.seq || 0).padStart(3, '0')}</Text>
          <Text style={styles.detailTitle}>{perfume.nome}</Text>
          <Text style={styles.detailMeta}>{perfume.familia} · {perfume.concentracao}</Text>

          <View style={styles.occasionBox}>
            <Text style={styles.sectionLabel}>CLIMA & OCASIÃO</Text>
            <Text style={styles.bodyText}>
              {perfume.ocasioes?.length ? perfume.ocasioes.join(' · ') : 'Versátil · Todas as ocasiões'}
            </Text>
          </View>

          <Text style={styles.sectionLabel}>PIRÂMIDE OLFATIVA</Text>
          <Note label="TOPO" value={perfume.notasSaida} />
          <Note label="CORAÇÃO" value={perfume.notasCoracao} />
          <Note label="BASE" value={perfume.notasFundo} />

          <Text style={[styles.sectionLabel, { marginTop: SPACING.lg }]}>ESCOLHA O TAMANHO</Text>
          <View style={styles.sizeWrap}>
            {perfume.precos.map((opcao) => (
              <Pressable
                key={opcao.ml}
                disabled={!perfume.disponivel}
                onPress={() => onBuy(opcao.ml, opcao.preco)}
                style={[styles.sizeButton, !perfume.disponivel && { opacity: 0.45 }]}
              >
                <Text style={styles.sizeText}>+ {opcao.ml}ml</Text>
                <Text style={styles.sizePrice}>{brl(opcao.preco)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </BottomSheet>
  );
}

function Note({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.noteRow}>
      <Text style={styles.noteLabel}>{label}</Text>
      <Text style={styles.noteValue}>{value || 'Em atualização'}</Text>
    </View>
  );
}

export function QuizSheet({
  visible,
  perfumes,
  onClose,
  onDetails,
}: {
  visible: boolean;
  perfumes: Perfume[];
  onClose: () => void;
  onDetails: (perfume: Perfume) => void;
}) {
  const familias = useMemo(
    () => Array.from(new Set(perfumes.map((item) => item.familia).filter(Boolean))),
    [perfumes],
  );
  const ocasioes = useMemo(
    () => Array.from(new Set([
      ...perfumes.flatMap((item) => item.ocasioes || []),
      ...OCASIOES,
    ])).slice(0, 12),
    [perfumes],
  );
  const [familia, setFamilia] = useState('');
  const [ocasiao, setOcasiao] = useState('');
  const [resultado, setResultado] = useState(false);

  const recomendados = useMemo(() => [...perfumes]
    .map((perfume) => ({
      perfume,
      pontos:
        (familia && perfume.familia === familia ? 4 : 0)
        + (ocasiao && perfume.ocasioes?.includes(ocasiao) ? 3 : 0)
        + (perfume.disponivel ? 1 : 0),
    }))
    .sort((a, b) => b.pontos - a.pontos || a.perfume.nome.localeCompare(b.perfume.nome))
    .slice(0, 3), [familia, ocasiao, perfumes]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Encontre sua essência">
      <View>
        <Text style={styles.quizLead}>
          Responda duas perguntas e descubra fragrâncias que combinam com o seu momento.
        </Text>
        <Text style={styles.sectionLabel}>1. QUAL UNIVERSO MAIS ATRAI VOCÊ?</Text>
        <View style={styles.chips}>
          {familias.map((item) => (
            <Chip key={item} label={item} active={familia === item} onPress={() => { setFamilia(item); setResultado(false); }} />
          ))}
        </View>
        <Text style={[styles.sectionLabel, { marginTop: SPACING.lg }]}>2. QUANDO PRETENDE USAR?</Text>
        <View style={styles.chips}>
          {ocasioes.map((item) => (
            <Chip key={item} label={item} active={ocasiao === item} onPress={() => { setOcasiao(item); setResultado(false); }} />
          ))}
        </View>
        <View style={{ marginTop: SPACING.xl }}>
          <PrimaryButton
            label="Revelar minhas fragrâncias"
            disabled={!familia || !ocasiao}
            onPress={() => setResultado(true)}
          />
        </View>

        {resultado && (
          <View style={styles.results}>
            <Text style={styles.resultTitle}>Sua seleção L’Essence</Text>
            <Text style={styles.resultSub}>Escolhemos estas fragrâncias especialmente para você.</Text>
            {recomendados.map(({ perfume }, index) => (
              <Pressable key={perfume.id} onPress={() => onDetails(perfume)} style={styles.resultCard}>
                <View style={styles.resultNumber}><Text style={styles.resultNumberText}>{index + 1}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultName}>{perfume.nome}</Text>
                  <Text style={styles.resultMeta}>{perfume.familia} · {(perfume.ocasioes || []).join(' · ')}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={COLORS.gold} />
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

export function OrdersSheet({
  visible,
  codes,
  onClose,
  onRebuy,
}: {
  visible: boolean;
  codes: string[];
  onClose: () => void;
  onRebuy: (order: Acompanhamento) => void;
}) {
  const [orders, setOrders] = useState<Acompanhamento[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !codes.length) return;
    setLoading(true);
    Promise.all(codes.map((code) => acompanharPedido(code).catch(() => null)))
      .then((result) => setOrders(
        result.filter((item): item is Acompanhamento => !!item)
          .sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime()),
      ))
      .finally(() => setLoading(false));
  }, [codes, visible]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Meus pedidos"
      contentContainerStyle={!loading && orders.length === 0 ? styles.emptyOrdersContent : undefined}
    >
      {loading && <ActivityIndicator color={COLORS.gold} style={{ margin: 30 }} />}
      {!loading && orders.length === 0 && (
        <View style={styles.emptyOrders}>
          <View style={styles.emptyOrdersGlow}>
            <View style={styles.emptyOrdersIcon}>
              <Feather name="package" size={30} color={COLORS.ink} />
            </View>
          </View>
          <Text style={styles.emptyEyebrow}>SUA JORNADA L’ESSENCE</Text>
          <Text style={styles.emptyTitle}>Seu próximo perfume está aqui ✨!</Text>
          <View style={styles.privacyNote}>
            <Feather name="shield" size={16} color={COLORS.gold} />
            <Text style={styles.privacyText}>
              Este espaço é exclusivamente seu! Seus pedidos e suas informações serão todos privados.
            </Text>
          </View>
          <View style={{ width: '100%', marginTop: SPACING.lg }}>
            <PrimaryButton label="Descobrir fragrâncias" onPress={onClose} />
          </View>
        </View>
      )}
      {!loading && orders.map((order) => {
        const status = STATUS.find((item) => item.id === order.status) || STATUS[0];
        return (
          <View key={order.codigoAcompanhamento} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <View>
                <Text style={styles.eyebrow}>PEDIDO Nº {String(order.seq || 0).padStart(3, '0')}</Text>
                <Text style={styles.orderDate}>{fmtDate(order.criadoEm)}</Text>
              </View>
              <View style={[styles.statusPill, { borderColor: status.color }]}>
                <Text style={{ color: status.color, fontSize: 11 }}>{status.label}</Text>
              </View>
            </View>
            {order.itens.map((item, index) => (
              <View key={`${item.perfumeId}-${item.ml}-${index}`} style={styles.orderItem}>
                <Text style={styles.bodyText}>{item.quantidade}× {item.perfumeNome}</Text>
                <Text style={styles.orderItemMeta}>{item.ml}ml · {brl(item.subtotal || item.precoUnitario)}</Text>
              </View>
            ))}
            <View style={styles.orderTotal}>
              <Text style={styles.detailMeta}>Total</Text>
              <Text style={styles.resultName}>{brl(order.total)}</Text>
            </View>
            <Text style={[styles.sectionLabel, { marginTop: SPACING.md }]}>ACOMPANHAMENTO</Text>
            {(order.historicoStatus?.length ? order.historicoStatus : [{ status: order.status, data: order.criadoEm }]).map((entry, index) => {
              const step = STATUS.find((item) => item.id === entry.status) || STATUS[0];
              return (
                <View key={`${entry.status}-${entry.data}-${index}`} style={styles.timeline}>
                  <View style={[styles.timelineDot, { backgroundColor: step.color }]} />
                  <Text style={styles.timelineText}>{step.label}</Text>
                  <Text style={styles.timelineDate}>{fmtDate(entry.data)}</Text>
                </View>
              );
            })}
            <SecondaryButton label="Comprar novamente" onPress={() => onRebuy(order)} />
          </View>
        );
      })}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  detailHero: { height: 250, borderRadius: RADIUS.lg, overflow: 'hidden', backgroundColor: COLORS.ink, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.lg },
  detailImage: { width: '100%', height: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  heartButton: { position: 'absolute', right: 12, top: 12, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border },
  eyebrow: { color: COLORS.gold, fontSize: 10, letterSpacing: 1.5 },
  detailTitle: { color: COLORS.bone, fontSize: 25, fontWeight: '700', marginTop: 4 },
  detailMeta: { color: COLORS.muted, fontSize: 13, marginTop: 3 },
  occasionBox: { backgroundColor: COLORS.ink, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: SPACING.md, marginVertical: SPACING.lg },
  sectionLabel: { color: COLORS.gold, fontSize: 10, letterSpacing: 1.3, marginBottom: 8 },
  bodyText: { color: COLORS.bone, fontSize: 13 },
  noteRow: { flexDirection: 'row', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  noteLabel: { color: COLORS.muted, width: 70, fontSize: 11 },
  noteValue: { color: COLORS.bone, flex: 1, fontSize: 13, fontStyle: 'italic' },
  sizeWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sizeButton: { minWidth: 94, flexGrow: 1, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: COLORS.gold, borderRadius: RADIUS.md },
  sizeText: { color: COLORS.gold, fontWeight: '700' },
  sizePrice: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  quizLead: { color: COLORS.bone, fontSize: 15, lineHeight: 22, marginBottom: SPACING.xl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  results: { marginTop: SPACING.xl, paddingTop: SPACING.lg, borderTopWidth: 1, borderTopColor: COLORS.border },
  resultTitle: { color: COLORS.bone, fontSize: 21, fontWeight: '700' },
  resultSub: { color: COLORS.muted, fontSize: 13, marginTop: 4, marginBottom: SPACING.md },
  resultCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, backgroundColor: COLORS.ink, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: 8 },
  resultNumber: { width: 30, height: 30, borderRadius: 15, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  resultNumberText: { color: COLORS.ink, fontWeight: '700' },
  resultName: { color: COLORS.bone, fontSize: 14, fontWeight: '600' },
  resultMeta: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  orderCard: { backgroundColor: COLORS.ink, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.md },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md },
  orderDate: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  orderItem: { paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  orderItemMeta: { color: COLORS.muted, fontSize: 11, marginTop: 2 },
  orderTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SPACING.md },
  timeline: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  timelineDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  timelineText: { color: COLORS.bone, fontSize: 12, flex: 1 },
  timelineDate: { color: COLORS.muted, fontSize: 10 },
  emptyOrdersContent: { flexGrow: 1, justifyContent: 'center', paddingBottom: SPACING.lg },
  emptyOrders: { width: '100%', alignItems: 'center', paddingHorizontal: SPACING.sm, paddingVertical: SPACING.lg },
  emptyOrdersGlow: { width: 92, height: 92, borderRadius: 46, backgroundColor: COLORS.gold + '18', alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  emptyOrdersIcon: { width: 62, height: 62, borderRadius: 31, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.gold, shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  emptyEyebrow: { color: COLORS.gold, fontSize: 10, letterSpacing: 1.8, textAlign: 'center' },
  emptyTitle: { color: COLORS.bone, fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: 'center', marginTop: 8, maxWidth: 300 },
  privacyNote: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: SPACING.md, marginTop: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.gold + '45', backgroundColor: COLORS.ink },
  privacyText: { flex: 1, color: COLORS.bone, fontSize: 11, lineHeight: 17 },
});
