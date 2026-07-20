import React from 'react';
import { View, Text, StyleSheet, Modal, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING } from '../theme';

type Props = { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; testID?: string };

export function BottomSheet({ visible, onClose, title, children, testID }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} testID="bottom-sheet-backdrop">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoider}>
          <Pressable style={styles.sheet} onPress={() => {}} testID={testID}>
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={12} testID="bottom-sheet-close">
                <Feather name="x" size={20} color={COLORS.muted} />
              </Pressable>
            </View>
            <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: SPACING.xxl }} keyboardShouldPersistTaps="handled">
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
  avoider: { justifyContent: 'flex-end' },
  sheet: { backgroundColor: COLORS.surfaceRaised, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: SPACING.lg, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  title: { color: COLORS.bone, fontSize: 18, fontFamily: Platform.select({ default: undefined }), fontWeight: '500', flex: 1 },
  body: { padding: SPACING.lg },
});
