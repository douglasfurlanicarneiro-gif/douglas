import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, TextInputProps } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../theme';

export const inputStyle = {
  width: '100%',
  backgroundColor: COLORS.ink,
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: COLORS.bone,
  fontSize: 14,
} as const;

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: SPACING.md }}>
      <Text style={{ color: COLORS.muted, fontSize: 12, marginBottom: 4 }}>{label}</Text>
      {children}
    </View>
  );
}

export function TInput(props: TextInputProps) {
  return <TextInput {...props} placeholderTextColor={COLORS.muted + 'BB'} style={[inputStyle as any, props.style]} />;
}

export function PrimaryButton({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [
        { backgroundColor: disabled ? COLORS.border : COLORS.gold, opacity: pressed ? 0.85 : 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flex: 1 },
      ]}
    >
      <Text style={{ color: COLORS.ink, fontWeight: '600', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, opacity: pressed ? 0.85 : 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flex: 1 },
      ]}
    >
      <Text style={{ color: COLORS.muted, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View style={{ padding: SPACING.xl, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed', backgroundColor: COLORS.surface, marginBottom: SPACING.md }}>
      <Text style={{ color: COLORS.muted, fontSize: 14, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

export function Stars({ value, onChange, size = 16 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => onChange?.(n)} disabled={!onChange} hitSlop={4} testID={`star-${n}`}>
          <Feather name="star" size={size} color={n <= value ? COLORS.gold : COLORS.muted} style={{ opacity: n <= value ? 1 : 0.6 }} />
        </Pressable>
      ))}
    </View>
  );
}

export function Chip({ label, active, onPress, testID }: { label: string; active?: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={{
        height: 36,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? COLORS.gold : COLORS.border,
        backgroundColor: active ? COLORS.gold : COLORS.surface,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Text style={{ color: active ? COLORS.ink : COLORS.muted, fontSize: 12, fontWeight: active ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}
