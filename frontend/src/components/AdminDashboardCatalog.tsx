import React from 'react';
import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { COLORS, FONT_SIZES, RADIUS, SPACING, STATUS, brl, familiasDoPerfume, fmtDate, nomeConcentracao, padSeq } from '../theme';
import type { Metricas, Perfume } from '../types';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import type { AdminPedido } from './AdminOrderCards';
import { AppText as Text, AppTextInput as TextInput } from './Typography';
import { EmptyState } from './atoms';

export type MetricPeriod = '7d' | '30d' | 'mes' | 'todos';

type EstoqueDisponivel = {
  disponivelMl: number;
  reservadoMl: number;
};

type FeatherIconName = React.ComponentProps<typeof Feather>['name'];

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: FeatherIconName }) {
  return (
    <View style={styles.statCard}>
      <Feather name={icon} size={16} color={COLORS.gold} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function AdminDashboard({
  perfumeCount,
  estoqueBaixo,
  pendentes,
  notaMedia,
  metricas,
  metricPeriod,
  onMetricPeriodChange,
  pedidos,
  onOpenPedido,
}: {
  perfumeCount: number;
  estoqueBaixo: number;
  pendentes: number;
  notaMedia: string;
  metricas: Metricas | null;
  metricPeriod: MetricPeriod;
  onMetricPeriodChange: (period: MetricPeriod) => void | Promise<void>;
  pedidos: AdminPedido[];
  onOpenPedido: (pedido: AdminPedido) => void;
}) {
  return (
    <View style={styles.page}>
      <View style={styles.statGrid}>
        <View style={styles.statColumn}><StatCard label="Contratipos" value={perfumeCount} icon="droplet" /></View>
        <View style={styles.statColumn}><StatCard label="Estoque baixo" value={estoqueBaixo} icon="alert-triangle" /></View>
        <View style={styles.statColumn}><StatCard label="Aguardando pagamento" value={pendentes} icon="clipboard" /></View>
        <View style={styles.statColumn}><StatCard label="Nota média" value={notaMedia} icon="star" /></View>
      </View>
      {metricas && (
        <View style={styles.metricsPanel}>
          <View style={styles.metricsHeader}>
            <Text style={styles.sectionLabel}>VISÃO DO NEGÓCIO</Text>
            <View style={styles.metricPeriods}>
              {([['7d', '7 dias'], ['30d', '30 dias'], ['mes', 'Este mês'], ['todos', 'Tudo']] as const).map(([id, label]) => (
                <Pressable key={id} onPress={() => void onMetricPeriodChange(id)} style={[styles.miniChip, metricPeriod === id && styles.miniChipActive]}>
                  <Text style={[styles.miniChipText, metricPeriod === id && styles.miniChipTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.metricsRow}>
            <View style={styles.metricCell}>
              <Text style={styles.metricLabel}>Receita confirmada</Text>
              <Text style={styles.metricValue}>{brl(metricas.receitaConfirmada)}</Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={styles.metricLabel}>Lucro estimado</Text>
              <Text style={[styles.metricValue, { color: metricas.lucroEstimado >= 0 ? COLORS.sage : COLORS.rust }]}>{brl(metricas.lucroEstimado)}</Text>
            </View>
          </View>
          <View style={[styles.metricsRow, styles.metricSection]}>
            <View style={styles.metricCell}>
              <Text style={styles.metricLabel}>Ticket médio</Text>
              <Text style={styles.metricValue}>{brl(metricas.ticketMedio)}</Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={styles.metricLabel}>Margem estimada</Text>
              <Text style={styles.metricValue}>{metricas.margemEstimada.toFixed(1)}%</Text>
            </View>
          </View>
          <View style={[styles.metricsRow, styles.metricSection]}>
            <View style={styles.metricCell}>
              <Text style={styles.metricLabel}>A receber</Text>
              <Text style={styles.metricValue}>{brl(metricas.aReceber)}</Text>
              <Text style={styles.metricSubtle}>{metricas.pedidosPendentes} pendente(s)</Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={styles.metricLabel}>Volume vendido</Text>
              <Text style={styles.metricValue}>{metricas.mlVendidos.toLocaleString('pt-BR')} ml</Text>
              <Text style={styles.metricSubtle}>{metricas.pedidosPagos} pedido(s) pago(s)</Text>
            </View>
          </View>
          {(metricas.receitaEmRisco > 0 || metricas.valorEstornado > 0 || metricas.valorChargeback > 0) && (
            <View style={styles.financialAttentionCard}>
              <Feather name="alert-circle" size={17} color={COLORS.rust} />
              <View style={styles.flex}>
                <Text style={styles.financialAttentionTitle}>Atenção financeira</Text>
                <Text style={styles.financialAttentionText}>
                  Em análise {brl(metricas.receitaEmRisco)} · estornado {brl(metricas.valorEstornado)} · chargeback {brl(metricas.valorChargeback)}
                </Text>
              </View>
            </View>
          )}
          {!!metricas.serieDiaria?.length && (() => {
            const dias = metricas.serieDiaria.slice(-14);
            const maxReceita = Math.max(1, ...dias.map((dia) => dia.receita));
            return (
              <>
                <View style={styles.chartHeader}>
                  <Text style={styles.metricLabel}>RECEITA DIÁRIA</Text>
                  {!!metricas.tamanhoMaisVendido && (
                    <Text style={styles.metricSubtle}>Tamanho líder: {metricas.tamanhoMaisVendido.ml}ml · {metricas.tamanhoMaisVendido.quantidade} un.</Text>
                  )}
                </View>
                <View style={styles.metricChart}>
                  {dias.map((dia, index) => (
                    <View key={dia.data} style={styles.metricChartColumn}>
                      <View style={[styles.metricChartBar, { height: Math.max(3, Math.round((dia.receita / maxReceita) * 72)) }]} />
                      {(index === 0 || index === dias.length - 1) && <Text style={styles.metricChartLabel}>{dia.data.slice(5).replace('-', '/')}</Text>}
                    </View>
                  ))}
                </View>
              </>
            );
          })()}
          {metricas.maisVendidos.length > 0 && (
            <>
              <Text style={[styles.metricLabel, styles.rankingHeading]}>MAIS VENDIDOS · POR VOLUME</Text>
              {metricas.maisVendidos.slice(0, 5).map((item, index) => (
                <View key={`${item.perfumeId}-${index}`} style={styles.rankingRow}>
                  <Text style={styles.rankingNumber}>{index + 1}</Text>
                  <View style={styles.flex}>
                    <Text style={styles.rankingName} numberOfLines={1}>{item.nome}</Text>
                    <Text style={styles.metricSubtle}>{item.ml.toLocaleString('pt-BR')} ml · {brl(item.faturamento)}</Text>
                  </View>
                  <Text style={styles.rankingQty}>{item.quantidade} un.</Text>
                </View>
              ))}
            </>
          )}
          {!!metricas.maisLucrativos?.length && (
            <>
              <Text style={[styles.metricLabel, styles.rankingHeading]}>MAIOR LUCRO ESTIMADO</Text>
              {metricas.maisLucrativos.slice(0, 3).map((item, index) => (
                <View key={`lucro-${item.perfumeId}-${index}`} style={styles.rankingRow}>
                  <Text style={styles.rankingNumber}>{index + 1}</Text>
                  <View style={styles.flex}>
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
      {pedidos.length === 0 && <EmptyState text="Nenhum pedido recebido ainda." />}
      {[...pedidos].sort((a, b) => new Date(b.criadoEm).getTime() - new Date(a.criadoEm).getTime()).slice(0, 5).map((pedido) => {
        const status = STATUS.find((item) => item.id === pedido.status) || STATUS[0];
        return (
          <Pressable key={`${pedido.fonte}-${pedido.id}`} onPress={() => onOpenPedido(pedido)} style={styles.rowCard} testID={`dashboard-order-${pedido.id}`}>
            <View style={styles.rowBetween}>
              <View>
                <Text style={styles.goldCaption}>Nº {padSeq(pedido.seq)}</Text>
                <Text style={styles.orderCustomer}>{pedido.cliente}</Text>
              </View>
              <View style={[styles.pill, { borderColor: status.color }]}><Text style={[styles.caption, { color: status.color }]}>{status.label}</Text></View>
            </View>
            <View style={[styles.rowBetween, styles.orderMetaRow]}>
              <Text style={styles.orderMeta}>{(pedido.itens || []).length} item(ns) · {fmtDate(pedido.criadoEm)}</Text>
              <Text style={styles.orderTotal}>{brl(pedido.total)}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AdminCatalog({
  perfumes,
  search,
  onSearchChange,
  estoqueDe,
  onEdit,
  onArchive,
}: {
  perfumes: Perfume[];
  search: string;
  onSearchChange: (value: string) => void;
  estoqueDe: (id: string) => EstoqueDisponivel;
  onEdit: (perfume: Perfume) => void;
  onArchive: (perfume: Perfume) => void;
}) {
  const filtrados = perfumes.filter((perfume) => perfume.nome.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  return (
    <View style={styles.page}>
      <View style={styles.searchBox}>
        <Feather name="search" size={16} color={COLORS.muted} />
        <TextInput value={search} onChangeText={onSearchChange} placeholder="Buscar" placeholderTextColor={COLORS.muted + 'BB'} style={styles.searchInput} testID="catalogo-search" />
      </View>
      {filtrados.length === 0 && <EmptyState text="Nenhum contratipo. Toque em + para começar." />}
      {filtrados.map((perfume) => {
        const resumo = estoqueDe(perfume.id);
        const baixo = resumo.disponivelMl <= (perfume.estoqueMinimoMl || 0);
        return (
          <View key={perfume.id} style={styles.perfumeCard} testID={`perfume-card-${perfume.id}`}>
            {perfume.imagemUrl ? (
              <Image source={{ uri: perfume.imagemUrl }} style={styles.catalogThumb} contentFit="contain" transition={150} />
            ) : (
              <View style={styles.catalogThumbPlaceholder}><Feather name="image" size={20} color={COLORS.muted} /></View>
            )}
            <View style={styles.catalogBody}>
              <View style={styles.rowBetween}>
                <View style={styles.flex}>
                  <Text style={styles.goldCaption}>Nº {padSeq(perfume.seq)}</Text>
                  <Text style={styles.perfumeName}>{perfume.nome}</Text>
                  <Text style={styles.caption}>{(perfume.ocasioes || []).length ? (perfume.ocasioes || []).join(' · ') : 'Clima & ocasião não informados'}</Text>
                </View>
                <View style={styles.cardActions}>
                  <Pressable onPress={() => onEdit(perfume)} hitSlop={8} testID={`edit-${perfume.id}`} accessibilityLabel={`Editar ${perfume.nome}`}><Feather name="edit-2" size={16} color={COLORS.muted} /></Pressable>
                  <Pressable onPress={() => onArchive(perfume)} hitSlop={8} testID={`archive-${perfume.id}`} accessibilityLabel={`Arquivar ${perfume.nome}`}><Feather name="archive" size={16} color={COLORS.muted} /></Pressable>
                </View>
              </View>
              <View style={styles.tags}>
                <View style={styles.tag}><Text style={styles.goldCaption}>{familiasDoPerfume(perfume).join(' · ')}</Text></View>
                <View style={styles.tag}><Text style={styles.caption}>{nomeConcentracao(perfume.concentracao)}</Text></View>
                <View style={styles.tag}>
                  <View style={styles.availabilityTag}>
                    <View style={[styles.availabilityDot, { backgroundColor: perfume.prontaEntrega ? COLORS.sage : COLORS.gold }]} />
                    <Text style={[styles.caption, { color: perfume.prontaEntrega ? COLORS.sage : COLORS.gold }]}>{perfume.prontaEntrega ? 'Pronta entrega' : 'Sob encomenda'}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.prices}>
                {perfume.precos.map((preco) => <Text key={preco.ml} style={styles.price}>{preco.ml}ml · {brl(preco.preco)}</Text>)}
              </View>
              <View style={styles.stockLine}>
                {baixo && <Feather name="alert-triangle" size={11} color={COLORS.rust} />}
                <Text style={[styles.stockText, { color: baixo ? COLORS.rust : COLORS.sage }]}>
                  {resumo.disponivelMl}ml disponíveis{resumo.reservadoMl > 0 ? ` · ${resumo.reservadoMl}ml reservados` : ''}{baixo ? ' · baixo' : ''}
                </Text>
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACING.lg },
  flex: { flex: 1 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: SPACING.lg },
  statColumn: { width: '48%' },
  statCard: { padding: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg },
  statValue: { color: COLORS.bone, fontSize: FONT_SIZES.display, fontWeight: '500', marginTop: 6 },
  statLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  metricsPanel: { padding: SPACING.md, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.lg },
  metricsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm, flexWrap: 'wrap' },
  metricPeriods: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  metricsRow: { flexDirection: 'row', gap: 12 },
  metricSection: { marginTop: SPACING.md },
  metricCell: { flex: 1 },
  metricLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, letterSpacing: 0.6 },
  metricValue: { color: COLORS.bone, fontSize: FONT_SIZES.heading, fontWeight: '600', marginTop: 3 },
  metricSubtle: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  miniChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, flexShrink: 0 },
  miniChipActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  miniChipText: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  miniChipTextActive: { color: COLORS.ink },
  financialAttentionCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.rust, backgroundColor: COLORS.surfaceRaised },
  financialAttentionTitle: { color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '700' },
  financialAttentionText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: SPACING.lg },
  metricChart: { height: 96, flexDirection: 'row', alignItems: 'flex-end', gap: 3, marginTop: SPACING.sm, paddingTop: SPACING.xs, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  metricChartColumn: { flex: 1, minWidth: 4, height: 92, justifyContent: 'flex-end', alignItems: 'center' },
  metricChartBar: { width: '72%', minWidth: 3, maxWidth: 18, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: COLORS.gold },
  metricChartLabel: { color: COLORS.muted, fontSize: FONT_SIZES.micro, marginTop: 3, position: 'absolute', bottom: -13, width: 42, textAlign: 'center' },
  rankingHeading: { marginTop: SPACING.lg },
  rankingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  rankingNumber: { color: COLORS.gold, width: 22, fontSize: FONT_SIZES.label, fontWeight: '700' },
  rankingName: { color: COLORS.bone, flex: 1, fontSize: FONT_SIZES.label },
  rankingQty: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  sectionLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginBottom: SPACING.sm, letterSpacing: 1 },
  rowCard: { padding: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  goldCaption: { color: COLORS.gold, fontSize: FONT_SIZES.caption },
  caption: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  orderCustomer: { color: COLORS.bone, fontSize: FONT_SIZES.bodyLarge, fontWeight: '500' },
  orderMetaRow: { marginTop: 6 },
  orderMeta: { color: COLORS.muted, fontSize: FONT_SIZES.label },
  orderTotal: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill, borderWidth: 1, backgroundColor: COLORS.surface },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, marginBottom: SPACING.sm },
  searchInput: { flex: 1, color: COLORS.bone, paddingVertical: 10, fontSize: FONT_SIZES.body },
  perfumeCard: { flexDirection: 'row', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.sm, overflow: 'hidden' },
  catalogThumb: { width: 84, minHeight: 126, backgroundColor: COLORS.surface },
  catalogThumbPlaceholder: { width: 84, minHeight: 126, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  catalogBody: { flex: 1, padding: SPACING.md },
  perfumeName: { color: COLORS.bone, fontSize: FONT_SIZES.bodyLarge, fontWeight: '500' },
  cardActions: { flexDirection: 'row', gap: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  availabilityTag: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  availabilityDot: { width: 6, height: 6, borderRadius: 3 },
  prices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  price: { color: COLORS.bone, fontSize: FONT_SIZES.caption },
  stockLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  stockText: { fontSize: FONT_SIZES.caption },
});
