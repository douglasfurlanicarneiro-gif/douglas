import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ApiError, buscarCep, cotarFrete, createCompra } from '../api';
import { storage } from '../utils/storage';
import type { CheckoutPayload, Compra, OpcaoFrete, Perfume, PriceOption } from '../types';
import { brl, COLORS, SPACING, FONT_SIZES, RADIUS, TYPOGRAPHY } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Field, PrimaryButton, SecondaryButton, TInput } from './atoms';
import { AppText as Text } from './Typography';

const CUSTOMER_KEY = 'checkout-customer-v1';
const CHECKOUT_ATTEMPT_KEY = 'checkout-attempt-v1';

type CheckoutAttempt = {
  key: string;
  signature: string;
};

function createCheckoutAttemptKey() {
  const random = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  return `checkout-${Date.now().toString(36)}-${random}`;
}

export type CartItem = {
  perfume: Perfume;
  option: PriceOption;
  quantidade: number;
};

type CustomerForm = Omit<
  CheckoutPayload,
  'itens' | 'cliente' | 'contato' | 'observacoes' | 'freteEscolhido' | 'tipoEntrega' | 'endereco' | 'aceitePrazoEncomenda'
> & {
  endereco: NonNullable<CheckoutPayload['endereco']>;
  observacoes: string;
};

type CheckoutStep = 'dados' | 'entrega' | 'pagamento';
type DeliveryType = 'entrega' | 'retirada';

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
  onSuccess: (order: Compra, message: string) => void | Promise<void>;
  onStockConflict?: () => void | Promise<void>;
  cartaoOnlineAtivo: boolean;
  pixManualAtivo: boolean;
};

