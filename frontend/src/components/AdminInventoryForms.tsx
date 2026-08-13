import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';

import type { EstoqueResumo, Movimento, Perfume, PriceOption } from '../types';
import {
  COLORS,
  CONCENTRACOES,
  FAMILIAS,
  FONT_SIZES,
  familiasDoPerfume,
  nomeConcentracao,
  OCASIOES,
  padSeq,
  RADIUS,
  SPACING,
} from '../theme';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import { AppText as Text } from './Typography';
import { Field, PrimaryButton, SecondaryButton, TInput } from './atoms';

export type PerfumeFormState = Omit<Perfume, 'id' | 'seq' | 'inspiracao'> & {
  id?: string;
  seq?: number;
  inspiracao?: string;
};
export type PerfumeSaveData = PerfumeFormState & { inspiracao: string };
export type MovimentoDraft = Omit<Movimento, 'id' | 'origem' | 'data'>;

const chipStyle = (selected: boolean) => [styles.miniChip, selected && styles.miniChipActive];
const chipTextStyle = (selected: boolean) => [styles.chipText, selected && styles.chipTextActive];

export function PerfumeForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Perfume;
  onSave: (data: PerfumeSaveData) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<PerfumeFormState>(initial ? {
    ...initial,
    familias: familiasDoPerfume(initial),
    concentracao: nomeConcentracao(initial.concentracao),
  } : {
    nome: '',
    imagemUrl: '',
    ocasioes: [],
    familia: FAMILIAS[0],
    familias: [FAMILIAS[0]],
    concentracao: CONCENTRACOES[0],
    notasSaida: '',
    notasCoracao: '',
    notasFundo: '',
    precos: [{ ml: 30, preco: 0 }],
    estoqueMinimoMl: 100,
    publicavel: false,
    prontaEntrega: false,
    custoEssenciaPorMl: 0,
    concentracaoPercentual: 25,
    fornecedorId: '',
    fornecedorCodigo: '',
  });

  const set = <K extends keyof PerfumeFormState>(key: K, value: PerfumeFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const toggleOccasion = (value: string) => setForm((current) => {
    const occasions = Array.isArray(current.ocasioes) ? current.ocasioes : [];
    return {
      ...current,
      ocasioes: occasions.includes(value)
        ? occasions.filter((item) => item !== value)
        : [...occasions, value],
    };
  });
  const toggleFamily = (value: string) => setForm((current) => {
    const existing = familiasDoPerfume(current);
    const families = existing.includes(value)
      ? existing.filter((item) => item !== value)
      : [...existing, value];
    return { ...current, familias: families, familia: families[0] || '' };
  });
  const setPrice = <K extends keyof PriceOption>(index: number, key: K, value: PriceOption[K]) => {
    setForm((current) => ({
      ...current,
      precos: current.precos.map((price, itemIndex) => (
        itemIndex === index ? { ...price, [key]: value } : price
      )),
    }));
  };
  const families = familiasDoPerfume(form);
  const valid = Boolean(
    form.nome.trim()
    && families.length
    && (!form.publicavel || form.precos.some((price) => price.preco > 0)),
  );

  return (
    <View>
      <Field label="Nome do contratipo">
        <TInput value={form.nome} onChangeText={(value) => set('nome', value)} placeholder="Ex: Âmbar Noturno" testID="perfume-nome" />
      </Field>
      <Field label="Foto do perfume (link da imagem)">
        <TInput
          value={form.imagemUrl || ''}
          onChangeText={(value) => set('imagemUrl', value)}
          placeholder="https://.../foto-do-perfume.jpg"
          autoCapitalize="none"
          keyboardType="url"
          testID="perfume-imagem"
        />
      </Field>
      {!!form.imagemUrl && (
        <View style={styles.imagePreview}>
          <Image source={{ uri: form.imagemUrl }} style={styles.imagePreviewPhoto} contentFit="contain" transition={180} />
          <Text style={styles.imagePreviewText}>Prévia da foto</Text>
        </View>
      )}

      <Field label="Clima & Ocasião">
        <View style={styles.chipGroup}>
          {OCASIOES.map((item) => {
            const selected = (form.ocasioes || []).includes(item);
            return (
              <Pressable key={item} onPress={() => toggleOccasion(item)} style={chipStyle(selected)}>
                <Text style={chipTextStyle(selected)}>{item}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>
      <Field label="Família Olfativa">
        <View style={styles.chipGroup}>
          {FAMILIAS.map((family) => {
            const selected = families.includes(family);
            return (
              <Pressable key={family} onPress={() => toggleFamily(family)} style={chipStyle(selected)}>
                <Text style={chipTextStyle(selected)}>{family}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>
      <Field label="Concentração">
        <View style={styles.chipGroup}>
          {CONCENTRACOES.map((concentration) => {
            const selected = form.concentracao === concentration;
            return (
              <Pressable key={concentration} onPress={() => set('concentracao', concentration)} style={chipStyle(selected)}>
                <Text style={chipTextStyle(selected)}>{concentration}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>

      <View style={styles.notesCard}>
        <Text style={styles.cardEyebrow}>PIRÂMIDE OLFATIVA</Text>
        {([
          { color: COLORS.topNote, label: 'Saída', key: 'notasSaida' },
          { color: COLORS.heartNote, label: 'Coração', key: 'notasCoracao' },
          { color: COLORS.baseNote, label: 'Fundo', key: 'notasFundo' },
        ] as const).map((row) => (
          <View key={row.key} style={styles.noteRow}>
            <View style={[styles.noteDot, { backgroundColor: row.color }]} />
            <TInput
              style={styles.flexOne}
              value={form[row.key]}
              onChangeText={(value) => set(row.key, value)}
              placeholder={`Notas de ${row.label.toLowerCase()}`}
            />
          </View>
        ))}
      </View>

      <Text style={styles.sectionLabel}>Tamanhos e preços</Text>
      {form.precos.map((price, index) => (
        <View key={`${price.ml}-${index}`} style={styles.priceRow}>
          <TInput style={styles.mlInput} keyboardType="numeric" value={String(price.ml)} onChangeText={(value) => setPrice(index, 'ml', Number(value) || 0)} placeholder="ml" />
          <Text style={styles.unitText}>ml</Text>
          <TInput style={styles.flexOne} keyboardType="decimal-pad" value={String(price.preco)} onChangeText={(value) => setPrice(index, 'preco', Number(value) || 0)} placeholder="Preço" />
          {form.precos.length > 1 && (
            <Pressable
              onPress={() => setForm((current) => ({ ...current, precos: current.precos.filter((_, itemIndex) => itemIndex !== index) }))}
              hitSlop={8}
              accessibilityLabel={`Remover tamanho ${price.ml || ''} mililitros`}
            >
              <Feather name="x" size={16} color={COLORS.rust} />
            </Pressable>
          )}
        </View>
      ))}
      <Pressable onPress={() => setForm((current) => ({ ...current, precos: [...current.precos, { ml: 10, preco: 0 }] }))}>
        <Text style={styles.addSize}>+ adicionar tamanho</Text>
      </Pressable>

      <Field label="Estoque mínimo de alerta (ml)">
        <TInput keyboardType="numeric" value={String(form.estoqueMinimoMl)} onChangeText={(value) => set('estoqueMinimoMl', Number(value) || 0)} />
      </Field>
      <View style={styles.productionCard}>
        <Text style={styles.productionTitle}>CUSTO & PRODUÇÃO · ADMINISTRATIVO</Text>
        <Field label="Custo da essência por ml (R$)">
          <TInput
            keyboardType="decimal-pad"
            value={String(form.custoEssenciaPorMl ?? 0).replace('.', ',')}
            onChangeText={(value) => set('custoEssenciaPorMl', Number(value.replace(',', '.')) || 0)}
            placeholder="0,00"
          />
        </Field>
        <Field label="Concentração real da fórmula (%)">
          <TInput
            keyboardType="decimal-pad"
            value={String(form.concentracaoPercentual ?? 25).replace('.', ',')}
            onChangeText={(value) => set('concentracaoPercentual', Math.min(100, Math.max(0, Number(value.replace(',', '.')) || 0)))}
            placeholder="25"
          />
        </Field>
        <Field label="Código no fornecedor">
          <TInput
            value={form.fornecedorCodigo || ''}
            onChangeText={(value) => set('fornecedorCodigo', value.trim())}
            placeholder="Ex: 400056"
            autoCapitalize="none"
          />
        </Field>
        <Text style={styles.adminHint}>Esses dados não aparecem na vitrine. Eles alimentam lucro, margem e ordens de produção.</Text>
      </View>

      <ToggleRow
        title="Pronta entrega"
        hint="Desative para mostrar este perfume como Sob encomenda."
        active={Boolean(form.prontaEntrega)}
        onPress={() => set('prontaEntrega', !form.prontaEntrega)}
      />
      <ToggleRow
        title="Mostrar na vitrine pública"
        active={Boolean(form.publicavel)}
        onPress={() => set('publicavel', !form.publicavel)}
      />
      <View style={styles.actions}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton
          label="Salvar"
          onPress={() => valid && onSave({ ...form, inspiracao: '', familia: families[0], familias: families })}
          disabled={!valid}
          testID="perfume-save"
        />
      </View>
    </View>
  );
}

function ToggleRow({ title, hint, active, onPress }: { title: string; hint?: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.toggleRow}>
      <View style={styles.flexOne}>
        <Text style={styles.toggleTitle}>{title}</Text>
        {!!hint && <Text style={styles.toggleHint}>{hint}</Text>}
      </View>
      <View style={[styles.toggleTrack, active && styles.toggleTrackActive, { alignItems: active ? 'flex-end' : 'flex-start' }]}>
        <View style={styles.toggleThumb} />
      </View>
    </Pressable>
  );
}

export function MovimentoForm({ perfumes, onSave, onCancel }: {
  perfumes: Perfume[];
  onSave: (data: MovimentoDraft) => void;
  onCancel: () => void;
}) {
  const options = [
    { id: 'entrada', label: 'Entrada', tipo: 'entrada', motivo: 'Entrada de estoque' },
    { id: 'perda', label: 'Perda', tipo: 'saida', motivo: 'Perda ou vazamento' },
    { id: 'ajuste-positivo', label: 'Ajuste +', tipo: 'entrada', motivo: 'Ajuste positivo de inventário' },
    { id: 'ajuste-negativo', label: 'Ajuste −', tipo: 'saida', motivo: 'Ajuste negativo de inventário' },
    { id: 'devolucao', label: 'Devolução', tipo: 'entrada', motivo: 'Devolução ao estoque' },
  ] as const;
  const [form, setForm] = useState<MovimentoDraft>({
    perfumeId: perfumes[0]?.id || '',
    tipo: 'entrada',
    quantidadeMl: 100,
    motivo: 'Entrada de estoque',
    categoria: 'entrada',
  });
  return (
    <View>
      <Field label="Perfume">
        <ScrollView style={styles.perfumeList}>
          {perfumes.map((perfume) => (
            <Pressable key={perfume.id} onPress={() => setForm({ ...form, perfumeId: perfume.id })} style={styles.perfumeRow}>
              <Text style={[styles.perfumeName, form.perfumeId === perfume.id && styles.selectedText]}>Nº{padSeq(perfume.seq)} · {perfume.nome}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Field>
      <Field label="Movimentação">
        <View style={styles.chipGroup}>
          {options.map((option) => {
            const selected = form.categoria === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => setForm({ ...form, tipo: option.tipo, motivo: option.motivo, categoria: option.id })}
                style={chipStyle(selected)}
              >
                <Text style={chipTextStyle(selected)}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Field>
      <Field label="Quantidade (ml)">
        <TInput keyboardType="numeric" value={String(form.quantidadeMl)} onChangeText={(value) => setForm({ ...form, quantidadeMl: Number(value) || 0 })} testID="mov-qtd" />
      </Field>
      <Field label="Observação">
        <TInput value={form.motivo} onChangeText={(value) => setForm({ ...form, motivo: value })} placeholder="Descreva o motivo desta movimentação" />
      </Field>
      <View style={styles.actionsWithTopMargin}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton label="Lançar" onPress={() => form.perfumeId && form.quantidadeMl > 0 && onSave(form)} testID="mov-save" />
      </View>
    </View>
  );
}

export function StockCountForm({ perfumes, resumo, initial, onSave, onCancel }: {
  perfumes: Perfume[];
  resumo: EstoqueResumo;
  initial?: Perfume;
  onSave: (data: { perfumeId: string; quantidadeFisicaMl: number; saldoEsperadoMl: number; motivo: string }) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState(initial?.nome || '');
  const [perfumeId, setPerfumeId] = useState(initial?.id || perfumes[0]?.id || '');
  const selected = perfumes.find((perfume) => perfume.id === perfumeId);
  const current = resumo[perfumeId] || { saldoAtualMl: 0, reservadoMl: 0, disponivelMl: 0 };
  const [quantity, setQuantity] = useState(String(current.saldoAtualMl));
  const [reason, setReason] = useState('Conferência física');
  const found = Number(quantity);
  const valid = Number.isInteger(found) && found >= 0;
  const difference = valid ? found - current.saldoAtualMl : 0;
  const availableAfter = valid ? found - current.reservadoMl : current.disponivelMl;
  const filtered = perfumes.filter((perfume) => perfume.nome.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 20);

  const selectPerfume = (perfume: Perfume) => {
    const item = resumo[perfume.id] || { saldoAtualMl: 0, reservadoMl: 0, disponivelMl: 0 };
    setPerfumeId(perfume.id);
    setSearch(perfume.nome);
    setQuantity(String(item.saldoAtualMl));
  };

  return (
    <View>
      <Field label="Buscar essência">
        <TInput value={search} onChangeText={setSearch} placeholder="Digite o nome do perfume" testID="stock-count-search" />
      </Field>
      {(!selected || search.trim().toLowerCase() !== selected.nome.toLowerCase()) && (
        <ScrollView style={styles.stockCountResults} keyboardShouldPersistTaps="handled">
          {filtered.map((perfume) => (
            <Pressable key={perfume.id} onPress={() => selectPerfume(perfume)} style={styles.stockCountResultRow}>
              <Text style={styles.stockCountResultName}>Nº{padSeq(perfume.seq)} · {perfume.nome}</Text>
              <Text style={styles.stockCountResultBalance}>{resumo[perfume.id]?.saldoAtualMl || 0}ml</Text>
            </Pressable>
          ))}
          {filtered.length === 0 && <Text style={styles.stockCountEmpty}>Nenhuma essência encontrada.</Text>}
        </ScrollView>
      )}
      {!!selected && (
        <>
          <View style={styles.stockCountSelected}>
            <Text style={styles.stockCountEyebrow}>ESSÊNCIA SELECIONADA</Text>
            <Text style={styles.stockCountTitle}>{selected.nome}</Text>
            <View style={styles.stockCountSummaryRow}>
              <StockValue value={`${current.saldoAtualMl}ml`} label="Físico registrado" />
              <StockValue value={`${current.reservadoMl}ml`} label="Reservado" />
              <StockValue value={`${current.disponivelMl}ml`} label="Disponível" />
            </View>
          </View>
          <Field label="Quantidade física encontrada (ml)">
            <TInput keyboardType="numeric" value={quantity} onChangeText={setQuantity} placeholder="0" testID="stock-count-quantity" />
          </Field>
          <View style={[styles.stockCountPreview, availableAfter < 0 && styles.stockCountPreviewDanger]}>
            <Feather name={difference >= 0 ? 'arrow-up-circle' : 'arrow-down-circle'} size={19} color={difference === 0 ? COLORS.muted : difference > 0 ? COLORS.sage : COLORS.rust} />
            <View style={styles.flexOne}>
              <Text style={styles.stockCountPreviewTitle}>
                {!valid ? 'Informe uma quantidade válida' : difference === 0 ? 'Nenhum ajuste necessário' : `${difference > 0 ? 'Entrada' : 'Saída'} automática de ${Math.abs(difference)}ml`}
              </Text>
              <Text style={[styles.stockCountPreviewHint, availableAfter < 0 && styles.dangerText]}>
                Após a conferência: {availableAfter}ml disponíveis{availableAfter < 0 ? ' · saldo insuficiente para as reservas' : ''}
              </Text>
            </View>
          </View>
          <Field label="Motivo ou observação">
            <TInput value={reason} onChangeText={setReason} placeholder="Ex.: contagem mensal" />
          </Field>
        </>
      )}
      <View style={styles.actionsWithTopMargin}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <PrimaryButton
          label="Confirmar contagem"
          disabled={!selected || !valid}
          onPress={() => selected && valid && onSave({ perfumeId: selected.id, quantidadeFisicaMl: found, saldoEsperadoMl: current.saldoAtualMl, motivo: reason })}
          testID="stock-count-save"
        />
      </View>
    </View>
  );
}

function StockValue({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stockCountSummaryItem}>
      <Text style={styles.stockCountValue}>{value}</Text>
      <Text style={styles.stockCountLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flexOne: { flex: 1 },
  chipGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  miniChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, flexShrink: 0 },
  miniChipActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  chipText: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  chipTextActive: { color: COLORS.ink },
  imagePreview: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginTop: -6, marginBottom: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  imagePreviewPhoto: { width: 64, height: 64, borderRadius: 8, backgroundColor: COLORS.surface },
  imagePreviewText: { color: COLORS.muted, fontSize: FONT_SIZES.label },
  notesCard: { padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  cardEyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.caption, marginBottom: 8 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  noteDot: { width: 10, height: 10, borderRadius: 5 },
  sectionLabel: { color: COLORS.muted, fontSize: FONT_SIZES.label, marginBottom: 6 },
  priceRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 },
  mlInput: { width: 70 },
  unitText: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  addSize: { color: COLORS.gold, fontSize: FONT_SIZES.label, marginBottom: SPACING.md },
  productionCard: { padding: SPACING.md, backgroundColor: COLORS.surfaceRaised, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, marginBottom: SPACING.md },
  productionTitle: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '700', marginBottom: 8 },
  adminHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: SPACING.md, paddingVertical: 6, marginBottom: SPACING.md },
  toggleTitle: { color: COLORS.bone, fontSize: FONT_SIZES.body },
  toggleHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 2 },
  toggleTrack: { width: 44, height: 24, borderRadius: 12, backgroundColor: COLORS.border, justifyContent: 'center', paddingHorizontal: 2 },
  toggleTrackActive: { backgroundColor: COLORS.gold },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.bone },
  actions: { flexDirection: 'row', gap: 8 },
  actionsWithTopMargin: { flexDirection: 'row', gap: 8, marginTop: SPACING.sm },
  perfumeList: { maxHeight: 200 },
  perfumeRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  perfumeName: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall },
  selectedText: { color: COLORS.gold },
  stockCountResults: { maxHeight: 210, marginTop: -8, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  stockCountResultRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  stockCountResultName: { flex: 1, color: COLORS.bone, fontSize: FONT_SIZES.caption },
  stockCountResultBalance: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  stockCountEmpty: { color: COLORS.muted, fontSize: FONT_SIZES.caption, padding: SPACING.md, textAlign: 'center' },
  stockCountSelected: { padding: SPACING.md, marginBottom: SPACING.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: COLORS.gold + '66', backgroundColor: COLORS.surfaceRaised },
  stockCountEyebrow: { color: COLORS.gold, fontSize: FONT_SIZES.caption, letterSpacing: 1.1 },
  stockCountTitle: { color: COLORS.bone, fontSize: FONT_SIZES.subtitle, fontWeight: '700', marginTop: 3, marginBottom: 10 },
  stockCountSummaryRow: { flexDirection: 'row', gap: 7 },
  stockCountSummaryItem: { flex: 1, padding: 8, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  stockCountValue: { color: COLORS.gold, fontSize: FONT_SIZES.bodySmall, fontWeight: '700' },
  stockCountLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 11, marginTop: 2 },
  stockCountPreview: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 11, marginTop: -6, marginBottom: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  stockCountPreviewDanger: { borderColor: COLORS.rust + '88' },
  stockCountPreviewTitle: { color: COLORS.bone, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  stockCountPreviewHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 13, marginTop: 2 },
  dangerText: { color: COLORS.rust },
});
