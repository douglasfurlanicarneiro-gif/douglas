import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { COLORS, FONT_SIZES, RADIUS, SPACING, fmtDate, padSeq } from '../theme';
import type { EstoqueResumo, Movimento, Perfume } from '../types';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import { AppText as Text, AppTextInput as TextInput } from './Typography';
import { EmptyState } from './atoms';

const EMPTY_STOCK = { saldoAtualMl: 0, reservadoMl: 0, disponivelMl: 0 };

export function AdminStockView({
  perfumes,
  movimentos,
  estoqueResumo,
  search,
  onSearchChange,
  onCountStock,
}: {
  perfumes: Perfume[];
  movimentos: Movimento[];
  estoqueResumo: EstoqueResumo;
  search: string;
  onSearchChange: (value: string) => void;
  onCountStock: (perfume: Perfume) => void;
}) {
  const estoqueDe = (id: string) => estoqueResumo[id] || EMPTY_STOCK;
  const totais = useMemo(() => perfumes.reduce((accumulator, perfume) => {
    const resumo = estoqueResumo[perfume.id] || EMPTY_STOCK;
    accumulator.saldo += resumo.saldoAtualMl;
    accumulator.reservado += resumo.reservadoMl;
    accumulator.disponivel += resumo.disponivelMl;
    return accumulator;
  }, { saldo: 0, reservado: 0, disponivel: 0 }), [estoqueResumo, perfumes]);
  const filtrados = useMemo(() => {
    const termo = search.trim().toLocaleLowerCase('pt-BR');
    if (!termo) return perfumes;
    const termoSemZeros = termo.replace(/^0+/, '');
    return perfumes.filter((perfume) => (
      perfume.nome.toLocaleLowerCase('pt-BR').includes(termo)
      || String(perfume.seq).includes(termoSemZeros)
      || padSeq(perfume.seq).includes(termo)
    ));
  }, [perfumes, search]);

  return (
    <View style={styles.page}>
      <View style={styles.stockSummary}>
        <Text style={styles.sectionLabel}>RESUMO DO ESTOQUE</Text>
        <View style={styles.stockSummaryGrid}>
          <View style={styles.stockSummaryItem}>
            <Text style={styles.stockSummaryValue}>{totais.saldo.toLocaleString('pt-BR')}ml</Text>
            <Text style={styles.stockSummaryLabel}>Saldo físico</Text>
          </View>
          <View style={styles.stockSummaryItem}>
            <Text style={styles.stockSummaryValue}>{totais.reservado.toLocaleString('pt-BR')}ml</Text>
            <Text style={styles.stockSummaryLabel}>Reservado</Text>
          </View>
          <View style={styles.stockSummaryItem}>
            <Text style={[styles.stockSummaryValue, totais.disponivel < 0 && styles.negativeValue]}>
              {totais.disponivel.toLocaleString('pt-BR')}ml
            </Text>
            <Text style={styles.stockSummaryLabel}>Disponível</Text>
          </View>
        </View>
        <Text style={styles.stockSummaryHint}>
          Pedidos pendentes ou com pagamento confirmado ficam reservados. A baixa ocorre quando o pedido entra em preparação.
        </Text>
      </View>
      <View style={styles.searchBox}>
        <Feather name="search" size={16} color={COLORS.muted} />
        <TextInput
          value={search}
          onChangeText={onSearchChange}
          placeholder="Buscar perfume ou número"
          placeholderTextColor={COLORS.muted + 'BB'}
          style={styles.searchInput}
          testID="estoque-search"
        />
      </View>
      {perfumes.length === 0 && <EmptyState text="Cadastre um contratipo antes." />}
      {perfumes.length > 0 && filtrados.length === 0 && <EmptyState text="Nenhum perfume encontrado no estoque." />}
      {filtrados.map((perfume) => {
        const resumo = estoqueDe(perfume.id);
        const baixo = resumo.disponivelMl <= (perfume.estoqueMinimoMl || 0);
        const precisaRepor = Math.max(0, -resumo.disponivelMl);
        return (
          <View key={perfume.id} style={styles.rowCard} testID={`stock-card-${perfume.id}`}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.sequence}>Nº {padSeq(perfume.seq)}</Text>
                <Text style={styles.perfumeName}>{perfume.nome}</Text>
              </View>
              <View style={styles.stockAvailable}>
                <Text style={[styles.stockAvailableValue, { color: baixo ? COLORS.rust : COLORS.sage }]}>{resumo.disponivelMl}ml</Text>
                <Text style={styles.caption}>disponíveis</Text>
              </View>
            </View>
            <View style={styles.stockBreakdown}>
              <Text style={styles.stockBreakdownText}>Físico: {resumo.saldoAtualMl}ml</Text>
              <Text style={styles.stockBreakdownText}>Reservado: {resumo.reservadoMl}ml</Text>
            </View>
            {baixo && (
              <View style={styles.stockAlertRow}>
                <Feather name="alert-triangle" size={12} color={COLORS.rust} />
                <Text style={styles.stockAlertText}>
                  {precisaRepor > 0 ? `Repor ao menos ${precisaRepor}ml para atender as reservas.` : `Abaixo do alerta de ${perfume.estoqueMinimoMl || 0}ml.`}
                </Text>
              </View>
            )}
            <Pressable onPress={() => onCountStock(perfume)} style={styles.stockCountButton} testID={`stock-count-${perfume.id}`}>
              <Feather name="check-square" size={14} color={COLORS.gold} />
              <Text style={styles.stockCountButtonText}>Conferir quantidade física</Text>
            </Pressable>
          </View>
        );
      })}
      {perfumes.length > 0 && <Text style={[styles.sectionLabel, styles.movementsHeading]}>ÚLTIMOS LANÇAMENTOS</Text>}
      {perfumes.length > 0 && movimentos.length === 0 && <EmptyState text="Nenhum lançamento ainda." />}
      {[...movimentos].sort((first, second) => new Date(second.data).getTime() - new Date(first.data).getTime()).slice(0, 15).map((movimento) => {
        const perfume = perfumes.find((item) => item.id === movimento.perfumeId);
        const entrada = movimento.tipo === 'entrada';
        return (
          <View key={movimento.id} style={styles.movementRow} testID={`stock-movement-${movimento.id}`}>
            <Feather name={entrada ? 'arrow-up-circle' : 'arrow-down-circle'} size={18} color={entrada ? COLORS.sage : COLORS.rust} />
            <View style={styles.flex}>
              <Text style={styles.movementName}>{perfume?.nome || 'Perfume removido'}</Text>
              <Text style={styles.caption}>{movimento.motivo || (entrada ? 'Entrada' : 'Saída')} · {fmtDate(movimento.data)}</Text>
            </View>
            <Text style={[styles.movementQuantity, { color: entrada ? COLORS.sage : COLORS.rust }]}>{entrada ? '+' : '-'}{movimento.quantidadeMl}ml</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACING.lg },
  flex: { flex: 1 },
  sectionLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginBottom: SPACING.sm, letterSpacing: 1 },
  stockSummary: { padding: SPACING.md, backgroundColor: COLORS.surfaceRaised, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.md },
  stockSummaryGrid: { flexDirection: 'row', gap: 8 },
  stockSummaryItem: { flex: 1, padding: 10, borderRadius: RADIUS.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  stockSummaryValue: { color: COLORS.gold, fontSize: FONT_SIZES.bodyLarge, fontWeight: '600' },
  negativeValue: { color: COLORS.rust },
  stockSummaryLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, marginTop: 3 },
  stockSummaryHint: { color: COLORS.muted, fontSize: FONT_SIZES.caption, lineHeight: 15, marginTop: SPACING.sm },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, marginBottom: SPACING.sm },
  searchInput: { flex: 1, color: COLORS.bone, paddingVertical: 10, fontSize: FONT_SIZES.body },
  rowCard: { padding: SPACING.md, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.lg, marginBottom: SPACING.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sequence: { color: COLORS.gold, fontSize: FONT_SIZES.caption },
  perfumeName: { color: COLORS.bone, fontSize: FONT_SIZES.body, fontWeight: '500' },
  stockAvailable: { alignItems: 'flex-end' },
  stockAvailableValue: { fontSize: FONT_SIZES.bodyLarge },
  caption: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  stockBreakdown: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.border },
  stockBreakdownText: { color: COLORS.muted, fontSize: FONT_SIZES.caption },
  stockAlertRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7 },
  stockAlertText: { color: COLORS.rust, fontSize: FONT_SIZES.caption, flex: 1 },
  stockCountButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 9, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.gold + '66', backgroundColor: COLORS.surfaceRaised },
  stockCountButtonText: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  movementsHeading: { marginTop: SPACING.lg },
  movementRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  movementName: { color: COLORS.bone, fontSize: FONT_SIZES.bodySmall },
  movementQuantity: { fontSize: FONT_SIZES.bodySmall },
});
