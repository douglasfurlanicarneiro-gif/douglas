import React from 'react';
import { View, StyleSheet } from 'react-native';
import { COLORS } from '../theme';

export function PyramidBar() {
  return (
    <View style={styles.bar} testID="pyramid-bar">
      <View style={[styles.slice, { backgroundColor: COLORS.topNote }]} />
      <View style={[styles.slice, { backgroundColor: COLORS.heartNote }]} />
      <View style={[styles.slice, { backgroundColor: COLORS.baseNote }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { width: 6, flexDirection: 'column' },
  slice: { flex: 1 },
});
