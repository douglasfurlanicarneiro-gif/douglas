import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ApiError, buscarCep, createCompra } from '../api';
import { storage } from '../utils/storage';
import type { CheckoutPayload, Perfume, PriceOption } from '../types';
import { brl, COLORS, SPACING } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Field, PrimaryButton, SecondaryButton, TInput } from './atoms';

const CUSTOMER_KEY = 'checkout-customer-v1';

export type CartItem = {
  perfume: Perfume;
  option: PriceOption;
  quantidade: number;
};

type CustomerForm = Omit<CheckoutPayload, 'itens' | 'cliente' | 'contato' | 'observacoes'> & {
  observacoes: string;
};

const EMPTY_FORM: CustomerForm = {
  nomeCompleto: '',
  whatsapp: '',
  email: '',
  endereco: {
    cep: '',
    endereco: '',
    numero: '',
    complemento: '',
    bairro: '',
    cidade: '',
    estado: '',
  },
  formaPagamento: 'pix',
  observacoes: '',
};

type Props = {
  visible: boolean;
  items: CartItem[];
  onClose: () => void;
  onChangeQuantity: (index: number, quantity: number) => void;
  onRemove: (index: number) => void;
  onSuccess: (message: string) => void;
};

export function CheckoutSheet({
  visible,
  items,
  onClose,
  onChangeQuantity,
  onRemove,
  onSuccess,
}: Props) {
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState('');
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.option.preco * item.quantidade, 0),
    [items],
  );

  useEffect(() => {
    storage.getItem(CUSTOMER_KEY, '').then((saved) => {
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved) as CustomerForm & { telefone?: string };
        setForm({
          ...EMPTY_FORM,
          ...parsed,
          whatsapp: parsed.whatsapp || parsed.telefone || '',
          endereco: { ...EMPTY_FORM.endereco, ...(parsed.endereco || {}) },
        });
      } catch {
        storage.removeItem(CUSTOMER_KEY);
      }
    });
  }, []);

  const setAddress = (key: keyof CustomerForm['endereco'], value: string) => {
    setForm((current) => ({
      ...current,
      endereco: { ...current.endereco, [key]: value },
    }));
  };

  const handleCep = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    const formatted = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
    setAddress('cep', formatted);
    setCepError('');
    if (digits.length !== 8) return;

    setCepLoading(true);
    buscarCep(digits)
      .then((result) => {
        setForm((current) => {
          if (current.endereco.cep.replace(/\D/g, '') !== digits) return current;
          return {
            ...current,
            endereco: {
              ...current.endereco,
              endereco: result.endereco,
              bairro: result.bairro,
              cidade: result.cidade,
              estado: result.estado,
            },
          };
        });
      })
      .catch((cause) => {
        setCepError(cause instanceof ApiError ? cause.message : 'Não foi possível consultar o CEP.');
      })
      .finally(() => setCepLoading(false));
  };

  const complete = Boolean(
    items.length &&
    form.nomeCompleto.trim().length >= 2 &&
    form.whatsapp.trim().length >= 8 &&
    form.email.includes('@') &&
    form.endereco.cep.replace(/\D/g, '').length === 8 &&
    form.endereco.endereco.trim() &&
    form.endereco.numero.trim() &&
    form.endereco.bairro.trim() &&
    form.endereco.cidade.trim() &&
    form.endereco.estado.trim().length === 2
  );

  const submit = async () => {
    if (!complete) return;
    setLoading(true);
    setError('');
    try {
      const payload: CheckoutPayload = {
        itens: items.map(({ perfume, option, quantidade }) => ({
          perfumeId: perfume.id,
          ml: option.ml,
          quantidade,
        })),
        cliente: form.nomeCompleto.trim(),
        contato: form.whatsapp.trim(),
        ...form,
        endereco: {
          ...form.endereco,
          cep: form.endereco.cep.replace(/\D/g, ''),
          estado: form.endereco.estado.trim().toUpperCase(),
        },
      };
      const order = await createCompra(payload);
      await storage.setItem(CUSTOMER_KEY, JSON.stringify(form));
      const paymentMessage = order.pagamento?.status === 'gateway_nao_configurado'
        ? 'Nossa equipe entrará em contato pelo WhatsApp para combinar o pagamento e os próximos passos.'
        : 'Em breve você receberá pelo WhatsApp a confirmação do pedido e os próximos passos.';
      onSuccess(paymentMessage);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Não foi possível finalizar o pedido.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Carrinho e pagamento" testID="checkout-sheet">
      <View>
        {items.map((item, index) => (
          <View
            key={`${item.perfume.id}-${item.option.ml}`}
            style={{
              padding: SPACING.md,
              borderRadius: 12,
              backgroundColor: COLORS.ink,
              borderWidth: 1,
              borderColor: COLORS.border,
              marginBottom: SPACING.sm,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: COLORS.bone, fontSize: 14, fontWeight: '500' }}>{item.perfume.nome}</Text>
                <Text style={{ color: COLORS.muted, fontSize: 12 }}>{item.option.ml}ml · {brl(item.option.preco)}</Text>
              </View>
              <Pressable onPress={() => onChangeQuantity(index, item.quantidade - 1)} hitSlop={8}>
                <Feather name="minus-circle" size={20} color={COLORS.muted} />
              </Pressable>
              <Text style={{ color: COLORS.bone, minWidth: 18, textAlign: 'center' }}>{item.quantidade}</Text>
              <Pressable onPress={() => onChangeQuantity(index, item.quantidade + 1)} hitSlop={8}>
                <Feather name="plus-circle" size={20} color={COLORS.gold} />
              </Pressable>
              <Pressable onPress={() => onRemove(index)} hitSlop={8}>
                <Feather name="trash-2" size={18} color={COLORS.rust} />
              </Pressable>
            </View>
          </View>
        ))}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: SPACING.md }}>
          <Text style={{ color: COLORS.muted }}>Subtotal</Text>
          <Text style={{ color: COLORS.bone, fontSize: 17 }}>{brl(subtotal)}</Text>
        </View>

        <Text style={{ color: COLORS.gold, fontSize: 11, letterSpacing: 1, marginBottom: SPACING.md }}>DADOS DO CLIENTE</Text>
        <Field label="Nome completo"><TInput value={form.nomeCompleto} onChangeText={(nomeCompleto) => setForm({ ...form, nomeCompleto })} /></Field>
        <Field label="Celular / WhatsApp"><TInput keyboardType="phone-pad" autoComplete="tel" value={form.whatsapp} onChangeText={(whatsapp) => setForm({ ...form, whatsapp })} /></Field>
        <Field label="E-mail"><TInput keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={(email) => setForm({ ...form, email })} /></Field>

        <Text style={{ color: COLORS.gold, fontSize: 11, letterSpacing: 1, marginVertical: SPACING.md }}>ENDEREÇO</Text>
        <Field label="CEP">
          <TInput keyboardType="numeric" autoComplete="postal-code" maxLength={9} value={form.endereco.cep} onChangeText={handleCep} />
          {cepLoading && <Text style={{ color: COLORS.gold, fontSize: 11, marginTop: 5 }}>Buscando endereço…</Text>}
          {!!cepError && <Text style={{ color: COLORS.rust, fontSize: 11, marginTop: 5 }}>{cepError}</Text>}
        </Field>
        <Field label="Endereço"><TInput value={form.endereco.endereco} onChangeText={(value) => setAddress('endereco', value)} /></Field>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Field label="Número"><TInput value={form.endereco.numero} onChangeText={(value) => setAddress('numero', value)} /></Field></View>
          <View style={{ flex: 2 }}><Field label="Complemento"><TInput value={form.endereco.complemento} onChangeText={(value) => setAddress('complemento', value)} /></Field></View>
        </View>
        <Field label="Bairro"><TInput value={form.endereco.bairro} onChangeText={(value) => setAddress('bairro', value)} /></Field>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 3 }}><Field label="Cidade"><TInput value={form.endereco.cidade} onChangeText={(value) => setAddress('cidade', value)} /></Field></View>
          <View style={{ flex: 1 }}><Field label="UF"><TInput maxLength={2} autoCapitalize="characters" value={form.endereco.estado} onChangeText={(value) => setAddress('estado', value)} /></Field></View>
        </View>
        <Field label="Observações (opcional)"><TInput multiline style={{ minHeight: 72, textAlignVertical: 'top' }} value={form.observacoes} onChangeText={(observacoes) => setForm({ ...form, observacoes })} /></Field>

        <Field label="Forma de pagamento">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['pix', 'cartao'] as const).map((method) => {
              const active = form.formaPagamento === method;
              return (
                <Pressable
                  key={method}
                  onPress={() => setForm({ ...form, formaPagamento: method })}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    alignItems: 'center',
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: active ? COLORS.gold : COLORS.border,
                    backgroundColor: active ? COLORS.gold : COLORS.surface,
                  }}
                >
                  <Text style={{ color: active ? COLORS.ink : COLORS.muted }}>{method === 'pix' ? 'Pix' : 'Cartão'}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        {!!error && <Text style={{ color: COLORS.rust, marginBottom: SPACING.md }}>{error}</Text>}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <SecondaryButton label="Continuar comprando" onPress={onClose} />
          <PrimaryButton label={loading ? 'Finalizando…' : `Finalizar · ${brl(subtotal)}`} onPress={submit} disabled={!complete || loading} />
        </View>
      </View>
    </BottomSheet>
  );
}