export function CheckoutSheet({
  visible,
  items,
  onClose,
  onChangeQuantity,
  onRemove,
  onSuccess,
  onStockConflict,
  cartaoOnlineAtivo,
  pixManualAtivo,
}: Props) {
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const [form, setForm] = useState<CustomerForm>(EMPTY_FORM);
  const [step, setStep] = useState<CheckoutStep>('dados');
  const [tipoEntrega, setTipoEntrega] = useState<DeliveryType>('entrega');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState('');
  const [freteLoading, setFreteLoading] = useState(false);
  const [freteError, setFreteError] = useState('');
  const [opcoesFrete, setOpcoesFrete] = useState<OpcaoFrete[]>([]);
  const [freteSelecionado, setFreteSelecionado] = useState<OpcaoFrete | null>(null);
  const [freteRefresh, setFreteRefresh] = useState(0);
  const [prazoEncomendaAceito, setPrazoEncomendaAceito] = useState(false);
  const checkoutAttemptRef = useRef<CheckoutAttempt | null>(null);
  const contemSobEncomenda = useMemo(
    () => items.some((item) => item.perfume.prontaEntrega !== true),
    [items],
  );
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.option.preco * item.quantidade, 0),
    [items],
  );
  const valorEntrega = tipoEntrega === 'entrega' ? (freteSelecionado?.preco || 0) : 0;
  const total = subtotal + valorEntrega;
  const pagamentoDisponivel = cartaoOnlineAtivo || pixManualAtivo;
  const nomeEntregaSelecionada = tipoEntrega === 'retirada'
    ? 'Retirada combinada'
    : freteSelecionado?.nomeExibicao
      || (freteSelecionado?.categoriaFrete === 'prioritaria' ? 'Entrega Prioritária' : 'Entrega Padrão');
  const detalheEntregaSelecionada = tipoEntrega === 'retirada'
    ? 'Local e horário combinados pelo WhatsApp'
    : freteSelecionado
      ? `Prazo estimado: ${freteSelecionado.prazoDias} ${freteSelecionado.prazoDias === 1 ? 'dia útil' : 'dias úteis'}`
      : '';

  useEffect(() => {
    setForm((current) => ({
      ...current,
      formaPagamento: cartaoOnlineAtivo ? 'cartao' : 'pix',
    }));
  }, [cartaoOnlineAtivo]);
  const priorityServiceId = useMemo(() => {
    const configured = opcoesFrete.find((option) => option.categoriaFrete === 'prioritaria');
    if (configured) return configured.serviceId;
    if (opcoesFrete.length < 2) return null;
    return opcoesFrete.reduce((fastest, option) => (
      option.prazoDias < fastest.prazoDias
      || (option.prazoDias === fastest.prazoDias && option.preco < fastest.preco)
        ? option
        : fastest
    )).serviceId;
  }, [opcoesFrete]);
  const displayedShippingOptions = useMemo(
    () => [...opcoesFrete].sort((first, second) => {
      if (first.serviceId === priorityServiceId) return -1;
      if (second.serviceId === priorityServiceId) return 1;
      return first.preco - second.preco;
    }),
    [opcoesFrete, priorityServiceId],
  );

  const itensFrete = useMemo(
    () => items.map(({ perfume, option, quantidade }) => ({
      perfumeId: perfume.id,
      ml: option.ml,
      quantidade,
    })),
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
          formaPagamento: cartaoOnlineAtivo ? 'cartao' : 'pix',
          endereco: { ...EMPTY_FORM.endereco, ...(parsed.endereco || {}) },
        });
      } catch {
        storage.removeItem(CUSTOMER_KEY);
      }
    });
  }, [cartaoOnlineAtivo]);

  useEffect(() => {
    if (!visible) return;
    setStep('dados');
    setError('');
    setPrazoEncomendaAceito(false);
  }, [visible]);

  useEffect(() => {
    if (!contemSobEncomenda) setPrazoEncomendaAceito(false);
  }, [contemSobEncomenda]);

  useEffect(() => {
    if (!visible || tipoEntrega !== 'entrega') {
      setFreteLoading(false);
      setFreteError('');
      setOpcoesFrete([]);
      setFreteSelecionado(null);
      return;
    }
    if (step !== 'entrega') return;
    const cep = form.endereco.cep.replace(/\D/g, '');
    if (cep.length !== 8 || itensFrete.length === 0) {
      setOpcoesFrete([]);
      setFreteSelecionado(null);
      setFreteError('');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setFreteLoading(true);
      setFreteError('');
      cotarFrete({ cepDestino: cep, itens: itensFrete })
        .then(({ opcoes }) => {
          if (cancelled) return;
          setOpcoesFrete(opcoes);
          setFreteSelecionado((current) => (
            opcoes.find((item) => item.serviceId === current?.serviceId)
            || opcoes[0]
            || null
          ));
        })
        .catch((cause) => {
          if (cancelled) return;
          setOpcoesFrete([]);
          setFreteSelecionado(null);
          setFreteError(
            cause instanceof ApiError
              ? cause.message
              : 'Não foi possível calcular a entrega.',
          );
        })
        .finally(() => {
          if (!cancelled) setFreteLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.endereco.cep, freteRefresh, itensFrete, step, tipoEntrega, visible]);

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

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const dadosCompletos = Boolean(
    items.length &&
    form.nomeCompleto.trim().length >= 2 &&
    form.whatsapp.trim().length >= 8 &&
    emailValido
  );

  const enderecoCompleto = Boolean(
    form.endereco.cep.replace(/\D/g, '').length === 8 &&
    form.endereco.endereco.trim() &&
    form.endereco.numero.trim() &&
    form.endereco.bairro.trim() &&
    form.endereco.cidade.trim() &&
    form.endereco.estado.trim().length === 2
  );

  const entregaCompleta = tipoEntrega === 'retirada'
    ? true
    : Boolean(enderecoCompleto && freteSelecionado);

  const complete = Boolean(
    dadosCompletos
    && entregaCompleta
    && pagamentoDisponivel
    && (form.formaPagamento !== 'cartao' || cartaoOnlineAtivo)
    && (!contemSobEncomenda || prazoEncomendaAceito)
  );

  const selectDeliveryType = (type: DeliveryType) => {
    setTipoEntrega(type);
    setFreteError('');
  };

  const submit = async () => {
    if (!complete) return;
    setLoading(true);
    setError('');
    try {
      const { endereco, ...dadosCliente } = form;
      const payload: CheckoutPayload = {
        itens: items.map(({ perfume, option, quantidade }) => ({
          perfumeId: perfume.id,
          ml: option.ml,
          quantidade,
        })),
        cliente: form.nomeCompleto.trim(),
        contato: form.whatsapp.trim(),
        ...dadosCliente,
        aceitePrazoEncomenda: !contemSobEncomenda || prazoEncomendaAceito,
        tipoEntrega,
        ...(tipoEntrega === 'entrega'
          ? {
              endereco: {
                ...endereco,
                cep: endereco.cep.replace(/\D/g, ''),
                estado: endereco.estado.trim().toUpperCase(),
              },
              freteEscolhido: {
                serviceId: freteSelecionado!.serviceId,
              },
            }
          : {}),
      };
      const signature = JSON.stringify(payload);
      if (!checkoutAttemptRef.current) {
        const savedAttempt = await storage.getItem(CHECKOUT_ATTEMPT_KEY, '');
        if (savedAttempt) {
          try {
            const parsed = JSON.parse(savedAttempt) as CheckoutAttempt;
            if (parsed.key && parsed.signature === signature) {
              checkoutAttemptRef.current = parsed;
            }
          } catch {
            await storage.removeItem(CHECKOUT_ATTEMPT_KEY);
          }
        }
      }
      if (checkoutAttemptRef.current?.signature !== signature) {
        checkoutAttemptRef.current = {
          key: createCheckoutAttemptKey(),
          signature,
        };
        await storage.setItem(
          CHECKOUT_ATTEMPT_KEY,
          JSON.stringify(checkoutAttemptRef.current),
        );
      }
      const order = await createCompra(payload, checkoutAttemptRef.current.key);
      await storage.setItem(CUSTOMER_KEY, JSON.stringify(form));
      const paymentMessage = order.pagamento?.checkoutUrl
        ? 'Seu pedido está salvo. Escolha Pix ou cartão na InfinitePay; após a aprovação, a confirmação será automática.'
        : order.pagamento?.pixCopiaECola
          ? 'Pague pelo QR Code ou Pix Copia e Cola. Assim que você concluir, confirmaremos o recebimento e iniciaremos o preparo.'
        : order.pagamento?.status === 'gateway_nao_configurado'
          ? 'Nossa equipe entrará em contato pelo WhatsApp para combinar o pagamento e os próximos passos.'
          : 'Em breve você receberá pelo WhatsApp a confirmação do pedido e os próximos passos.';
      await onSuccess(order, paymentMessage);
      checkoutAttemptRef.current = null;
      await storage.removeItem(CHECKOUT_ATTEMPT_KEY);
      if (order.pagamento?.checkoutUrl) {
        const checkoutUrl = order.pagamento.checkoutUrl;
        const parsed = new URL(checkoutUrl);
        const host = parsed.hostname.toLowerCase();
        const seguro = parsed.protocol === 'https:' && (
          host === 'infinitepay.com.br'
          || host.endsWith('.infinitepay.com.br')
          || host === 'infinitepay.io'
          || host.endsWith('.infinitepay.io')
        );
        if (!seguro) throw new Error('Endereço de pagamento inválido.');
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.location.assign(checkoutUrl);
        } else {
          await Linking.openURL(checkoutUrl);
        }
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        try { await onStockConflict?.(); } catch { /* a mensagem original permanece */ }
      }
      setError(cause instanceof ApiError ? cause.message : 'Não foi possível finalizar o pedido.');
    } finally {
      setLoading(false);
    }
  };

  const steps: { id: CheckoutStep; label: string }[] = [
    { id: 'dados', label: 'Dados' },
    { id: 'entrega', label: 'Entrega' },
    { id: 'pagamento', label: 'Pagamento' },
  ];

  const optionCard = (opcao: OpcaoFrete) => {
    const active = freteSelecionado?.serviceId === opcao.serviceId;
    const displayName = opcao.nomeExibicao || (
      opcao.serviceId === priorityServiceId ? 'Entrega Prioritária' : 'Entrega Padrão'
    );
    return (
      <Pressable
        key={opcao.serviceId}
        onPress={() => setFreteSelecionado(opcao)}
        style={{
          padding: 13,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: active ? COLORS.gold : COLORS.border,
          backgroundColor: active ? COLORS.surfaceRaised : COLORS.surface,
          marginBottom: SPACING.sm,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Feather name={active ? 'check-circle' : 'circle'} size={18} color={active ? COLORS.gold : COLORS.muted} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '600' }}>
            {displayName}
          </Text>
          <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 }}>
            Prazo estimado: {opcao.prazoDias} {opcao.prazoDias === 1 ? 'dia útil' : 'dias úteis'}
          </Text>
        </View>
        <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.body, fontWeight: '600' }}>{brl(opcao.preco)}</Text>
      </Pressable>
    );
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Carrinho e pagamento"
      testID="checkout-sheet"
      contentContainerStyle={[styles.checkoutContent, isWide && styles.checkoutContentWide]}
    >
      <View>
        <View style={[styles.steps, isWide && styles.stepsWide]}>
          {steps.map((item, index) => {
            const active = step === item.id;
            const enabled = item.id === 'dados'
              || (item.id === 'entrega' && dadosCompletos)
              || (item.id === 'pagamento' && dadosCompletos && entregaCompleta);
            return (
              <React.Fragment key={item.id}>
                {index > 0 && <View style={[styles.stepConnector, isWide && styles.stepConnectorWide]} />}
                <Pressable
                  disabled={!enabled}
                  onPress={() => setStep(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Etapa ${index + 1}: ${item.label}`}
                  accessibilityState={{ selected: active, disabled: !enabled }}
                  style={[styles.stepButton, { opacity: enabled ? 1 : 0.45 }]}
                >
                  <View style={[
                    styles.stepCircle,
                    isWide && styles.stepCircleWide,
                    active && styles.stepCircleActive,
                  ]}>
                    <Text style={[styles.stepNumber, active && styles.stepNumberActive]}>
                      {index + 1}
                    </Text>
                  </View>
                  <Text style={[styles.stepLabel, isWide && styles.stepLabelWide, active && styles.stepLabelActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              </React.Fragment>
            );
          })}
        </View>

        {step === 'dados' && (
          <View>
            {items.map((item, index) => (
              <View
                key={`${item.perfume.id}-${item.option.ml}`}
                style={{
                  padding: SPACING.md,
                  borderRadius: 12,
                  backgroundColor: COLORS.surface,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  marginBottom: SPACING.sm,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.body, fontWeight: '500' }}>{item.perfume.nome}</Text>
                    <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.label }}>{item.option.ml}ml · {brl(item.option.preco)}</Text>
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
              <Text style={{ color: COLORS.muted }}>Produtos</Text>
              <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.subtitle }}>{brl(subtotal)}</Text>
            </View>

            <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1, marginBottom: SPACING.md }}>
              DADOS DO CLIENTE
            </Text>
            <Field label="Nome completo"><TInput value={form.nomeCompleto} onChangeText={(nomeCompleto) => setForm({ ...form, nomeCompleto })} /></Field>
            <Field label="Celular / WhatsApp"><TInput keyboardType="phone-pad" autoComplete="tel" value={form.whatsapp} onChangeText={(whatsapp) => setForm({ ...form, whatsapp })} /></Field>
            <Field label="E-mail">
              <TInput
                keyboardType="email-address"
                autoCapitalize="none"
                value={form.email}
                onChangeText={(email) => setForm({ ...form, email })}
              />
              {!!form.email && !emailValido && (
                <Text style={{ color: COLORS.rust, fontSize: FONT_SIZES.caption, marginTop: 5 }}>
                  Informe um e-mail válido, como nome@exemplo.com.
                </Text>
              )}
            </Field>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: SPACING.sm }}>
              <SecondaryButton label="Continuar comprando" onPress={onClose} />
              <PrimaryButton label="Ir para entrega" onPress={() => setStep('entrega')} disabled={!dadosCompletos} />
            </View>
          </View>
        )}

        {step === 'entrega' && (
          <View>
            <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1, marginBottom: SPACING.md }}>
              COMO VOCÊ QUER RECEBER?
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: SPACING.lg }}>
              {([
                { id: 'entrega' as const, icon: 'truck' as const, title: 'Receber', meta: 'No endereço' },
                { id: 'retirada' as const, icon: 'shopping-bag' as const, title: 'Retirada Combinada', meta: 'Grátis' },
              ]).map((method) => {
                const active = tipoEntrega === method.id;
                return (
                  <Pressable
                    key={method.id}
                    onPress={() => selectDeliveryType(method.id)}
                    style={{
                      flex: 1,
                      padding: SPACING.md,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: active ? COLORS.gold : COLORS.border,
                      backgroundColor: active ? COLORS.surfaceRaised : COLORS.surface,
                    }}
                  >
                    <Feather name={method.icon} size={18} color={active ? COLORS.gold : COLORS.muted} />
                    <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '600', marginTop: 8 }}>{method.title}</Text>
                    <Text style={{ color: active ? COLORS.gold : COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 }}>{method.meta}</Text>
                  </Pressable>
                );
              })}
            </View>

            {tipoEntrega === 'retirada' ? (
              <View style={{
                padding: SPACING.md,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: COLORS.gold,
                backgroundColor: COLORS.surfaceRaised,
                marginBottom: SPACING.lg,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}>
                <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.gold }}>
                  <Feather name="check" size={19} color={COLORS.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.body, fontWeight: '600' }}>Retirada Combinada · Grátis</Text>
                  <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 3 }}>Combine o local e o horário pelo WhatsApp.</Text>
                </View>
              </View>
            ) : (
              <View>
                <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1, marginBottom: SPACING.md }}>ENDEREÇO</Text>
                <Field label="CEP">
                  <TInput keyboardType="numeric" autoComplete="postal-code" maxLength={9} value={form.endereco.cep} onChangeText={handleCep} />
                  {cepLoading && <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption, marginTop: 5 }}>Buscando endereço…</Text>}
                  {!!cepError && <Text style={{ color: COLORS.rust, fontSize: FONT_SIZES.caption, marginTop: 5 }}>{cepError}</Text>}
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

                {freteLoading && (
                  <View style={{ padding: SPACING.md, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, marginBottom: SPACING.sm }}>
                    <Text style={{ color: COLORS.muted }}>Calculando entrega…</Text>
                  </View>
                )}
                {!freteLoading && displayedShippingOptions.map((opcao) => optionCard(opcao))}
                {!freteLoading && displayedShippingOptions.length > 0 && (
                  <Pressable
                    onPress={() => setFreteRefresh((current) => current + 1)}
                    style={{
                      alignSelf: 'flex-end',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingVertical: 8,
                      paddingHorizontal: 4,
                      marginBottom: SPACING.sm,
                    }}
                  >
                    <Feather name="refresh-cw" size={14} color={COLORS.gold} />
                    <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.label, fontWeight: '600' }}>Atualizar valores do frete</Text>
                  </Pressable>
                )}
                {!!freteError && (
                  <View style={{ padding: SPACING.md, borderRadius: 12, borderWidth: 1, borderColor: COLORS.rust, backgroundColor: COLORS.surface, marginBottom: SPACING.sm }}>
                    <Text style={{ color: COLORS.rust, fontSize: FONT_SIZES.label }}>{freteError}</Text>
                  </View>
                )}
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 8, marginTop: SPACING.sm }}>
              <SecondaryButton label="Voltar" onPress={() => setStep('dados')} />
              <PrimaryButton label="Ir para pagamento" onPress={() => setStep('pagamento')} disabled={!entregaCompleta || freteLoading} />
            </View>
          </View>
        )}

        {step === 'pagamento' && (
          <View style={styles.paymentStep}>
            <Text style={[styles.paymentEyebrow, isWide && styles.paymentEyebrowWide]}>
              PAGAMENTO
            </Text>
            <View style={[styles.securePaymentCard, isWide && styles.securePaymentCardWide]}>
              <View style={[styles.securePaymentIcon, isWide && styles.securePaymentIconWide]}>
                <Feather name="shield" size={isWide ? 62 : 38} color={COLORS.gold} />
                <View style={styles.securePaymentLock}>
                  <Feather name="lock" size={isWide ? 21 : 14} color={COLORS.muted} />
                </View>
              </View>
              <View style={styles.securePaymentCopy}>
                <Text style={[styles.securePaymentTitle, isWide && styles.securePaymentTitleWide]}>Pagamento seguro</Text>
                <Text style={[styles.securePaymentText, isWide && styles.securePaymentTextWide]}>
                  {cartaoOnlineAtivo
                    ? 'Você será direcionado para concluir o pagamento em um ambiente seguro. Assim que o pagamento for aprovado, seu pedido será confirmado automaticamente.'
                    : pixManualAtivo
                      ? 'Finalize o pagamento por Pix usando o QR Code ou o código copia e cola. Depois do recebimento, confirmaremos o pedido.'
                      : 'O pagamento está temporariamente indisponível. Entre em contato com a loja para concluir seu pedido.'}
                </Text>
              </View>
            </View>
            {!cartaoOnlineAtivo && pixManualAtivo && (
              <Text style={styles.manualPaymentHint}>
                Pagamento por Pix com confirmação manual. O checkout automático está temporariamente indisponível.
              </Text>
            )}
            {!pagamentoDisponivel && (
              <View style={styles.paymentUnavailable}>
                <Text style={styles.paymentUnavailableTitle}>Pagamento temporariamente indisponível</Text>
                <Text style={styles.paymentUnavailableText}>Entre em contato com a loja para combinar o pagamento.</Text>
              </View>
            )}
            <Field label="Observações do pedido (opcional)">
              <TInput
                multiline
                placeholder="Escreva aqui..."
                style={[styles.orderNotes, isWide && styles.orderNotesWide]}
                value={form.observacoes}
                onChangeText={(observacoes) => setForm({ ...form, observacoes })}
              />
            </Field>

            <View style={[styles.paymentSummary, isWide && styles.paymentSummaryWide]}>
              <Text style={styles.paymentSummaryLabel}>Produtos</Text>
              <View style={styles.paymentProductList}>
                {items.map((item) => (
                  <View key={`${item.perfume.id}-${item.option.ml}`} style={styles.paymentProductRow}>
                    <View style={styles.paymentProductCopy}>
                      <Text
                        numberOfLines={2}
                        style={[styles.paymentProductName, isWide && styles.paymentProductNameWide]}
                      >
                        {item.perfume.nome}
                      </Text>
                      <Text style={styles.paymentProductMeta}>
                        {item.option.ml} ml · {item.quantidade === 1 ? '1 unidade' : `${item.quantidade} unidades`}
                      </Text>
                    </View>
                    <Text style={styles.paymentProductValue}>
                      {brl(item.option.preco * item.quantidade)}
                    </Text>
                  </View>
                ))}
              </View>
              <View style={styles.paymentSummaryDivider} />
              <View style={[styles.paymentSummaryRow, styles.paymentSummaryDelivery]}>
                <View style={styles.paymentDeliveryCopy}>
                  <Text style={styles.paymentSummaryLabel}>{nomeEntregaSelecionada}</Text>
                  {!!detalheEntregaSelecionada && (
                    <Text style={styles.paymentDeliveryMeta}>{detalheEntregaSelecionada}</Text>
                  )}
                </View>
                <Text style={[styles.paymentSummaryValue, tipoEntrega === 'retirada' && styles.paymentSummaryFree]}>
                  {tipoEntrega === 'retirada' ? 'Grátis' : brl(valorEntrega)}
                </Text>
              </View>
              <View style={styles.paymentSummaryDivider} />
              <View style={styles.paymentSummaryTotalRow}>
                <Text style={[styles.paymentSummaryTotalLabel, isWide && styles.paymentSummaryTotalLabelWide]}>Total</Text>
                <Text style={[styles.paymentSummaryTotal, isWide && styles.paymentSummaryTotalWide]}>{brl(total)}</Text>
              </View>
            </View>

            {contemSobEncomenda && (
              <View
                style={{
                  padding: SPACING.md,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: COLORS.gold,
                  backgroundColor: COLORS.surfaceRaised,
                  marginBottom: SPACING.md,
                }}
                testID="made-to-order-deadline-notice"
              >
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <Feather name="clock" size={19} color={COLORS.gold} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '700' }}>
                      Prazo para itens sob encomenda
                    </Text>
                    <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 18, marginTop: 5 }}>
                      A disponibilidade, preparação e maturação podem levar até 14 dias antes da postagem ou retirada. Em caso de envio, depois desse período soma-se o prazo da transportadora escolhido na etapa anterior.
                    </Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => setPrazoEncomendaAceito((current) => !current)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: prazoEncomendaAceito }}
                  testID="accept-made-to-order-deadline"
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 9,
                    marginTop: SPACING.md,
                    paddingTop: SPACING.md,
                    borderTopWidth: 1,
                    borderTopColor: COLORS.border,
                  }}
                >
                  <Feather
                    name={prazoEncomendaAceito ? 'check-square' : 'square'}
                    size={19}
                    color={prazoEncomendaAceito ? COLORS.gold : COLORS.muted}
                  />
                  <Text style={{ color: COLORS.bone, flex: 1, fontSize: FONT_SIZES.label, lineHeight: 18 }}>
                    Li e estou de acordo com esse prazo.
                  </Text>
                </Pressable>
              </View>
            )}

            {!!error && <Text style={{ color: COLORS.rust, marginBottom: SPACING.md }}>{error}</Text>}
            <View style={[styles.paymentActions, isWide && styles.paymentActionsWide]}>
              <Pressable
                onPress={() => setStep('entrega')}
                accessibilityRole="button"
                accessibilityLabel="Voltar para a entrega"
                style={({ pressed }) => [
                  styles.paymentBackButton,
                  isWide && styles.paymentButtonWide,
                  pressed && styles.paymentButtonPressed,
                ]}
              >
                <Feather name="arrow-left" size={isWide ? 25 : 20} color={COLORS.muted} />
                <Text style={[styles.paymentBackText, isWide && styles.paymentActionTextWide]}>Voltar</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={!complete || loading}
                accessibilityRole="button"
                accessibilityLabel={`${loading ? 'Abrindo pagamento' : 'Ir para pagamento'}, total ${brl(total)}`}
                accessibilityState={{ disabled: !complete || loading }}
                style={({ pressed }) => [
                  styles.paymentSubmitButton,
                  isWide && styles.paymentButtonWide,
                  (!complete || loading) && styles.paymentSubmitButtonDisabled,
                  pressed && complete && !loading && styles.paymentButtonPressed,
                ]}
              >
                <View style={styles.paymentActionSpacer} />
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  style={[styles.paymentSubmitText, isWide && styles.paymentActionTextWide]}
                >
                  {loading ? 'Abrindo pagamento…' : `Ir para pagamento · ${brl(total)}`}
                </Text>
                <Feather name="arrow-right" size={isWide ? 25 : 20} color={COLORS.inverse} />
              </Pressable>
            </View>

            <View style={[styles.paymentBrand, isWide && styles.paymentBrandWide]} accessibilityElementsHidden>
              <Text style={[styles.paymentBrandName, isWide && styles.paymentBrandNameWide]}>L’ESSENCE</Text>
              <Text style={styles.paymentBrandSubtitle}>FURLANI PARFUM</Text>
              <View style={styles.paymentBrandOrnament} />
            </View>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  checkoutContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  checkoutContentWide: {
    width: '100%',
    maxWidth: 1480,
    alignSelf: 'center',
    paddingHorizontal: 56,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.xl,
  },
  steps: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.xl,
    paddingHorizontal: SPACING.xs,
  },
  stepsWide: {
    marginBottom: 36,
    paddingHorizontal: 34,
  },
  stepConnector: {
    flex: 1,
    height: 1,
    marginTop: 15,
    backgroundColor: COLORS.border,
  },
  stepConnectorWide: {
    marginTop: 23,
  },
  stepButton: {
    minWidth: 54,
    alignItems: 'center',
  },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  stepCircleWide: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },
  stepCircleActive: {
    backgroundColor: COLORS.gold,
    borderColor: COLORS.gold,
  },
  stepNumber: {
    ...TYPOGRAPHY.label,
    color: COLORS.muted,
  },
  stepNumberActive: {
    color: COLORS.ink,
  },
  stepLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.muted,
    marginTop: SPACING.xs,
  },
  stepLabelWide: {
    ...TYPOGRAPHY.body,
    marginTop: SPACING.sm,
  },
  stepLabelActive: {
    color: COLORS.gold,
  },
  paymentStep: {
    width: '100%',
  },
  paymentEyebrow: {
    ...TYPOGRAPHY.eyebrow,
    color: COLORS.gold,
    marginBottom: SPACING.md,
  },
  paymentEyebrowWide: {
    ...TYPOGRAPHY.body,
    color: COLORS.gold,
    fontWeight: '600',
    letterSpacing: 1.2,
  },
  securePaymentCard: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    shadowColor: COLORS.ink,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  securePaymentCardWide: {
    minHeight: 164,
    gap: 36,
    paddingHorizontal: 34,
    paddingVertical: 24,
    marginBottom: SPACING.xl,
  },
  securePaymentIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceRaised,
  },
  securePaymentIconWide: {
    width: 116,
    height: 116,
    borderRadius: 58,
  },
  securePaymentLock: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 9,
  },
  securePaymentCopy: {
    flex: 1,
  },
  securePaymentTitle: {
    ...TYPOGRAPHY.subtitle,
    color: COLORS.bone,
    marginBottom: SPACING.xs,
  },
  securePaymentTitleWide: {
    ...TYPOGRAPHY.titleLarge,
    color: COLORS.bone,
    marginBottom: SPACING.sm,
  },
  securePaymentText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.bone,
    maxWidth: 560,
  },
  securePaymentTextWide: {
    ...TYPOGRAPHY.bodyLarge,
    color: COLORS.bone,
    lineHeight: 25,
  },
  manualPaymentHint: {
    ...TYPOGRAPHY.caption,
    color: COLORS.muted,
    marginTop: -SPACING.sm,
    marginBottom: SPACING.md,
  },
  paymentUnavailable: {
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.rust,
    backgroundColor: COLORS.surface,
    marginBottom: SPACING.md,
  },
  paymentUnavailableTitle: {
    ...TYPOGRAPHY.label,
    color: COLORS.bone,
  },
  paymentUnavailableText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.muted,
    marginTop: SPACING.xs,
  },
  orderNotes: {
    minHeight: 84,
    textAlignVertical: 'top',
    paddingTop: SPACING.md,
  },
  orderNotesWide: {
    minHeight: 86,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  paymentSummary: {
    padding: SPACING.lg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    marginBottom: SPACING.lg,
    shadowColor: COLORS.ink,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  paymentSummaryWide: {
    paddingHorizontal: 26,
    paddingVertical: 18,
    marginBottom: SPACING.xl,
  },
  paymentSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paymentProductList: {
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  paymentProductRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  paymentProductCopy: {
    flex: 1,
    minWidth: 0,
  },
  paymentProductName: {
    ...TYPOGRAPHY.label,
    color: COLORS.bone,
  },
  paymentProductNameWide: {
    ...TYPOGRAPHY.body,
    color: COLORS.bone,
  },
  paymentProductMeta: {
    ...TYPOGRAPHY.caption,
    color: COLORS.muted,
    marginTop: 2,
  },
  paymentProductValue: {
    ...TYPOGRAPHY.label,
    color: COLORS.bone,
  },
  paymentSummaryDelivery: {
    alignItems: 'flex-start',
  },
  paymentDeliveryCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: SPACING.md,
  },
  paymentDeliveryMeta: {
    ...TYPOGRAPHY.caption,
    color: COLORS.muted,
    marginTop: 2,
  },
  paymentSummaryLabel: {
    ...TYPOGRAPHY.body,
    color: COLORS.bone,
  },
  paymentSummaryValue: {
    ...TYPOGRAPHY.body,
    color: COLORS.bone,
  },
  paymentSummaryFree: {
    color: COLORS.sage,
  },
  paymentSummaryDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.md,
  },
  paymentSummaryTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  paymentSummaryTotalLabel: {
    ...TYPOGRAPHY.subtitle,
    color: COLORS.bone,
  },
  paymentSummaryTotalLabelWide: {
    ...TYPOGRAPHY.heading,
    color: COLORS.bone,
  },
  paymentSummaryTotal: {
    ...TYPOGRAPHY.title,
    color: COLORS.gold,
  },
  paymentSummaryTotalWide: {
    fontSize: FONT_SIZES.display,
    lineHeight: 34,
  },
  paymentActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  paymentActionsWide: {
    gap: SPACING.lg,
  },
  paymentBackButton: {
    flex: 0.55,
    minWidth: 0,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.gold,
    backgroundColor: COLORS.surface,
  },
  paymentBackText: {
    ...TYPOGRAPHY.subtitle,
    color: COLORS.muted,
  },
  paymentSubmitButton: {
    flex: 1.45,
    minWidth: 0,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.gold,
  },
  paymentButtonWide: {
    flex: 1,
  },
  paymentSubmitButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  paymentButtonPressed: {
    opacity: 0.84,
  },
  paymentActionSpacer: {
    width: 20,
  },
  paymentSubmitText: {
    ...TYPOGRAPHY.label,
    flex: 1,
    color: COLORS.ink,
    textAlign: 'center',
  },
  paymentActionTextWide: {
    ...TYPOGRAPHY.subtitle,
  },
  paymentBrand: {
    alignItems: 'center',
    marginTop: SPACING.xl,
    paddingBottom: SPACING.md,
  },
  paymentBrandWide: {
    marginTop: 34,
  },
  paymentBrandName: {
    color: COLORS.bone,
    fontSize: FONT_SIZES.subtitle,
    lineHeight: 22,
    letterSpacing: 2.4,
  },
  paymentBrandNameWide: {
    fontSize: FONT_SIZES.title,
    lineHeight: 27,
  },
  paymentBrandSubtitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.muted,
    letterSpacing: 2.8,
    marginTop: 1,
  },
  paymentBrandOrnament: {
    width: 42,
    height: 2,
    marginTop: SPACING.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.gold,
  },
});
