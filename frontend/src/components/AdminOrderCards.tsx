import React, { useCallback, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import type { Compra, OrderStatus, Pedido } from '../types';
import { brl, COLORS, FONT_SIZES, fmtDate, padSeq, RADIUS, SPACING } from '../theme';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import { AppText as Text } from './Typography';

export type AdminPedido = Pedido & {
  fonte: 'pedidos' | 'compras-legadas';
  compraLegada?: Compra;
};

export const ADMIN_KANBAN_FLOW: OrderStatus[] = [
  'pendente',
  'pagamento_confirmado',
  'preparando',
  'pronto',
  'enviado',
  'entregue',
];

const ORDER_ACTIONS_WIDTH = 156;

export function SwipeablePedidoCard({
  children,
  onEdit,
  onDelete,
  testID,
}: {
  children: React.ReactNode;
  onEdit: () => void;
  onDelete?: () => void;
  testID: string;
}) {
  const actionsWidth = onDelete ? ORDER_ACTIONS_WIDTH : ORDER_ACTIONS_WIDTH / 2;
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const dragStartRef = useRef(0);

  const animateTo = useCallback((open: boolean) => {
    openRef.current = open;
    Animated.spring(translateX, {
      toValue: open ? -actionsWidth : 0,
      useNativeDriver: false,
      damping: 22,
      stiffness: 240,
      mass: 0.8,
    }).start();
  }, [actionsWidth, translateX]);

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      Math.abs(gesture.dx) > 8
      && Math.abs(gesture.dx) > Math.abs(gesture.dy)
    ),
    onPanResponderGrant: () => {
      dragStartRef.current = openRef.current ? -actionsWidth : 0;
    },
    onPanResponderMove: (_, gesture) => {
      const nextPosition = Math.max(
        -actionsWidth,
        Math.min(0, dragStartRef.current + gesture.dx),
      );
      translateX.setValue(nextPosition);
    },
    onPanResponderRelease: (_, gesture) => {
      const finalPosition = dragStartRef.current + gesture.dx;
      animateTo(finalPosition < -(actionsWidth / 2) || gesture.vx < -0.35);
    },
    onPanResponderTerminate: () => animateTo(openRef.current),
  }), [actionsWidth, animateTo, translateX]);

  const edit = () => {
    animateTo(false);
    onEdit();
  };

  const remove = () => {
    animateTo(false);
    onDelete?.();
  };

  return (
    <View style={styles.swipeOrderWrap} testID={testID}>
      <View style={[styles.swipeOrderActions, { width: actionsWidth }]}>
        <Pressable
          onPress={edit}
          style={({ pressed }) => [
            styles.swipeOrderAction,
            styles.swipeOrderEdit,
            pressed && styles.swipeOrderActionPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Editar pedido"
          testID={`${testID}-editar`}
        >
          <Feather name="edit-2" size={18} color={COLORS.ink} />
          <Text style={styles.swipeOrderEditText}>Editar</Text>
        </Pressable>
        {onDelete && (
          <Pressable
            onPress={remove}
            style={({ pressed }) => [
              styles.swipeOrderAction,
              styles.swipeOrderDelete,
              pressed && styles.swipeOrderActionPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Arquivar pedido"
            testID={`${testID}-arquivar`}
          >
            <Feather name="archive" size={18} color={COLORS.inverse} />
            <Text style={styles.swipeOrderDeleteText}>Arquivar</Text>
          </Pressable>
        )}
      </View>
      <Animated.View
        style={[styles.swipeOrderFront, { transform: [{ translateX }] }]}
        {...panResponder.panHandlers}
      >
        <Pressable
          onPress={() => openRef.current ? animateTo(false) : onEdit()}
          style={({ pressed }) => [styles.swipeOrderCard, pressed && styles.cardPressed]}
          accessibilityRole="button"
          accessibilityHint={onDelete
            ? 'Deslize para a esquerda para editar ou arquivar'
            : 'Deslize para a esquerda para editar'}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function KanbanPedidoCard({
  pedido,
  onOpen,
  onMove,
  moving,
}: {
  pedido: AdminPedido;
  onOpen: () => void;
  onMove: (status: OrderStatus) => void;
  moving: boolean;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const statusIndex = ADMIN_KANBAN_FLOW.indexOf(pedido.status);
  const podeVoltar = pedido.fonte === 'pedidos' && statusIndex > 0;
  const podeAvancar = (
    pedido.fonte === 'pedidos'
    && statusIndex >= 0
    && statusIndex < ADMIN_KANBAN_FLOW.length - 1
  );

  const mover = useCallback((direcao: -1 | 1) => {
    const novoStatus = ADMIN_KANBAN_FLOW[statusIndex + direcao];
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

  const unidades = (pedido.itens || []).reduce(
    (total, item) => total + (item.quantidade || 1),
    0,
  );

  return (
    <Animated.View
      style={[
        styles.kanbanCard,
        moving && styles.moving,
        { transform: [{ translateX }] },
      ]}
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
          testID={`kanban-pedido-${pedido.id}-voltar`}
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
          testID={`kanban-pedido-${pedido.id}-avancar`}
        >
          <Feather name="arrow-right" size={13} color={podeAvancar ? COLORS.gold : COLORS.border} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cardPressed: { opacity: 0.94 },
  moving: { opacity: 0.55 },
  swipeOrderWrap: {
    position: 'relative',
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceRaised,
  },
  swipeOrderActions: { position: 'absolute', top: 0, right: 0, bottom: 0, flexDirection: 'row' },
  swipeOrderAction: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 5 },
  swipeOrderEdit: { backgroundColor: COLORS.gold },
  swipeOrderDelete: { backgroundColor: COLORS.rust },
  swipeOrderActionPressed: { opacity: 0.82 },
  swipeOrderEditText: { color: COLORS.ink, fontSize: FONT_SIZES.caption, fontWeight: '700' },
  swipeOrderDeleteText: { color: COLORS.inverse, fontSize: FONT_SIZES.caption, fontWeight: '700' },
  swipeOrderFront: { backgroundColor: COLORS.surface },
  swipeOrderCard: {
    padding: SPACING.md,
    minHeight: 88,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.lg,
    justifyContent: 'center',
  },
  kanbanCard: {
    marginBottom: 8,
    padding: 12,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  kanbanCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kanbanOrderNumber: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 0.6, fontWeight: '700' },
  kanbanOrderDate: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  kanbanCustomer: { color: COLORS.bone, fontSize: FONT_SIZES.body, fontWeight: '600', marginTop: 5 },
  kanbanOrderMeta: { color: COLORS.bone, fontSize: FONT_SIZES.caption, marginTop: 4 },
  kanbanContact: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 3 },
  kanbanCardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 10,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  kanbanMoveButton: {
    width: 34,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  kanbanMoveDisabled: { opacity: 0.45 },
  kanbanEditButton: {
    flex: 1,
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.gold + '66',
    backgroundColor: COLORS.surface,
  },
  kanbanEditText: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600' },
});
