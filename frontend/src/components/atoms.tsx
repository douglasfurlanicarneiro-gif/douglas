import React from 'react';
import { View, Pressable, TextInputProps, TextStyle } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../theme';
import { AppText as Text, AppTextInput as TextInput } from './Typography';

export const inputStyle: TextStyle = {
  ...TYPOGRAPHY.body,
  width: '100%',
  backgroundColor: COLORS.surface,
  borderWidth: 1,
  borderColor: COLORS.border,
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: COLORS.bone,
};

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: SPACING.md }}>
      <Text style={{ ...TYPOGRAPHY.label, color: COLORS.muted, marginBottom: 4 }}>{label}</Text>
      {children}
    </View>
  );
}

export function TInput(props: TextInputProps) {
  return <TextInput {...props} placeholderTextColor={COLORS.muted + 'BB'} style={[inputStyle, props.style]} />;
}

export function PrimaryButton({ label, onPress, disabled, testID }: { label: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        { backgroundColor: disabled ? COLORS.border : COLORS.gold, opacity: pressed ? 0.85 : 1, borderRadius: 12, minHeight: 48, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', flex: 1 },
      ]}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.78}
        style={{ ...TYPOGRAPHY.label, width: '100%', color: COLORS.ink, textAlign: 'center' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function SecondaryButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, opacity: pressed ? 0.85 : 1, borderRadius: 12, minHeight: 48, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', flex: 1 },
      ]}
    >
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.78}
        style={{ ...TYPOGRAPHY.label, width: '100%', color: COLORS.muted, textAlign: 'center' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View style={{ padding: SPACING.xl, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed', backgroundColor: COLORS.surface, marginBottom: SPACING.md }}>
      <Text style={{ ...TYPOGRAPHY.body, color: COLORS.muted, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

export function Stars({ value, onChange, size = 16 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          onPress={() => onChange?.(n)}
          disabled={!onChange}
          hitSlop={4}
          testID={`star-${n}`}
          accessibilityRole={onChange ? 'button' : undefined}
          accessibilityLabel={`${n} estrela${n > 1 ? 's' : ''}`}
          accessibilityState={{ selected: n === value }}
        >
          <FontAwesome
            name={n <= value ? 'star' : 'star-o'}
            size={size}
            color={n <= value ? COLORS.gold : COLORS.muted}
            style={{ opacity: n <= value ? 1 : 0.55 }}
          />
        </Pressable>
      ))}
    </View>
  );
}

export function Chip({ label, active, onPress, testID }: { label: string; active?: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
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
      <Text style={{ ...TYPOGRAPHY.label, color: active ? COLORS.ink : COLORS.muted, fontWeight: active ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}
