import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import type { Perfume } from '../types';
import { COLORS, FONT_SIZES, RADIUS, SPACING } from '../theme';
import { AccessiblePressable as Pressable } from './AccessiblePressable';
import { AppText as Text } from './Typography';
import { SecondaryButton, TInput } from './atoms';

export function AdminAvailabilityManager({
  perfumes,
  onSave,
  onCancel,
}: {
  perfumes: Perfume[];
  onSave: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(
    () => new Set(perfumes.filter((perfume) => perfume.prontaEntrega).map((perfume) => perfume.id)),
  );

  const ordered = useMemo(
    () => [...perfumes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })),
    [perfumes],
  );
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR');
    if (!term) return ordered;
    return ordered.filter((perfume) => perfume.nome.toLocaleLowerCase('pt-BR').includes(term));
  }, [ordered, query]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectVisible = () => {
    setSelected((current) => new Set([...current, ...filtered.map((perfume) => perfume.id)]));
  };

  const clearVisible = () => {
    const visibleIds = new Set(filtered.map((perfume) => perfume.id));
    setSelected((current) => new Set([...current].filter((id) => !visibleIds.has(id))));
  };

  const save = () => {
    const ids = perfumes
      .filter((perfume) => selected.has(perfume.id))
      .map((perfume) => perfume.id);
    onSave(ids);
  };

  return (
    <View>
      <View style={styles.summary}>
        <View>
          <Text style={styles.count}>{selected.size}</Text>
          <Text style={styles.countLabel}>Pronta entrega</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View>
          <Text style={styles.count}>{Math.max(0, perfumes.length - selected.size)}</Text>
          <Text style={styles.countLabel}>Sob encomenda</Text>
        </View>
      </View>

      <TInput
        value={query}
        onChangeText={setQuery}
        placeholder="Buscar perfume…"
        testID="availability-search"
      />

      <View style={styles.tools}>
        <Pressable onPress={selectVisible} style={styles.toolButton}>
          <Text style={styles.toolText}>Marcar exibidos</Text>
        </Pressable>
        <Pressable onPress={clearVisible} style={styles.toolButton}>
          <Text style={styles.toolText}>Desmarcar exibidos</Text>
        </Pressable>
      </View>

      <View style={styles.list}>
        {filtered.map((perfume) => {
          const checked = selected.has(perfume.id);
          return (
            <Pressable
              key={perfume.id}
              onPress={() => toggle(perfume.id)}
              style={({ pressed }) => [
                styles.row,
                checked && styles.rowChecked,
                pressed && styles.pressed,
              ]}
              testID={`availability-${perfume.id}`}
            >
              <View style={[styles.check, checked && styles.checkActive]}>
                {checked && <Feather name="check" size={13} color={COLORS.ink} />}
              </View>
              <Text style={styles.name}>{perfume.nome}</Text>
              <Text style={[styles.state, checked && styles.stateReady]}>
                {checked ? 'Pronta' : 'Encomenda'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.footer}>
        <SecondaryButton label="Cancelar" onPress={onCancel} />
        <Pressable
          onPress={save}
          disabled={selected.size === 0}
          style={[styles.saveButton, selected.size === 0 && styles.saveButtonDisabled]}
          testID="availability-save"
        >
          <Text style={styles.saveText}>Revisar e salvar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.gold + '55',
    backgroundColor: COLORS.surface,
  },
  summaryDivider: { width: 1, height: 42, backgroundColor: COLORS.border },
  count: { color: COLORS.bone, fontSize: FONT_SIZES.display, fontWeight: '700', textAlign: 'center' },
  countLabel: { color: COLORS.muted, fontSize: FONT_SIZES.caption, textAlign: 'center', marginTop: 2 },
  tools: { flexDirection: 'row', gap: 7, marginVertical: SPACING.sm },
  toolButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 34,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  toolText: { color: COLORS.gold, fontSize: FONT_SIZES.caption, fontWeight: '600' },
  list: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.md, overflow: 'hidden' },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  rowChecked: { backgroundColor: COLORS.gold + '12' },
  pressed: { opacity: 0.8 },
  check: {
    width: 22,
    height: 22,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  checkActive: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
  name: { flex: 1, color: COLORS.bone, fontSize: FONT_SIZES.caption },
  state: { color: COLORS.muted, fontSize: FONT_SIZES.caption, textTransform: 'uppercase' },
  stateReady: { color: COLORS.sage },
  footer: { flexDirection: 'row', gap: 8, marginTop: SPACING.md },
  saveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    backgroundColor: COLORS.gold,
  },
  saveButtonDisabled: { opacity: 0.45 },
  saveText: { color: COLORS.ink, fontWeight: '700' },
});
