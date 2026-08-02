import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StatusBar, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../src/theme';
import { Vitrine } from '../src/components/Vitrine';
import { Atelie } from '../src/components/Atelie';
import { BottomSheet } from '../src/components/BottomSheet';
import { Field, TInput, PrimaryButton, SecondaryButton } from '../src/components/atoms';
import { LaunchIntro } from '../src/components/LaunchIntro';
import { login, saveToken, getToken, clearToken, getConfiguracoesPublicas } from '../src/api';
import { DEFAULT_STORE_CONFIG, publicStoreConfig } from '../src/storeConfig';
import type { ConfiguracoesLojaPublicas } from '../src/types';

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
    } catch { setErro('Erro ao conectar. Tente novamente.'); }
    finally { setLoading(false); }
  };
  return (
    <View>
      <Text style={{ color: COLORS.gold, fontSize: 11, letterSpacing: 1.5, marginBottom: SPACING.sm }}>
        ACESSO RESTRITO
      </Text>
      <Text style={{ color: COLORS.muted, fontSize: 13, marginBottom: SPACING.md }}>
        Entre com suas credenciais de administrador.
      </Text>
      <Field label="Usuário"><TInput value={usuario} onChangeText={setUsuario} autoCapitalize="none" autoCorrect={false} testID="login-usuario" /></Field>
      <Field label="Senha"><TInput value={senha} onChangeText={setSenha} secureTextEntry testID="login-senha" /></Field>
      {!!erro && <Text style={{ color: COLORS.rust, fontSize: 12, marginBottom: 8 }} testID="login-erro">{erro}</Text>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton label={loading ? 'Entrando…' : 'Entrar'} onPress={entrar} disabled={loading || !usuario.trim() || !senha} testID="login-submit" />
      </View>
    </View>
  );
}

export default function Index() {
  const [modo, setModo] = useState<'vitrine' | 'atelie'>('vitrine');
  const [pedindoSenha, setPedindoSenha] = useState(false);
  const [checked, setChecked] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [storeConfig, setStoreConfig] = useState<ConfiguracoesLojaPublicas>(DEFAULT_STORE_CONFIG);

  useEffect(() => {
    let active = true;

    // Libera a interface imediatamente. Token e identidade da loja vêm do
    // armazenamento/API em segundo plano e não podem deixar uma tela vazia.
    setChecked(true);
    getToken().then((token) => {
      if (active && token) setModo('atelie');
    });
    getConfiguracoesPublicas()
      .then((config) => {
        if (active) setStoreConfig(publicStoreConfig(config));
      })
      .catch(() => undefined);

    return () => { active = false; };
  }, []);

  const sair = async () => { await clearToken(); setModo('vitrine'); };
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

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      {checked ? (
        modo === 'atelie' ? (
          <Atelie
            onSair={sair}
            onStoreConfigChange={(config) => setStoreConfig(publicStoreConfig(config))}
          />
        ) : (
          <Vitrine
            onAtelieClick={() => setPedindoSenha(true)}
            storeConfig={storeConfig}
            onRefreshStoreConfig={refreshStoreConfig}
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
        <LaunchIntro
          onFinish={finishIntro}
          storeName={storeConfig.nomeLoja}
        />
      )}
    </SafeAreaProvider>
  );
}
