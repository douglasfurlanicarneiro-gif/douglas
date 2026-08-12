import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { COLORS, FONT_SIZES, RADIUS, SPACING, STATUS, brl, padSeq, statusPermitidosNoPainel } from '../theme';
import { getClientePorContato } from '../api';
import type { PaymentOperation, Pedido, PedidoItem, Perfume } from '../types';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import { AppText as Text, AppTextInput as TextInput } from './Typography';
import { Field, PrimaryButton, SecondaryButton, TInput } from './atoms';

export type PedidoFormState = Partial<Pedido> & Pick<Pedido, 'cliente' | 'contato' | 'status' | 'observacoes' | 'itens'>;
export type PedidoSaveData = PedidoFormState & {
  itens: PedidoItem[];
  subtotalTabela: number;
  ajusteManual: number;
  total: number;
};
type PedidoEndereco = NonNullable<Pedido['endereco']>;
const PAYMENT_OPERATION_COPY: Record<PaymentOperation, { label: string; hint: string }> = {
  solicitar_estorno: {
    label: 'Solicitar estorno',
    hint: 'Marca o valor como aguardando devolução.',
  },
  confirmar_estorno: {
    label: 'Confirmar estorno realizado',
    hint: 'Use somente depois de concluir o cancelamento no provedor.',
  },
  registrar_contestacao: {
    label: 'Registrar contestação',
    hint: 'Sinaliza uma venda contestada pelo titular do cartão.',
  },
  resolver_contestacao_favoravel: {
    label: 'Contestação favorável',
    hint: 'O pagamento continua válido para a loja.',
  },
  resolver_chargeback: {
    label: 'Confirmar chargeback',
    hint: 'O valor foi devolvido ao titular e deixa de compor a receita.',
  },
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  aguardando_pagamento: 'Aguardando pagamento',
  pendente: 'Pendente',
  pago: 'Pago',
  estorno_solicitado: 'Estorno solicitado',
  estornado: 'Estornado',
  contestado: 'Em contestação',
  chargeback_confirmado: 'Chargeback confirmado',
};

export function PaymentOperationForm({
  pedido,
  onSave,
  onCancel,
}: {
  pedido: Pedido;
  onSave: (operacao: PaymentOperation, motivo: string, referencia: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const status = pedido.pagamento?.status || '';
  const operacoes: PaymentOperation[] = status === 'pago'
    ? ['solicitar_estorno', 'registrar_contestacao']
    : status === 'estorno_solicitado'
      ? ['confirmar_estorno', 'registrar_contestacao']
      : status === 'contestado'
        ? ['resolver_contestacao_favoravel', 'resolver_chargeback']
        : [];
  const [operacao, setOperacao] = useState<PaymentOperation | null>(operacoes[0] || null);
  const [motivo, setMotivo] = useState('');
  const [referencia, setReferencia] = useState('');
  const [saving, setSaving] = useState(false);
  const exigeReferencia = operacao != null && [
    'confirmar_estorno',
    'resolver_contestacao_favoravel',
    'resolver_chargeback',
  ].includes(operacao);
  const valido = Boolean(operacao && motivo.trim().length >= 5 && (!exigeReferencia || referencia.trim().length >= 3));
  const submit = async () => {
    if (!operacao || !valido || saving) return;
    setSaving(true);
    try {
      await onSave(operacao, motivo.trim(), referencia.trim());
    } finally {
      setSaving(false);
    }
  };
  return (
    <View>
      <View style={styles.paymentProviderNotice}>
        <Feather name="alert-circle" size={19} color={COLORS.gold} />
        <Text style={styles.paymentProviderNoticeText}>
          O ERP não movimenta dinheiro. Faça o estorno ou acompanhe a contestação no provedor ou banco (InfinitePay, quando aplicável) e registre aqui o resultado.
        </Text>
      </View>
      <Text style={styles.paymentOperationStatus}>
        Pedido Nº {padSeq(pedido.seq)} · situação atual: {PAYMENT_STATUS_LABELS[status] || 'Não informada'}
      </Text>
      {operacoes.map((item) => {
        const selected = operacao === item;
        return (
          <Pressable
            key={item}
            onPress={() => setOperacao(item)}
            style={[styles.paymentOperationChoice, selected && styles.paymentOperationChoiceActive]}
          >
            <Feather name={selected ? 'check-circle' : 'circle'} size={18} color={selected ? COLORS.gold : COLORS.muted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentOperationChoiceTitle}>{PAYMENT_OPERATION_COPY[item].label}</Text>
              <Text style={styles.paymentOperationChoiceHint}>{PAYMENT_OPERATION_COPY[item].hint}</Text>
            </View>
          </Pressable>
        );
      })}
      {operacoes.length === 0 && (
        <Text style={styles.paymentOperationEmpty}>Este pagamento não possui operações pendentes.</Text>
      )}
      {operacoes.length > 0 && (
        <>
          <Field label="Motivo ou observação">
            <TInput value={motivo} onChangeText={setMotivo} placeholder="Ex.: cliente solicitou cancelamento" multiline />
          </Field>
          <Field label={exigeReferencia ? 'Protocolo, NSU ou referência' : 'Referência (opcional)'}>
            <TInput value={referencia} onChangeText={setReferencia} placeholder="Informe o comprovante do provedor" />
          </Field>
        </>
      )}
      <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm }}>
        <SecondaryButton label="Voltar" onPress={onCancel} />
        {operacoes.length > 0 && (
          <PrimaryButton label={saving ? 'Salvando…' : 'Registrar operação'} disabled={!valido || saving} onPress={submit} testID="payment-operation-save" />
        )}
      </View>
    </View>
  );
}

