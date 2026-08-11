import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../theme';
import { AppText as Text } from './Typography';
import { reportFrontendError } from '../api';

type Props = { children: React.ReactNode };
type State = { failed: boolean };

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (__DEV__) console.error('Erro de interface recuperado', error, info.componentStack);
    void reportFrontendError({
      tipo: 'react_boundary',
      mensagem: error.message || error.name || 'Falha de renderização',
      componentStack: `${info.componentStack || ''}\n${error.stack || ''}`.slice(0, 3000),
      plataforma: Platform.OS,
      caminho: Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.pathname : '/',
      versao: '1.0.0',
    });
  }

  private retry = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <View style={styles.page} accessibilityRole="alert">
        <View style={styles.card}>
          <View style={styles.icon}>
            <Feather name="refresh-cw" size={26} color={COLORS.gold} />
          </View>
          <Text style={styles.eyebrow}>L’ESSENCE FURLANI</Text>
          <Text style={styles.title}>Vamos carregar novamente</Text>
          <Text style={styles.body}>
            A página encontrou uma instabilidade rápida. Seus dados continuam protegidos.
          </Text>
          <Pressable
            onPress={this.retry}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            accessibilityRole="button"
            accessibilityLabel="Tentar carregar novamente"
          >
            <Feather name="refresh-cw" size={17} color={COLORS.ink} />
            <Text style={styles.buttonText}>Tentar novamente</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: '100%',
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    padding: SPACING.xxl,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  icon: {
    width: 58,
    height: 58,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  eyebrow: { ...TYPOGRAPHY.eyebrow, color: COLORS.gold, marginBottom: SPACING.sm },
  title: { ...TYPOGRAPHY.titleLarge, color: COLORS.bone, textAlign: 'center' },
  body: {
    ...TYPOGRAPHY.body,
    color: COLORS.muted,
    textAlign: 'center',
    marginTop: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  button: {
    minHeight: 48,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gold,
    paddingHorizontal: SPACING.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { ...TYPOGRAPHY.label, color: COLORS.ink },
});
