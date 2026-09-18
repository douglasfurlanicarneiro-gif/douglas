import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import {
  ApiError,
  archiveCoupon,
  createCoupon,
  listCoupons,
  updateCoupon,
} from '../api';
import type { Cupom } from '../types';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../theme';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import { Field, TInput } from './atoms';
import { AppText as Text } from './Typography';
import { SystemCard } from './AdminSystemComponents';

type Draft = {
  codigo: string;
  percentual: string;
  descricao: string;
  ativo: boolean;
};

const EMPTY_DRAFT: Draft = {
  codigo: '',
  percentual: '10',
  descricao: '',
  ativo: true,
};

export function AdminCoupons() {
  const [coupons, setCoupons] = useState<Cupom[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCoupons(await listCoupons());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Não foi possível carregar os cupons.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const reset = () => {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setError('');
  };

  const edit = (coupon: Cupom) => {
    setDraft({
      codigo: coupon.codigo,
      percentual: String(coupon.percentual),
      descricao: coupon.descricao || '',
      ativo: coupon.ativo,
    });
    setEditingId(coupon.id);
    setError('');
  };

  const save = async () => {
    const percentual = Number(draft.percentual.replace(',', '.'));
    if (!draft.codigo.trim() || !Number.isInteger(percentual) || percentual < 1 || percentual > 90) {
      setError('Informe um código e um percentual inteiro entre 1% e 90%.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        codigo: draft.codigo.trim().toUpperCase(),
        percentual,
        descricao: draft.descricao.trim(),
        ativo: draft.ativo,
      };
      if (editingId) await updateCoupon(editingId, payload);
      else await createCoupon(payload);
      reset();
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Não foi possível salvar o cupom.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (coupon: Cupom) => {
    setError('');
    try {
      await updateCoupon(coupon.id, {
        codigo: coupon.codigo,
        percentual: coupon.percentual,
        descricao: coupon.descricao || '',
        ativo: !coupon.ativo,
      });
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Não foi possível alterar o cupom.');
    }
  };

  const archive = (coupon: Cupom) => {
    Alert.alert(
      `Arquivar ${coupon.codigo}?`,
      'O código deixará de funcionar imediatamente. Pedidos antigos manterão o desconto registrado.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Arquivar',
          style: 'destructive',
          onPress: () => {
            void archiveCoupon(coupon.id)
              .then(load)
              .catch((cause) => setError(
                cause instanceof ApiError ? cause.message : 'Não foi possível arquivar o cupom.',
              ));
          },
        },
      ],
    );
  };

  return (
    <SystemCard
      icon="percent"
      title="Cupons de desconto"
      subtitle="Descontos percentuais aplicados somente aos perfumes; o frete permanece integral."
    >
      <View style={styles.formGrid}>
        <View style={styles.codeField}>
          <Field label="Código do cupom">
            <TInput
              value={draft.codigo}
              onChangeText={(codigo) => setDraft((current) => ({
                ...current,
                codigo: codigo.toUpperCase().replace(/\s/g, ''),
              }))}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="EX.: BEMVINDO10"
              maxLength={24}
              testID="coupon-code-input"
            />
          </Field>
        </View>
        <View style={styles.percentField}>
          <Field label="Desconto (%)">
            <TInput
              value={draft.percentual}
              onChangeText={(percentual) => setDraft((current) => ({ ...current, percentual }))}
              keyboardType="number-pad"
              placeholder="10"
              maxLength={2}
              testID="coupon-percent-input"
            />
          </Field>
        </View>
      </View>
      <Field label="Descrição interna (opcional)">
        <TInput
          value={draft.descricao}
          onChangeText={(descricao) => setDraft((current) => ({ ...current, descricao }))}
          placeholder="Ex.: campanha de boas-vindas"
          maxLength={160}
        />
      </Field>
      <Pressable
        onPress={() => setDraft((current) => ({ ...current, ativo: !current.ativo }))}
        accessibilityRole="switch"
        accessibilityState={{ checked: draft.ativo }}
        style={styles.activeToggle}
      >
        <Feather name={draft.ativo ? 'check-square' : 'square'} size={18} color={COLORS.gold} />
        <Text style={styles.activeToggleText}>Disponível para uso na vitrine</Text>
      </Pressable>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        {editingId && (
          <Pressable onPress={reset} style={[styles.button, styles.secondaryButton]}>
            <Text style={styles.secondaryButtonText}>Cancelar edição</Text>
          </Pressable>
        )}
        <Pressable
          onPress={() => void save()}
          disabled={saving}
          style={[styles.button, styles.primaryButton, saving && styles.disabled]}
          testID="coupon-save"
        >
          <Feather name="save" size={15} color={COLORS.ink} />
          <Text style={styles.primaryButtonText}>
            {saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Criar cupom'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.listHeader}>
        <Text style={styles.listTitle}>Cupons cadastrados</Text>
        <Pressable onPress={() => void load()} accessibilityLabel="Atualizar cupons" hitSlop={8}>
          <Feather name="refresh-cw" size={16} color={COLORS.gold} />
        </Pressable>
      </View>
      {loading ? (
        <ActivityIndicator color={COLORS.gold} style={{ marginVertical: SPACING.md }} />
      ) : coupons.length === 0 ? (
        <Text style={styles.empty}>Nenhum cupom cadastrado.</Text>
      ) : coupons.map((coupon) => (
        <View key={coupon.id} style={styles.couponRow} testID={`coupon-row-${coupon.codigo}`}>
          <View style={styles.couponCopy}>
            <View style={styles.couponTitleRow}>
              <Text style={styles.couponCode}>{coupon.codigo}</Text>
              <View style={[styles.status, coupon.ativo ? styles.activeStatus : styles.pausedStatus]}>
                <Text style={styles.statusText}>{coupon.ativo ? 'ATIVO' : 'PAUSADO'}</Text>
              </View>
            </View>
            <Text style={styles.couponPercent}>{coupon.percentual}% nos perfumes</Text>
            {!!coupon.descricao && <Text style={styles.couponDescription}>{coupon.descricao}</Text>}
          </View>
          <View style={styles.rowActions}>
            <Pressable onPress={() => void toggle(coupon)} style={styles.iconButton} accessibilityLabel={coupon.ativo ? 'Pausar cupom' : 'Ativar cupom'}>
              <Feather name={coupon.ativo ? 'pause' : 'play'} size={15} color={COLORS.gold} />
            </Pressable>
            <Pressable onPress={() => edit(coupon)} style={styles.iconButton} accessibilityLabel="Editar cupom">
              <Feather name="edit-2" size={15} color={COLORS.gold} />
            </Pressable>
            <Pressable onPress={() => archive(coupon)} style={styles.iconButton} accessibilityLabel="Arquivar cupom">
              <Feather name="archive" size={15} color={COLORS.rust} />
            </Pressable>
          </View>
        </View>
      ))}
    </SystemCard>
  );
}

const styles = StyleSheet.create({
  formGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  codeField: { flex: 2, minWidth: 210 },
  percentField: { flex: 1, minWidth: 120 },
  activeToggle: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  activeToggleText: { ...TYPOGRAPHY.label, color: COLORS.bone },
  error: { ...TYPOGRAPHY.caption, color: COLORS.rust, marginBottom: SPACING.md },
  actions: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
  button: {
    minHeight: 44, borderRadius: RADIUS.md, paddingHorizontal: SPACING.lg,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: SPACING.sm,
  },
  primaryButton: { backgroundColor: COLORS.gold, flex: 1 },
  secondaryButton: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  primaryButtonText: { ...TYPOGRAPHY.label, color: COLORS.ink },
  secondaryButtonText: { ...TYPOGRAPHY.label, color: COLORS.muted },
  disabled: { opacity: 0.55 },
  listHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.border,
    marginBottom: SPACING.sm,
  },
  listTitle: { ...TYPOGRAPHY.label, color: COLORS.bone },
  empty: { ...TYPOGRAPHY.bodySmall, color: COLORS.muted, paddingVertical: SPACING.md },
  couponRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    padding: SPACING.md, marginTop: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
  },
  couponCopy: { flex: 1, minWidth: 0 },
  couponTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flexWrap: 'wrap' },
  couponCode: { ...TYPOGRAPHY.subtitle, color: COLORS.bone },
  couponPercent: { ...TYPOGRAPHY.label, color: COLORS.gold, marginTop: 3 },
  couponDescription: { ...TYPOGRAPHY.caption, color: COLORS.muted, marginTop: 2 },
  status: { borderRadius: RADIUS.pill, paddingHorizontal: 7, paddingVertical: 2 },
  activeStatus: { backgroundColor: COLORS.sage + '44' },
  pausedStatus: { backgroundColor: COLORS.border + '88' },
  statusText: { ...TYPOGRAPHY.caption, color: COLORS.bone, fontWeight: '700' },
  rowActions: { flexDirection: 'row', gap: 5 },
  iconButton: {
    width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.sm,
  },
});
