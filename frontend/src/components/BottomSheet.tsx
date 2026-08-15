import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Modal, Pressable, ScrollView, KeyboardAvoidingView, Platform, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { COLORS, SPACING, TYPOGRAPHY, FONT_SIZES } from '../theme';
import { AppText as Text } from './Typography';
import { useReducedMotion } from '../hooks/use-reduced-motion';

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  testID?: string;
  compact?: boolean;
  tone?: 'dark' | 'light';
  contentContainerStyle?: StyleProp<ViewStyle>;
};

export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  testID,
  compact = false,
  tone = 'dark',
  contentContainerStyle,
}: Props) {
  const { width } = useWindowDimensions();
  const desktop = width >= 900;
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<ScrollView>(null);
  const closeRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const sheetRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!visible) return;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
    }
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      if (Platform.OS === 'web') {
        const target = closeRef.current as unknown as HTMLElement | null;
        target?.focus?.();
      }
    }, 50);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const sheet = sheetRef.current as unknown as HTMLElement | null;
      if (!sheet) return;
      const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (!sheet.contains(current)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && current === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      clearTimeout(timer);
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('keydown', handleKeyDown);
        previousFocusRef.current?.focus?.();
        previousFocusRef.current = null;
      }
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType={reducedMotion ? 'none' : desktop ? 'fade' : 'slide'}
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        testID="bottom-sheet-backdrop"
        accessible={false}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.avoider, desktop && styles.avoiderDesktop]}
        >
          <Pressable
            ref={sheetRef}
            style={[
              styles.sheet,
              desktop && styles.sheetDesktop,
              tone === 'light' && styles.sheetLight,
              compact && styles.sheetCompact,
              desktop && compact && styles.sheetCompactDesktop,
            ]}
            onPress={() => {}}
            testID={testID}
            accessibilityLabel={title}
          >
            <View style={[styles.header, tone === 'light' && styles.headerLight]}>
              <Text style={[styles.title, tone === 'light' && styles.titleLight]} numberOfLines={1}>{title}</Text>
              <Pressable
                ref={closeRef}
                onPress={onClose}
                hitSlop={12}
                testID="bottom-sheet-close"
                accessibilityRole="button"
                accessibilityLabel={`Fechar ${title}`}
                accessibilityHint="Fecha esta janela e volta para a tela anterior"
              >
                <Feather name="x" size={20} color={COLORS.muted} />
              </Pressable>
            </View>
            <ScrollView
              ref={scrollRef}
              style={[styles.body, compact && styles.bodyCompact]}
              contentContainerStyle={[styles.bodyContent, contentContainerStyle]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator
            >
              {children}
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,9,6,0.72)', justifyContent: 'flex-end' },
  avoider: { flex: 1, justifyContent: 'flex-end', minHeight: 0 },
  avoiderDesktop: { justifyContent: 'center', alignItems: 'center', padding: SPACING.xl },
  sheet: { backgroundColor: COLORS.surfaceRaised, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '88%', maxHeight: '88%', minHeight: 0, overflow: 'hidden' },
  sheetDesktop: { width: '92%', maxWidth: 1120, height: '84%', maxHeight: 820, borderRadius: 24, borderWidth: 1, borderColor: COLORS.border },
  sheetLight: { backgroundColor: COLORS.surface },
  sheetCompact: { height: 'auto' },
  sheetCompactDesktop: { width: '92%', maxWidth: 680, maxHeight: '78%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerLight: { borderBottomColor: COLORS.border },
  title: { ...TYPOGRAPHY.subtitle, color: COLORS.bone, fontSize: FONT_SIZES.heading, lineHeight: 24, flex: 1 },
  titleLight: { color: COLORS.bone },
  body: { flex: 1, minHeight: 0 },
  bodyCompact: { flex: 0 },
  bodyContent: { padding: SPACING.lg, paddingBottom: 64 },
});
