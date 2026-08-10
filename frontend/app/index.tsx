import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { View, StatusBar, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS, SPACING, FONT_SIZES } from '../src/theme';
import { Vitrine } from '../src/components/Vitrine';
import { BottomSheet } from '../src/components/BottomSheet';
import { Field, TInput, PrimaryButton, SecondaryButton } from '../src/components/atoms';
import { ApiError, login, logout, saveToken, getToken, getConfiguracoesPublicas, setSessionExpiredHandler } from '../src/api';
import { DEFAULT_STORE_CONFIG, publicStoreConfig } from '../src/storeConfig';
import type { ConfiguracoesLojaPublicas } from '../src/types';
import { AppText as Text } from '../src/components/Typography';

const LazyAtelie = lazy(() => import('../src/components/Atelie').then((module) => ({
  default: module.Atelie,
})));
const LazyLaunchIntro = lazy(() => import('../src/components/LaunchIntro').then((module) => ({
  default: module.LaunchIntro,
})));

// Garante que a assinatura visual complete ao menos uma passagem do brilho
// quando a vitrine abre rapidamente. A espera só existe enquanto o preloader
// cobre a tela; carregamentos mais longos não recebem atraso adicional.
const WEB_PRELOADER_MIN_VISIBLE_MS = 1450;

function AdminLoading() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background }}>
      <ActivityIndicator color={COLORS.gold} accessibilityLabel="Carregando painel de controle" />
      <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.label, marginTop: SPACING.sm }}>Abrindo painel…</Text>
    </View>
  );
}

function AdminReady({ children, onReady }: { children: React.ReactNode; onReady: () => void }) {
  useEffect(() => onReady(), [onReady]);
  return children;
}

function LoginForm({ onUnlock, onCancel }: { onUnlock: () => void; onCancel: () => void }) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const entrar = async () => {
    setLoading(true); setErro('');
    try {
      const r = await login(usuario.trim(), senha);
      if (r.ok && r.token) {
        await saveToken(r.token);
        onUnlock();
      } else {
        setErro('Usuário ou senha incorretos.');
      }
    } catch (error) { setErro(error instanceof ApiError ? error.message : 'Erro ao conectar. Tente novamente.'); }
    finally { setLoading(false); }
  };
  return (
    <View>
      <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.5, marginBottom: SPACING.sm }}>
        ACESSO RESTRITO
      </Text>
      <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.bodySmall, marginBottom: SPACING.md }}>
        Entre com suas credenciais de administrador.
      </Text>
      <Field label="Usuário"><TInput value={usuario} onChangeText={setUsuario} autoCapitalize="none" autoCorrect={false} testID="login-usuario" /></Field>
      <Field label="Senha"><TInput value={senha} onChangeText={setSenha} secureTextEntry testID="login-senha" /></Field>
      {!!erro && <Text style={{ color: COLORS.rust, fontSize: FONT_SIZES.label, marginBottom: 8 }} testID="login-erro">{erro}</Text>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton label={loading ? 'Entrando…' : 'Entrar'} onPress={entrar} disabled={loading || !usuario.trim() || !senha} testID="login-submit" />
      </View>
    </View>
  );
}

export default function Index() {
  const [hydrated, setHydrated] = useState(Platform.OS !== 'web');
  const [modo, setModo] = useState<'vitrine' | 'atelie'>('vitrine');
  const [pedindoSenha, setPedindoSenha] = useState(false);
  const [checked, setChecked] = useState(false);
  const [showIntro, setShowIntro] = useState(Platform.OS !== 'web');
  const [storeConfig, setStoreConfig] = useState<ConfiguracoesLojaPublicas>(DEFAULT_STORE_CONFIG);

  useEffect(() => {
    // O Expo exporta um HTML estatico no servidor. No navegador, aguardamos a
    // hidratacao antes de montar componentes que dependem de APIs nativas/web
    // (SafeArea, Modal e StatusBar), evitando a arvore inicial divergente que
    // podia resultar em tela vazia em alguns aparelhos.
    setHydrated(true);
  }, []);

  const finishWebPreloader = useCallback(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const preloader = document.getElementById('brand-preloader');
    if (!preloader || preloader.dataset.hiding === 'true') return;
    preloader.dataset.hiding = 'true';

    const elapsed = typeof performance !== 'undefined' ? performance.now() : WEB_PRELOADER_MIN_VISIBLE_MS;
    const remaining = Math.max(0, WEB_PRELOADER_MIN_VISIBLE_MS - elapsed);
    window.setTimeout(() => {
      preloader.style.opacity = '0';
      window.setTimeout(() => preloader.remove(), 320);
    }, remaining);
  }, []);

  useEffect(() => {
    let active = true;

    // Decide a área inicial antes de liberar a interface para evitar montar a
    // vitrine e baixar seus dados quando o usuário já está autenticado.
    getToken()
      .then((token) => {
        if (!active) return;
        if (token) setModo('atelie');
        setChecked(true);
      })
      .catch(() => {
        if (active) setChecked(true);
      });
    getConfiguracoesPublicas()
      .then((config) => {
        if (active) setStoreConfig(publicStoreConfig(config));
      })
      .catch(() => undefined);

    return () => { active = false; };
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setModo('vitrine');
      setPedindoSenha(false);
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  const sair = async () => { await logout().catch(() => undefined); setModo('vitrine'); };
  const finishIntro = useCallback(() => setShowIntro(false), []);
  const refreshStoreConfig = useCallback(async () => {
    const config = publicStoreConfig(await getConfiguracoesPublicas());
    setStoreConfig(config);
    return config;
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.title = storeConfig.nomeLoja;
    const mobileTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    mobileTitle?.setAttribute('content', storeConfig.nomeLoja);

    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    appleIcon?.setAttribute('href', '/apple-touch-icon-light.png?v=2');
    const favicon = document.querySelector('link[rel="icon"]');
    favicon?.setAttribute('href', '/favicon-light.png?v=2');
  }, [storeConfig.nomeLoja]);

  if (!hydrated) {
    return <View style={{ flex: 1, backgroundColor: COLORS.background }} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      {checked ? (
        modo === 'atelie' ? (
          <Suspense fallback={<AdminLoading />}>
            <AdminReady onReady={finishWebPreloader}>
              <LazyAtelie
                onSair={sair}
                onStoreConfigChange={(config) => setStoreConfig(publicStoreConfig(config))}
              />
            </AdminReady>
          </Suspense>
        ) : (
          <Vitrine
            onAtelieClick={() => setPedindoSenha(true)}
            storeConfig={storeConfig}
            onRefreshStoreConfig={refreshStoreConfig}
            onReady={finishWebPreloader}
          />
        )
      ) : (
        <View style={{ flex: 1, backgroundColor: COLORS.background }} />
      )}
      <BottomSheet visible={checked && pedindoSenha} onClose={() => setPedindoSenha(false)} title="Painel de Controle" testID="login-sheet">
        <LoginForm
          onUnlock={() => { setPedindoSenha(false); setModo('atelie'); }}
          onCancel={() => setPedindoSenha(false)}
        />
      </BottomSheet>
      {showIntro && (
        <Suspense fallback={null}>
          <LazyLaunchIntro
            onFinish={finishIntro}
            storeName={storeConfig.nomeLoja}
          />
        </Suspense>
      )}
    </SafeAreaProvider>
  );
}
