import React, { useEffect, useState } from 'react';
import { View, Text, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS, SPACING } from '../src/theme';
import { Vitrine } from '../src/components/Vitrine';
import { Atelie } from '../src/components/Atelie';
import { BottomSheet } from '../src/components/BottomSheet';
import { Field, TInput, PrimaryButton, SecondaryButton } from '../src/components/atoms';
import { login, saveToken, getToken, clearToken } from '../src/api';

function LoginForm({ onUnlock, onCancel }: { onUnlock: () => void; onCancel: () => void }) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const entrar = async () => {
    setLoading(true); setErro('');
    try {
      const r = await login(usuario.trim(), senha);
      if (r.ok && r.token) { await saveToken(r.token); onUnlock(); }
      else setErro('Usuário ou senha incorretos.');
    } catch (e) { setErro('Erro ao conectar. Tente novamente.'); }
    finally { setLoading(false); }
  };
  return (
    <View>
      <Text style={{ color: COLORS.muted, fontSize: 13, marginBottom: SPACING.md }}>
        Entre com o usuário e a senha do Ateliê.
      </Text>
      <Field label="Usuário"><TInput value={usuario} onChangeText={setUsuario} autoCapitalize="none" autoCorrect={false} testID="login-usuario" /></Field>
      <Field label="Senha"><TInput value={senha} onChangeText={setSenha} secureTextEntry testID="login-senha" /></Field>
      {!!erro && <Text style={{ color: COLORS.rust, fontSize: 12, marginBottom: 8 }} testID="login-erro">{erro}</Text>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton label={loading ? 'Entrando…' : 'Entrar'} onPress={entrar} disabled={loading} testID="login-submit" />
      </View>
    </View>
  );
}

export default function Index() {
  const [modo, setModo] = useState<'vitrine' | 'atelie'>('vitrine');
  const [pedindoSenha, setPedindoSenha] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (t) setModo('atelie');
      setChecked(true);
    })();
  }, []);

  const sair = async () => { await clearToken(); setModo('vitrine'); };

  if (!checked) {
    return <View style={{ flex: 1, backgroundColor: COLORS.ink }} />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.ink} />
      {modo === 'atelie' ? (
        <Atelie onSair={sair} />
      ) : (
        <Vitrine onAtelieClick={() => setPedindoSenha(true)} />
      )}
      <BottomSheet visible={pedindoSenha} onClose={() => setPedindoSenha(false)} title="Acesso do Ateliê" testID="login-sheet">
        <LoginForm
          onUnlock={() => { setPedindoSenha(false); setModo('atelie'); }}
          onCancel={() => setPedindoSenha(false)}
        />
      </BottomSheet>
    </SafeAreaProvider>
  );
}
