import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ApiError, buscarCep, cotarFrete, createCompra } from '../api';
import { storage } from '../utils/storage';
import type { CheckoutPayload, Compra, OpcaoFrete, Perfume, PriceOption } from '../types';
import { brl, COLORS, SPACING, FONT_SIZES } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Field, PrimaryButton, SecondaryButton, TInput } from './atoms';
import { AppText as Text } from './Typography';

const CUSTOMER_KEY = 'checkout-customer-v1';

export type CartItem = {
  perfume: Perfume;
  option: PriceOption;
  quantidade: number;
};

type CustomerForm = Omit<
  CheckoutPayload,
  'itens' | 'cliente' | 'contato' | 'observacoes' | 'freteEscolhido' | 'tipoEntrega' | 'endereco'
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
  cartaoOnlineAtivo,
  pixManualAtivo,
}: Props) {
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
  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + item.option.preco * item.quantidade, 0),
    [items],
  );
  const valorEntrega = tipoEntrega === 'entrega' ? (freteSelecionado?.preco || 0) : 0;
  const total = subtotal + valorEntrega;
  const pagamentoDisponivel = cartaoOnlineAtivo || pixManualAtivo;

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
  }, [visible]);

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
      const order = await createCompra(payload);
      await storage.setItem(CUSTOMER_KEY, JSON.stringify(form));
      const paymentMessage = order.pagamento?.checkoutUrl
        ? 'Seu pedido está salvo. Escolha Pix ou cartão na InfinitePay; após a aprovação, a confirmação será automática.'
        : order.pagamento?.pixCopiaECola
          ? 'Pague pelo QR Code ou Pix Copia e Cola. Assim que você concluir, confirmaremos o recebimento e iniciaremos o preparo.'
        : order.pagamento?.status === 'gateway_nao_configurado'
          ? 'Nossa equipe entrará em contato pelo WhatsApp para combinar o pagamento e os próximos passos.'
          : 'Em breve você receberá pelo WhatsApp a confirmação do pedido e os próximos passos.';
      await onSuccess(order, paymentMessage);
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
    <BottomSheet visible={visible} onClose={onClose} title="Carrinho e pagamento" testID="checkout-sheet">
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.lg }}>
          {steps.map((item, index) => {
            const active = step === item.id;
            const enabled = item.id === 'dados'
              || (item.id === 'entrega' && dadosCompletos)
              || (item.id === 'pagamento' && dadosCompletos && entregaCompleta);
            return (
              <React.Fragment key={item.id}>
                {index > 0 && <View style={{ flex: 1, height: 1, backgroundColor: COLORS.border }} />}
                <Pressable
                  disabled={!enabled}
                  onPress={() => setStep(item.id)}
                  style={{ alignItems: 'center', opacity: enabled ? 1 : 0.45 }}
                >
                  <View style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? COLORS.gold : COLORS.surface,
                    borderWidth: 1,
                    borderColor: active ? COLORS.gold : COLORS.border,
                  }}>
                    <Text style={{ color: active ? COLORS.ink : COLORS.muted, fontSize: FONT_SIZES.caption, fontWeight: '700' }}>
                      {index + 1}
                    </Text>
                  </View>
                  <Text style={{ color: active ? COLORS.gold : COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 4 }}>
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
          <View>
            <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1, marginBottom: SPACING.md }}>
              PAGAMENTO
            </Text>
            <Field label="Forma de pagamento">
              <Pressable
                onPress={() => pagamentoDisponivel && setForm({ ...form, formaPagamento: cartaoOnlineAtivo ? 'cartao' : 'pix' })}
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: SPACING.md,
                  alignItems: 'center',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: pagamentoDisponivel ? COLORS.gold : COLORS.border,
                  backgroundColor: pagamentoDisponivel ? COLORS.gold : COLORS.surface,
                }}
              >
                <Text style={{ color: pagamentoDisponivel ? COLORS.ink : COLORS.muted, fontWeight: '600' }}>
                  {cartaoOnlineAtivo ? 'Pix ou cartão · InfinitePay' : pixManualAtivo ? 'Pix' : 'Pagamento indisponível'}
                </Text>
              </Pressable>
            </Field>
            {!cartaoOnlineAtivo && pixManualAtivo && (
              <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: -8, marginBottom: SPACING.md }}>
                Pagamento por Pix com confirmação manual. O checkout automático está temporariamente indisponível.
              </Text>
            )}
            {!pagamentoDisponivel && (
              <View style={{ padding: SPACING.md, borderRadius: 12, borderWidth: 1, borderColor: COLORS.rust, backgroundColor: COLORS.surface, marginBottom: SPACING.md }}>
                <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '600' }}>Pagamento temporariamente indisponível</Text>
                <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 4 }}>Entre em contato com a loja para combinar o pagamento.</Text>
              </View>
            )}
            {cartaoOnlineAtivo && form.formaPagamento === 'cartao' && (
              <View style={{ padding: SPACING.md, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, marginBottom: SPACING.md }}>
                <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '600' }}>Pagamento automático pela InfinitePay</Text>
                <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 4 }}>No ambiente seguro da InfinitePay, escolha Pix ou cartão. A confirmação do pedido será automática.</Text>
              </View>
            )}
            <Field label="Observações (opcional)"><TInput multiline style={{ minHeight: 72, textAlignVertical: 'top' }} value={form.observacoes} onChangeText={(observacoes) => setForm({ ...form, observacoes })} /></Field>

            <View style={{ padding: SPACING.md, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, marginBottom: SPACING.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={{ color: COLORS.muted }}>Produtos</Text>
                <Text style={{ color: COLORS.bone }}>{brl(subtotal)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 11 }}>
                <Text style={{ color: COLORS.muted }}>{tipoEntrega === 'retirada' ? 'Retirada' : 'Entrega'}</Text>
                <Text style={{ color: tipoEntrega === 'retirada' ? COLORS.sage : COLORS.bone }}>
                  {tipoEntrega === 'retirada' ? 'Grátis' : brl(valorEntrega)}
                </Text>
              </View>
              <View style={{ height: 1, backgroundColor: COLORS.border, marginBottom: 11 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.body, fontWeight: '600' }}>Total</Text>
                <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.heading, fontWeight: '700' }}>{brl(total)}</Text>
              </View>
            </View>

            {!!error && <Text style={{ color: COLORS.rust, marginBottom: SPACING.md }}>{error}</Text>}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <SecondaryButton label="Voltar" onPress={() => setStep('entrega')} />
              <PrimaryButton
                label={loading
                  ? 'Abrindo pagamento…'
                  : cartaoOnlineAtivo
                    ? `Pagar · ${brl(total)}`
                    : `Finalizar · ${brl(total)}`}
                onPress={submit}
                disabled={!complete || loading}
              />
            </View>
          </View>
        )}
      </View>
    </BottomSheet>
  );
}
