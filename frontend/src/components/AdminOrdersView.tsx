import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { COLORS, FONT_SIZES, RADIUS, SPACING, STATUS, brl, fmtDate, padSeq } from '../theme';
import type { OrderStatus, Perfume } from '../types';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import {
  ADMIN_KANBAN_FLOW,
  KanbanPedidoCard,
  SwipeablePedidoCard,
  type AdminPedido,
} from './AdminOrderCards';
import { AppText as Text, AppTextInput as TextInput } from './Typography';
import { EmptyState } from './atoms';

export type AdminOrdersLayout = 'kanban' | 'lista';

export function AdminOrdersView({
  pedidos,
  perfumes,
  search,
  onSearchChange,
  layout,
  onLayoutChange,
  columnWidth,
  movingOrderId,
  onOpen,
  onMove,
  onArchive,
}: {
  pedidos: AdminPedido[];
  perfumes: Perfume[];
  search: string;
  onSearchChange: (value: string) => void;
  layout: AdminOrdersLayout;
  onLayoutChange: (layout: AdminOrdersLayout) => void;
  columnWidth: number;
  movingOrderId: string | null;
  onOpen: (pedido: AdminPedido) => void;
  onMove: (pedido: AdminPedido, status: OrderStatus) => void | Promise<void>;
  onArchive: (pedido: AdminPedido) => void;
}) {
  const filtrados = useMemo(() => {
    const termo = search.trim().toLocaleLowerCase('pt-BR');
    const ordenados = [...pedidos].sort((first, second) => new Date(second.criadoEm).getTime() - new Date(first.criadoEm).getTime());
    if (!termo) return ordenados;
    return ordenados.filter((pedido) => {
      const nomesItens = (pedido.itens || [])
        .map((item) => perfumes.find((perfume) => perfume.id === item.perfumeId)?.nome || item.perfumeNome || '')
        .join(' ');
      return [pedido.cliente, pedido.contato, pedido.observacoes, String(pedido.seq), nomesItens]
        .some((value) => value.toLocaleLowerCase('pt-BR').includes(termo));
    });
  }, [pedidos, perfumes, search]);

  return (
    <View style={styles.page}>
      <View style={styles.orderToolbar}>
        <View style={styles.orderViewToggle}>
          {([
            { id: 'kanban', label: 'Etapas', icon: 'columns' },
            { id: 'lista', label: 'Lista', icon: 'list' },
          ] as const).map((view) => {
            const active = layout === view.id;
            return (
              <Pressable
                key={view.id}
                onPress={() => onLayoutChange(view.id)}
                style={[styles.orderViewButton, active && styles.orderViewButtonActive]}
                accessibilityRole="button"
                testID={`orders-view-${view.id}`}
              >
                <Feather name={view.icon} size={13} color={active ? COLORS.ink : COLORS.muted} />
                <Text style={[styles.orderViewText, active && styles.orderViewTextActive]}>{view.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.orderSearchBox}>
          <Feather name="search" size={14} color={COLORS.muted} />
          <TextInput
            value={search}
            onChangeText={onSearchChange}
            placeholder="Buscar pedido, cliente ou contato"
            placeholderTextColor={COLORS.muted}
            style={styles.orderSearchInput}
            testID="orders-search"
          />
          {!!search && (
            <Pressable onPress={() => onSearchChange('')} hitSlop={8} accessibilityLabel="Limpar busca de pedidos" testID="orders-search-clear">
              <Feather name="x" size={14} color={COLORS.muted} />
            </Pressable>
          )}
        </View>
      </View>

      {filtrados.length === 0 && <EmptyState text={search ? 'Nenhum pedido encontrado para esta busca.' : 'Nenhum pedido recebido ainda.'} />}

      {filtrados.length > 0 && layout === 'kanban' && (
        <>
          <View style={styles.kanbanHint}>
            <Feather name="move" size={14} color={COLORS.gold} />
            <Text style={styles.kanbanHintText}>Arraste o cartão para os lados ou use as setas para mudar a etapa.</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={styles.kanbanBoard}>
            {ADMIN_KANBAN_FLOW.map((statusId) => {
              const status = STATUS.find((item) => item.id === statusId) || STATUS[0];
              const pedidosDaEtapa = filtrados.filter((pedido) => pedido.status === statusId);
              return (
                <View key={statusId} style={[styles.kanbanColumn, { width: columnWidth }]}>
                  <View style={styles.kanbanColumnHeader}>
                    <View style={styles.kanbanColumnTitleRow}>
                      <View style={[styles.kanbanStatusDot, { backgroundColor: status.color }]} />
                      <Text style={styles.kanbanColumnTitle}>{status.label}</Text>
                    </View>
                    <View style={styles.kanbanCount}><Text style={styles.kanbanCountText}>{pedidosDaEtapa.length}</Text></View>
                  </View>
                  {pedidosDaEtapa.length === 0 ? (
                    <View style={styles.kanbanEmpty}><Text style={styles.kanbanEmptyText}>Nenhum pedido nesta etapa</Text></View>
                  ) : pedidosDaEtapa.map((pedido) => (
                    <KanbanPedidoCard
                      key={`${pedido.fonte}-${pedido.id}`}
                      pedido={pedido}
                      onOpen={() => onOpen(pedido)}
                      onMove={(status) => onMove(pedido, status)}
                      moving={movingOrderId === pedido.id}
                    />
                  ))}
                </View>
              );
            })}
          </ScrollView>
          {filtrados.some((pedido) => pedido.status === 'cancelado') && (
            <View style={styles.cancelledOrders}>
              <Text style={styles.sectionLabel}>CANCELADOS</Text>
              {filtrados.filter((pedido) => pedido.status === 'cancelado').map((pedido) => (
                <Pressable key={`${pedido.fonte}-${pedido.id}`} onPress={() => onOpen(pedido)} style={styles.cancelledOrderCard}>
                  <View style={styles.flex}>
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

      {filtrados.length > 0 && layout === 'lista' && (
        <>
          <View style={styles.swipeOrderHint}>
            <Feather name="chevrons-left" size={15} color={COLORS.gold} />
            <Text style={styles.swipeOrderHintText}>Deslize um pedido para a esquerda para editar; pedidos concluídos ou cancelados também podem ser arquivados.</Text>
          </View>
          {filtrados.map((pedido) => {
            const status = STATUS.find((item) => item.id === pedido.status) || STATUS[0];
            const podeArquivar = (['cancelado', 'entregue'] as OrderStatus[]).includes(pedido.status);
            return (
              <SwipeablePedidoCard
                key={`${pedido.fonte}-${pedido.id}`}
                onEdit={() => onOpen(pedido)}
                onDelete={podeArquivar ? () => onArchive(pedido) : undefined}
                testID={`pedido-${pedido.id}`}
              >
                <View style={styles.rowBetween}>
                  <View>
                    <Text style={styles.kanbanOrderNumber}>Nº {padSeq(pedido.seq)}</Text>
                    <Text style={styles.orderCustomer}>{pedido.cliente}</Text>
                  </View>
                  <View style={[styles.pill, { borderColor: status.color }]}><Text style={[styles.caption, { color: status.color }]}>{status.label}</Text></View>
                </View>
                <View style={[styles.rowBetween, styles.orderMetaRow]}>
                  <Text style={styles.orderMeta}>{(pedido.itens || []).length} item(ns) · {fmtDate(pedido.criadoEm)}</Text>
                  <Text style={styles.orderTotal}>{brl(pedido.total)}</Text>
                </View>
              </SwipeablePedidoCard>
            );
          })}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACING.lg },
  flex: { flex: 1 },
  sectionLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginBottom: SPACING.sm, letterSpacing: 1 },
  orderToolbar: { marginBottom: SPACING.md, gap: SPACING.sm },
  orderViewToggle: { flexDirection: 'row', alignSelf: 'flex-start', padding: 3, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  orderViewButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 34, paddingHorizontal: 13, borderRadius: RADIUS.pill },
  orderViewButtonActive: { backgroundColor: COLORS.gold },
  orderViewText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  orderViewTextActive: { color: COLORS.ink },
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
  swipeOrderHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SPACING.sm, paddingHorizontal: 2 },
  swipeOrderHintText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, flex: 1 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between' },
  orderCustomer: { color: COLORS.bone, fontSize: FONT_SIZES.bodyLarge, fontWeight: '500' },
  orderMetaRow: { marginTop: 6 },
  orderMeta: { color: COLORS.muted, fontSize: FONT_SIZES.label },
  orderTotal: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill, borderWidth: 1, backgroundColor: COLORS.surface },
  caption: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
});