export function PedidoForm({
  perfumes,
  initial,
  onSave,
  onCancel,
  onDelete,
  onGenerateLabels,
  onPaymentOperation,
}: {
  perfumes: Perfume[];
  initial?: Pedido;
  onSave: (data: PedidoSaveData) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: (pedido: Pedido) => void | Promise<void>;
  onGenerateLabels?: (pedido: Pedido) => void | Promise<void>;
  onPaymentOperation?: (pedido: Pedido) => void;
}) {
  const [f, setF] = useState<PedidoFormState>(initial || {
    cliente: '', contato: '', status: 'pendente', observacoes: '', itens: [],
  });
  const pedidoRecebido = Boolean(initial?.id);
  const [valorPersonalizado, setValorPersonalizado] = useState(Boolean(initial?.id || initial?.ajusteManual));
  const [valorFinalInput, setValorFinalInput] = useState(
    initial?.total != null ? Number(initial.total).toFixed(2).replace('.', ',') : '',
  );
  const [searchingIdx, setSearchingIdx] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [editandoEndereco, setEditandoEndereco] = useState(false);
  const [recuperandoEndereco, setRecuperandoEndereco] = useState(false);
  const [mensagemEndereco, setMensagemEndereco] = useState('');
  const set = <K extends keyof PedidoFormState,>(k: K, v: PedidoFormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const enderecoVazio = (): PedidoEndereco => ({
    cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
  });
  const setEndereco = <K extends keyof PedidoEndereco,>(k: K, v: PedidoEndereco[K]) => setF((s) => ({
    ...s,
    endereco: { ...(s.endereco || enderecoVazio()), [k]: v },
  }));
  const pedidoRetirada = initial?.entrega?.tipo === 'retirada' || initial?.tipoEntrega === 'retirada';
  const recuperarEnderecoCliente = async () => {
    const contato = String(f.contato || '').trim();
    if (!contato) {
      setMensagemEndereco('Este pedido não possui contato para localizar o cadastro do cliente.');
      return;
    }
    setRecuperandoEndereco(true);
    setMensagemEndereco('');
    try {
      const cliente = await getClientePorContato(contato);
      if (!cliente.endereco) {
        setMensagemEndereco('O cadastro deste cliente não possui endereço salvo.');
        return;
      }
      setF((current) => ({ ...current, endereco: { ...enderecoVazio(), ...cliente.endereco } }));
      setEditandoEndereco(true);
      setMensagemEndereco('Endereço recuperado do cadastro do cliente. Confira e salve o pedido.');
    } catch {
      setMensagemEndereco('Não foi possível localizar um endereço salvo para este contato.');
    } finally {
      setRecuperandoEndereco(false);
    }
  };
  const addItem = () => {
    if (!perfumes[0]) return;
    setF((s) => ({ ...s, itens: [...s.itens, { perfumeId: perfumes[0].id, ml: perfumes[0].precos?.[0]?.ml || 30, quantidade: 1 }] }));
    setSearchingIdx(f.itens.length);
    setQ('');
  };
  const setItem = <K extends keyof PedidoItem,>(i: number, k: K, v: PedidoItem[K]) => setF((s) => ({
    ...s,
    itens: s.itens.map((it, idx) => idx === i ? { ...it, [k]: v } : it),
  }));
  const rmItem = (i: number) => setF((s) => ({ ...s, itens: s.itens.filter((_, idx) => idx !== i) }));
  const precoDo = (it: PedidoItem) => {
    if (it.precoUnitario != null && Number.isFinite(Number(it.precoUnitario))) {
      return Number(it.precoUnitario);
    }
    const p = perfumes.find((pf) => pf.id === it.perfumeId);
    return p?.precos.find((pr) => pr.ml === Number(it.ml))?.preco || 0;
  };
  const totalProdutos = f.itens.reduce((sum, item) => sum + precoDo(item) * item.quantidade, 0);
  const totalCalculado = Math.round((totalProdutos + Number(f.frete || 0)) * 100) / 100;
  const valorDigitado = Number(valorFinalInput.replace(',', '.'));
  const valorDigitadoValido = valorFinalInput.trim().length > 0
    && Number.isFinite(valorDigitado)
    && valorDigitado >= 0;
  const total = valorPersonalizado && valorDigitadoValido
    ? Math.round(valorDigitado * 100) / 100
    : totalCalculado;
  const ajusteManual = Math.round((total - totalCalculado) * 100) / 100;
  const pedidoParaSalvar = (status = f.status): PedidoSaveData => ({
    ...f,
    status,
    itens: f.itens.map((it) => {
      const precoUnitario = precoDo(it);
      return {
        ...it,
        precoUnitario,
        subtotal: Math.round(precoUnitario * it.quantidade * 100) / 100,
      };
    }),
    subtotalTabela: Math.round(totalProdutos * 100) / 100,
    ajusteManual,
    total,
  });
  const filtrados = perfumes.filter((p) => p.nome.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  return (
    <View>
      <Field label="Cliente"><TInput value={f.cliente} onChangeText={(v) => set('cliente', v)} testID="pedido-cliente" /></Field>
      <Field label="Contato (opcional)"><TInput value={f.contato} onChangeText={(v) => set('contato', v)} /></Field>
      <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.label, marginBottom: 6 }}>Itens do pedido</Text>
      {f.itens.map((it, i) => {
        const p = perfumes.find((pf) => pf.id === it.perfumeId);
        const editando = searchingIdx === i;
        return (
          <View key={i} style={{ padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={() => { if (!pedidoRecebido) { setSearchingIdx(editando ? null : i); setQ(''); } }}
                disabled={pedidoRecebido}
                style={{ flex: 1 }}
                testID={`item-select-${i}`}
              >
                <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption }}>Nº {padSeq(p?.seq || 0)}</Text>
                <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.body, fontWeight: '500' }} numberOfLines={1}>{p?.nome || 'Selecionar perfume'}</Text>
                {!pedidoRecebido && <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption }}>{editando ? 'toque para fechar' : 'toque para trocar'}</Text>}
              </Pressable>
              {!pedidoRecebido && <Pressable onPress={() => rmItem(i)} hitSlop={8} accessibilityLabel="Remover item do pedido"><Feather name="x" size={16} color={COLORS.rust} /></Pressable>}
            </View>
            {editando && (
              <View style={{ marginTop: SPACING.sm }}>
                <View style={styles.searchBox}>
                  <Feather name="search" size={14} color={COLORS.muted} />
                  <TextInput
                    value={q}
                    onChangeText={setQ}
                    placeholder="Buscar contratipo..."
                    placeholderTextColor={COLORS.muted + 'BB'}
                    style={styles.searchInput}
                    testID={`item-search-${i}`}
                    autoFocus
                  />
                </View>
                <ScrollView style={{ maxHeight: 200, borderRadius: 8, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }} nestedScrollEnabled>
                  {filtrados.length === 0 && <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.label, padding: 12 }}>Nenhum resultado.</Text>}
                  {filtrados.map((p2) => (
                    <Pressable
                      key={p2.id}
                      onPress={() => { setItem(i, 'perfumeId', p2.id); setItem(i, 'ml', p2.precos?.[0]?.ml || 30); setSearchingIdx(null); setQ(''); }}
                      style={{ paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: it.perfumeId === p2.id ? COLORS.surfaceRaised : 'transparent' }}
                      testID={`item-option-${p2.id}`}
                    >
                      <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.caption }}>Nº {padSeq(p2.seq)}</Text>
                      <Text style={{ color: COLORS.bone, fontSize: FONT_SIZES.bodySmall }} numberOfLines={1}>{p2.nome}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
            {pedidoRecebido ? (
              <View style={styles.orderChoiceRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderChoiceLabel}>TAMANHO ESCOLHIDO</Text>
                  <Text style={styles.orderChoiceValue}>
                    {it.ml}ml · {brl((p?.precos || []).find((pr) => pr.ml === Number(it.ml))?.preco || 0)}
                  </Text>
                </View>
                <View style={styles.orderQuantity}>
                  <Text style={styles.orderChoiceLabel}>QUANTIDADE</Text>
                  <Text style={styles.orderQuantityValue}>{it.quantidade}</Text>
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: SPACING.sm }}>
                {(p?.precos || []).map((pr) => (
                  <Pressable key={pr.ml} onPress={() => setItem(i, 'ml', pr.ml)} style={[styles.miniChip, Number(it.ml) === pr.ml && { backgroundColor: COLORS.gold, borderColor: COLORS.gold }]}>
                    <Text style={{ color: Number(it.ml) === pr.ml ? COLORS.ink : COLORS.muted, fontSize: FONT_SIZES.caption }}>{pr.ml}ml · {brl(pr.preco)}</Text>
                  </Pressable>
                ))}
                <TInput style={{ width: 60 }} keyboardType="numeric" value={String(it.quantidade)} onChangeText={(v) => setItem(i, 'quantidade', Number(v) || 1)} />
              </View>
            )}
          </View>
        );
      })}
      {!pedidoRecebido && <Pressable onPress={addItem} testID="pedido-add-item"><Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.label, marginBottom: SPACING.md }}>+ adicionar item</Text></Pressable>}
      {pedidoRecebido && (initial?.email || initial?.whatsapp || initial?.contato) && (
        <View style={styles.orderDeliveryCard}>
          <View style={styles.orderDeliveryIcon}>
            <Feather name="user" size={17} color={COLORS.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderDeliveryTitle}>Contato informado no checkout</Text>
            {!!(initial.whatsapp || initial.contato) && (
              <Text style={styles.orderDeliveryMeta}>WhatsApp: {initial.whatsapp || initial.contato}</Text>
            )}
            {!!initial.email && <Text style={styles.orderDeliveryMeta}>E-mail: {initial.email}</Text>}
          </View>
        </View>
      )}
      {pedidoRecebido && initial?.entrega && (
        <View style={styles.orderDeliveryCard}>
          <View style={styles.orderDeliveryIcon}>
            <Feather name="truck" size={17} color={COLORS.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderDeliveryTitle}>
              {initial.entrega.tipo === 'retirada'
                ? 'Retirada Combinada · Grátis'
                : (initial.entrega.nomeExibicao || 'Entrega')}
            </Text>
            <Text style={styles.orderDeliveryMeta}>
              {initial.entrega.tipo === 'retirada'
                ? 'O cliente combinará o horário pelo WhatsApp'
                : `${brl(initial.frete || initial.entrega.preco)} · prazo estimado de ${initial.entrega.prazoDias} ${
                    initial.entrega.prazoDias === 1 ? 'dia útil' : 'dias úteis'
                  }`}
            </Text>
            {initial.entrega.tipo !== 'retirada' && (
              <>
                <Text style={styles.orderDeliveryMeta}>
                  {initial.entrega.transportadora} · {initial.entrega.servico}
                </Text>
                <Text style={styles.orderDeliveryMeta}>
                  Transportadora {brl(initial.entrega.precoTransportadora || 0)}
                  {' · '}embalagem {brl(initial.entrega.taxaEmbalagem || 0)}
                  {Number(initial.entrega.valorAjuste || 0) > 0
                    ? ` · acréscimo ${initial.entrega.tipoAjuste === 'percentual'
                      ? `${initial.entrega.valorAjuste}%`
                      : brl(initial.entrega.valorAjuste || 0)}`
                    : ''}
                </Text>
              </>
            )}
          </View>
        </View>
      )}
      {pedidoRecebido && initial?.temSobEncomenda && (
        <View style={styles.orderDeliveryCard}>
          <View style={styles.orderDeliveryIcon}>
            <Feather name="clock" size={17} color={COLORS.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderDeliveryTitle}>Pedido com item sob encomenda</Text>
            <Text style={styles.orderDeliveryMeta}>
              Cliente confirmou prazo de até {initial.prazoEncomendaDias || 14} dias para produção e maturação, além do prazo da transportadora.
            </Text>
          </View>
        </View>
      )}
      {pedidoRecebido && initial?.pagamento && (
        <View style={styles.orderDeliveryCard}>
          <View style={styles.orderDeliveryIcon}>
            <Feather name="credit-card" size={17} color={COLORS.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderDeliveryTitle}>Pagamento</Text>
            <Text style={styles.orderDeliveryMeta}>
              {String(initial.pagamento.metodo || initial.formaPagamento || '').toUpperCase()}
              {' · '}{initial.pagamento.provedor || 'Confirmação manual'}
              {' · '}{PAYMENT_STATUS_LABELS[initial.pagamento.status] || initial.pagamento.status || 'Pendente'}
            </Text>
            {!!initial.pagamento.parcelas && initial.pagamento.parcelas > 1 && (
              <Text style={styles.orderDeliveryMeta}>{initial.pagamento.parcelas} parcelas</Text>
            )}
            {!!initial.pagamento.transactionNsu && (
              <Text style={styles.orderDeliveryMeta}>Transação: {initial.pagamento.transactionNsu}</Text>
            )}
            {!!initial.pagamento.historico?.length && (
              <Text style={styles.orderDeliveryMeta}>
                Última operação: {PAYMENT_OPERATION_COPY[
                  initial.pagamento.historico[initial.pagamento.historico.length - 1].operacao as PaymentOperation
                ]?.label || 'Pagamento confirmado'}
              </Text>
            )}
            {['pago', 'estorno_solicitado', 'contestado'].includes(initial.pagamento.status) && onPaymentOperation && (
              <Pressable
                onPress={() => onPaymentOperation(initial)}
                style={styles.paymentManageButton}
                testID="manage-payment"
              >
                <Feather name="shield" size={14} color={COLORS.gold} />
                <Text style={styles.paymentManageButtonText}>Gerenciar estorno ou contestação</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
      {pedidoRecebido && !pedidoRetirada && (
        <View style={{ marginBottom: SPACING.md }}>
          {f.endereco ? (
            <View style={styles.orderAddressCard}>
              <View style={styles.orderAddressIcon}>
                <Feather name="map-pin" size={17} color={COLORS.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.orderAddressEyebrow}>ENDEREÇO DE ENTREGA</Text>
                <Text style={styles.orderAddressTitle}>
                  {f.endereco.endereco}, {f.endereco.numero}
                  {f.endereco.complemento ? ` · ${f.endereco.complemento}` : ''}
                </Text>
                <Text style={styles.orderAddressMeta}>
                  {f.endereco.bairro} · {f.endereco.cidade}/{f.endereco.estado}
                </Text>
                <Text style={styles.orderAddressMeta}>
                  CEP {String(f.endereco.cep || '').replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2')}
                </Text>
                <Pressable onPress={() => setEditandoEndereco((value) => !value)} style={{ marginTop: 8 }} testID="pedido-editar-endereco">
                  <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.label }}>{editandoEndereco ? 'Fechar edição' : 'Editar endereço'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.orderAddressWarning}>
              <Feather name="alert-triangle" size={16} color={COLORS.rust} />
              <View style={{ flex: 1 }}>
                <Text style={styles.orderAddressWarningText}>Endereço de entrega não está gravado neste pedido.</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                  <Pressable onPress={recuperarEnderecoCliente} disabled={recuperandoEndereco} testID="pedido-recuperar-endereco">
                    <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.label }}>
                      {recuperandoEndereco ? 'Buscando…' : 'Buscar no cadastro do cliente'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => { setF((current) => ({ ...current, endereco: enderecoVazio() })); setEditandoEndereco(true); }} testID="pedido-adicionar-endereco">
                    <Text style={{ color: COLORS.gold, fontSize: FONT_SIZES.label }}>Adicionar manualmente</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}

          {!!mensagemEndereco && (
            <Text style={{ color: mensagemEndereco.startsWith('Endereço recuperado') ? COLORS.sage : COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 6 }}>
              {mensagemEndereco}
            </Text>
          )}

          {editandoEndereco && f.endereco && (
            <View style={{ marginTop: SPACING.sm, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, backgroundColor: COLORS.surface }}>
              <Field label="CEP"><TInput keyboardType="numeric" value={f.endereco.cep || ''} onChangeText={(v) => setEndereco('cep', v)} /></Field>
              <Field label="Endereço"><TInput value={f.endereco.endereco || ''} onChangeText={(v) => setEndereco('endereco', v)} /></Field>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><Field label="Número"><TInput value={f.endereco.numero || ''} onChangeText={(v) => setEndereco('numero', v)} /></Field></View>
                <View style={{ flex: 2 }}><Field label="Complemento"><TInput value={f.endereco.complemento || ''} onChangeText={(v) => setEndereco('complemento', v)} /></Field></View>
              </View>
              <Field label="Bairro"><TInput value={f.endereco.bairro || ''} onChangeText={(v) => setEndereco('bairro', v)} /></Field>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 3 }}><Field label="Cidade"><TInput value={f.endereco.cidade || ''} onChangeText={(v) => setEndereco('cidade', v)} /></Field></View>
                <View style={{ flex: 1 }}><Field label="UF"><TInput maxLength={2} autoCapitalize="characters" value={f.endereco.estado || ''} onChangeText={(v) => setEndereco('estado', v)} /></Field></View>
              </View>
              <Text style={{ color: COLORS.muted, fontSize: FONT_SIZES.caption }}>O endereço será gravado quando você tocar em “Salvar pedido”.</Text>
            </View>
          )}
        </View>
      )}
      <Field label="Status">
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {STATUS.filter((s) => statusPermitidosNoPainel(initial?.status).includes(s.id)).map((s) => (
            <Pressable key={s.id} onPress={() => set('status', s.id)} style={[styles.miniChip, f.status === s.id && { backgroundColor: s.color, borderColor: s.color }]}>
              <Text style={{ color: f.status === s.id ? COLORS.ink : COLORS.muted, fontSize: FONT_SIZES.caption }}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
      </Field>
      {pedidoRecebido && initial?.pagamento?.metodo === 'pix' && initial.pagamento.provedor !== 'infinitepay' && f.status === 'pendente' && (
        <Pressable
          onPress={() => onSave(pedidoParaSalvar('pagamento_confirmado'))}
          style={styles.confirmPaymentButton}
          testID="confirm-manual-payment"
        >
          <Feather name="check-circle" size={17} color={COLORS.ink} />
          <View style={{ flex: 1 }}>
            <Text style={styles.confirmPaymentTitle}>Confirmar pagamento recebido</Text>
            <Text style={styles.confirmPaymentHint}>Use após conferir o Pix no PicPay</Text>
          </View>
        </Pressable>
      )}
      <Field label="Observações"><TInput value={f.observacoes} onChangeText={(v) => set('observacoes', v)} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} /></Field>
      <View style={styles.manualValueCard}>
        <View style={styles.manualValueHeading}>
          <View style={{ flex: 1 }}>
            <Text style={styles.manualValueEyebrow}>VALOR DO PEDIDO</Text>
            <Text style={styles.manualValueTitle}>Valor final combinado</Text>
          </View>
          {valorPersonalizado && (
            <Pressable
              onPress={() => {
                setValorPersonalizado(false);
                setValorFinalInput('');
              }}
              hitSlop={8}
              testID="pedido-restaurar-valor"
            >
              <Text style={styles.manualValueReset}>Usar valor calculado</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.manualValueHint}>
          Informe aqui o total negociado com o cliente, inclusive quando houver desconto.
        </Text>
        <View style={styles.manualValueInputRow}>
          <Text style={styles.manualValueCurrency}>R$</Text>
          <TInput
            keyboardType="decimal-pad"
            value={valorPersonalizado ? valorFinalInput : totalCalculado.toFixed(2).replace('.', ',')}
            onChangeText={(value) => {
              setValorFinalInput(value);
              setValorPersonalizado(true);
            }}
            placeholder="0,00"
            style={styles.manualValueInput}
            testID="pedido-valor-final"
          />
        </View>
        <View style={styles.manualValueSummary}>
          <Text style={styles.manualValueSummaryLabel}>Valor calculado</Text>
          <Text style={styles.manualValueSummaryValue}>{brl(totalCalculado)}</Text>
        </View>
        {valorPersonalizado && valorDigitadoValido && Math.abs(ajusteManual) >= 0.01 && (
          <View style={styles.manualValueSummary}>
            <Text style={[styles.manualValueSummaryLabel, { color: ajusteManual < 0 ? COLORS.sage : COLORS.rust }]}>
              {ajusteManual < 0 ? 'Desconto aplicado' : 'Acréscimo aplicado'}
            </Text>
            <Text style={[styles.manualValueSummaryValue, { color: ajusteManual < 0 ? COLORS.sage : COLORS.rust }]}>
              {brl(Math.abs(ajusteManual))}
            </Text>
          </View>
        )}
        {valorPersonalizado && !valorDigitadoValido && (
          <Text style={styles.manualValueError}>Informe um valor final válido.</Text>
        )}
        <View style={styles.manualValueTotal}>
          <Text style={styles.manualValueTotalLabel}>Total final</Text>
          <Text style={styles.manualValueTotalAmount}>{brl(total)}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton
          label="Salvar pedido"
          onPress={() => f.cliente.trim() && f.itens.length > 0 && onSave(pedidoParaSalvar())}
          disabled={!f.cliente.trim() || f.itens.length === 0 || (valorPersonalizado && !valorDigitadoValido)}
          testID="pedido-save"
        />
      </View>
      {pedidoRecebido && (
        <Pressable
          onPress={() => initial && onGenerateLabels?.(initial)}
          style={styles.cancelAdminOrderButton}
          testID="pedido-gerar-etiquetas"
        >
          <Feather name="tag" size={16} color={COLORS.gold} />
          <Text style={[styles.cancelAdminOrderText, { color: COLORS.gold }]}>Gerar etiquetas de produção (PDF)</Text>
        </Pressable>
      )}
      {pedidoRecebido && initial?.status !== 'cancelado' && (
        <Pressable
          onPress={() => onSave(pedidoParaSalvar('cancelado'))}
          style={styles.cancelAdminOrderButton}
          testID="pedido-cancelar"
        >
          <Feather name="x-circle" size={16} color={COLORS.rust} />
          <Text style={styles.cancelAdminOrderText}>Cancelar pedido</Text>
        </Pressable>
      )}
      {pedidoRecebido && (initial?.status === 'cancelado' || initial?.status === 'entregue') && (
        <Pressable
          onPress={() => onDelete?.(initial)}
          style={styles.deleteAdminOrderButton}
          testID="pedido-arquivar"
        >
          <Feather name="archive" size={16} color={COLORS.inverse} />
          <View style={{ flex: 1 }}>
            <Text style={styles.deleteAdminOrderTitle}>Arquivar pedido</Text>
            <Text style={styles.deleteAdminOrderHint}>Retira do fluxo ativo e preserva todo o histórico.</Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  orderDeliveryCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, marginBottom: SPACING.sm },
  orderDeliveryIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  orderDeliveryTitle: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '600' },
  orderDeliveryMeta: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 3 },
  orderAddressCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.gold + '66', borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceRaised, marginBottom: SPACING.md },
  orderAddressIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: COLORS.surface, alignItems: 'center', justifyContent: 'center' },
  orderAddressEyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '700', letterSpacing: 0.8, marginBottom: 4 },
  orderAddressTitle: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '600', lineHeight: 20 },
  orderAddressMeta: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 3, lineHeight: 16 },
  orderAddressWarning: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: SPACING.md, borderWidth: 1, borderColor: COLORS.rust + '66', borderRadius: RADIUS.md, backgroundColor: COLORS.surface, marginBottom: SPACING.md },
  orderAddressWarningText: { flex: 1, color: COLORS.rust, fontSize: FONT_SIZES.caption, lineHeight: 16 },
  manualValueCard: { padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.gold + '88', backgroundColor: COLORS.surfaceRaised },
  manualValueHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 5 },
  manualValueEyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '700', letterSpacing: 1.2 },
  manualValueTitle: { color: COLORS.bone, fontSize: FONT_SIZES.subtitle, fontWeight: '700', marginTop: 2 },
  manualValueReset: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600', textDecorationLine: 'underline' },
  manualValueHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15, marginBottom: 10 },
  manualValueInputRow: { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, overflow: 'hidden' },
  manualValueCurrency: { color: COLORS.gold, fontSize: FONT_SIZES.bodyLarge, fontWeight: '700', paddingLeft: 12 },
  manualValueInput: { flex: 1, borderWidth: 0, backgroundColor: 'transparent', color: COLORS.bone, fontSize: FONT_SIZES.heading, fontWeight: '700' },
  manualValueSummary: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 8 },
  manualValueSummaryLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  manualValueSummaryValue: { color: COLORS.muted, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  manualValueError: { color: COLORS.rust, fontSize: FONT_SIZES.caption, marginTop: 7 },
  manualValueTotal: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, paddingTop: 9, marginTop: 9, borderTopWidth: 1, borderTopColor: COLORS.border },
  manualValueTotalLabel: { color: COLORS.bone, fontSize: FONT_SIZES.label, fontWeight: '600' },
  manualValueTotalAmount: { color: COLORS.gold, fontSize: FONT_SIZES.heading, fontWeight: '800' },
  orderChoiceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: SPACING.md, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.border },
  orderChoiceLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, letterSpacing: 0.8, marginBottom: 3 },
  orderChoiceValue: { color: COLORS.gold, fontSize: FONT_SIZES.bodyLarge, fontWeight: '600' },
  orderQuantity: { minWidth: 76, alignItems: 'center', paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: COLORS.border },
  orderQuantityValue: { color: COLORS.bone, fontSize: FONT_SIZES.subtitle, fontWeight: '600' },
  confirmPaymentButton: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.gold },
  confirmPaymentTitle: { color: COLORS.ink, fontSize: FONT_SIZES.bodySmall, fontWeight: '700' },
  confirmPaymentHint: { color: COLORS.ink, opacity: 0.72, fontSize: FONT_SIZES.caption, marginTop: 2 },
  paymentManageButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9, paddingHorizontal: 10, minHeight: 34, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceRaised },
  paymentManageButtonText: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '700' },
  paymentProviderNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.gold, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceRaised },
  paymentProviderNoticeText: { flex: 1, color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, lineHeight: 20 },
  paymentOperationStatus: { color: COLORS.muted, fontSize: FONT_SIZES.label, marginBottom: SPACING.sm },
  paymentOperationChoice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, marginBottom: SPACING.sm, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  paymentOperationChoiceActive: { borderColor: COLORS.gold, backgroundColor: COLORS.surfaceRaised },
  paymentOperationChoiceTitle: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall, fontWeight: '700' },
  paymentOperationChoiceHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  paymentOperationEmpty: { color: COLORS.muted, fontSize: FONT_SIZES.bodySmall, paddingVertical: SPACING.md },
  cancelAdminOrderButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.rust + '80' },
  cancelAdminOrderText: { color: COLORS.rust, fontSize: FONT_SIZES.label, fontWeight: '700' },
  deleteAdminOrderButton: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, padding: SPACING.md, marginTop: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.rust },
  deleteAdminOrderTitle: { color: COLORS.inverse, fontSize: FONT_SIZES.label, fontWeight: '700' },
  deleteAdminOrderHint: { color: COLORS.inverse, opacity: 0.78, fontSize: FONT_SIZES.caption, marginTop: 2 },
  miniChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, flexShrink: 0 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, marginBottom: SPACING.sm },
  searchInput: { flex: 1, color: COLORS.bone, paddingVertical: 10, fontSize: FONT_SIZES.body },
});
