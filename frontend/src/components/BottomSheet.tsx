import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, KeyboardAvoidingView, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS, SPACING } from '../theme';

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
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} testID="bottom-sheet-backdrop">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoider}>
          <Pressable style={[styles.sheet, tone === 'light' && styles.sheetLight, compact && styles.sheetCompact]} onPress={() => {}} testID={testID}>
            <View style={[styles.header, tone === 'light' && styles.headerLight]}>
              <Text style={[styles.title, tone === 'light' && styles.titleLight]} numberOfLines={1}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={12} testID="bottom-sheet-close">
                <Feather name="x" size={20} color={tone === 'light' ? '#746858' : COLORS.muted} />
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
  sheet: { backgroundColor: COLORS.surfaceRaised, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '88%', maxHeight: '88%', minHeight: 0, overflow: 'hidden' },
  sheetLight: { backgroundColor: '#F3ECE2' },
  sheetCompact: { height: 'auto' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  headerLight: { borderBottomColor: '#C5AF8F' },
  title: { color: COLORS.bone, fontSize: 18, fontFamily: Platform.select({ default: undefined }), fontWeight: '500', flex: 1 },
  titleLight: { color: '#251F18' },
  body: { flex: 1, minHeight: 0 },
  bodyCompact: { flex: 0 },
  bodyContent: { padding: SPACING.lg, paddingBottom: 64 },
});
