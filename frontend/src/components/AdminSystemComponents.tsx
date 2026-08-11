import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { ApiError, reauthenticateCriticalAction } from '../api';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '../theme';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import { AppText as Text } from './Typography';
import { SecondaryButton, TInput } from './atoms';

type FeatherIconName = React.ComponentProps<typeof Feather>['name'];

export type ConfirmSheet = {
  type: 'confirm';
  title?: string;
  label: string;
  onConfirm: () => void | Promise<void>;
  confirmLabel?: string;
  danger?: boolean;
  safetyText?: string;
  requiresReauth?: boolean;
};

export function SystemCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: FeatherIconName;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.systemCard}>
      <View style={styles.systemCardHeader}>
        <View style={styles.systemCardIcon}>
          <Feather name={icon} size={17} color={COLORS.gold} />
        </View>
        <View style={styles.flexOne}>
          <Text style={styles.systemCardTitle}>{title}</Text>
          <Text style={styles.systemCardSubtitle}>{subtitle}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

export function SystemAction({
  icon,
  title,
  subtitle,
  onPress,
  danger,
  disabled,
  badge,
}: {
  icon: FeatherIconName;
  title: string;
  subtitle: string;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.systemAction,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Feather name={icon} size={15} color={danger ? COLORS.rust : COLORS.gold} />
      <View style={styles.flexOne}>
        <Text style={[styles.systemActionTitle, danger && styles.danger]}>{title}</Text>
        <Text style={styles.systemActionSubtitle}>{subtitle}</Text>
      </View>
      {!!badge && <Text style={styles.systemBadge}>{badge}</Text>}
      {!disabled && <Feather name="chevron-right" size={15} color={COLORS.muted} />}
    </Pressable>
  );
}

export function ConfirmSheetContent({
  sheet,
  onCancel,
}: {
  sheet: ConfirmSheet;
  onCancel: () => void;
}) {
  const [ready, setReady] = useState(!sheet.danger);
  const [password, setPassword] = useState('');
  const [securityError, setSecurityError] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!sheet.danger) {
      setReady(true);
      return;
    }
    setReady(false);
    const timer = setTimeout(() => setReady(true), 700);
    return () => clearTimeout(timer);
  }, [sheet]);

  const confirm = async () => {
    if (!ready || confirming || (sheet.requiresReauth && !password)) return;
    setConfirming(true);
    setSecurityError('');
    try {
      if (sheet.requiresReauth) await reauthenticateCriticalAction(password);
      await sheet.onConfirm();
    } catch (error) {
      setSecurityError(
        error instanceof ApiError
          ? error.message
          : 'Não foi possível confirmar sua identidade.',
      );
    } finally {
      setConfirming(false);
    }
  };

  const blocked = !ready || confirming || Boolean(sheet.requiresReauth && !password);

  return (
    <View>
      <Text style={styles.confirmLabel}>{sheet.label}</Text>
      {sheet.danger && (
        <View style={styles.deleteSafetyNotice}>
          <Feather name="shield" size={15} color={COLORS.gold} />
          <Text style={styles.deleteSafetyText}>
            {sheet.safetyText || 'Esta ação é permanente. Confirme somente se deseja realmente excluir.'}
          </Text>
        </View>
      )}
      {sheet.requiresReauth && (
        <View style={styles.stepUpCard}>
          <View style={styles.stepUpHeading}>
            <Feather name="lock" size={16} color={COLORS.gold} />
            <Text style={styles.stepUpTitle}>Confirmação de identidade</Text>
          </View>
          <Text style={styles.stepUpHint}>Digite novamente a senha do painel. Ela não será salva.</Text>
          <TInput
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setSecurityError('');
            }}
            placeholder="Senha administrativa"
            secureTextEntry
            autoCapitalize="none"
            testID="critical-password"
          />
          {!!securityError && <Text style={styles.stepUpError}>{securityError}</Text>}
        </View>
      )}
      <View style={styles.confirmActions}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <Pressable
          onPress={confirm}
          disabled={blocked}
          testID="confirm-ok"
          style={[
            styles.confirmAction,
            { backgroundColor: sheet.danger ? COLORS.rust : COLORS.gold },
            blocked && styles.confirmActionDisabled,
          ]}
        >
          <Text style={[styles.confirmActionText, { color: sheet.danger ? COLORS.inverse : COLORS.ink }]}>
            {!ready
              ? 'Aguarde…'
              : confirming
                ? 'Confirmando…'
                : (sheet.confirmLabel || (sheet.danger ? 'Sim, excluir' : 'Confirmar'))}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  danger: { color: COLORS.rust },
  systemCard: {
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceRaised,
  },
  systemCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: SPACING.md,
  },
  systemCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  systemCardTitle: { color: COLORS.bone, fontSize: FONT_SIZES.subtitle, fontWeight: '700' },
  systemCardSubtitle: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 14, marginTop: 2 },
  systemAction: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  systemActionTitle: { color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '600' },
  systemActionSubtitle: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 13, marginTop: 2 },
  systemBadge: {
    color: COLORS.muted,
    fontSize: FONT_SIZES.caption,
    letterSpacing: 0.5,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  confirmLabel: { color: COLORS.bone, marginBottom: SPACING.lg },
  deleteSafetyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  deleteSafetyText: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 16, flex: 1 },
  stepUpCard: {
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.gold,
    backgroundColor: COLORS.surfaceRaised,
  },
  stepUpHeading: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 5 },
  stepUpTitle: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '700' },
  stepUpHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginBottom: SPACING.sm },
  stepUpError: { color: COLORS.rust, fontSize: FONT_SIZES.caption, marginTop: 6 },
  confirmActions: { flexDirection: 'row', gap: 8 },
  confirmAction: { flex: 1, paddingVertical: 14, borderRadius: RADIUS.md, alignItems: 'center' },
  confirmActionDisabled: { opacity: 0.45 },
  confirmActionText: { fontWeight: '600' },
});
