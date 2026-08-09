// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
    rules: {
      // React Native Animated and PanResponder intentionally keep mutable
      // animation handles in refs. These patterns are not React Compiler code.
      'react-hooks/refs': 'off',
      // Initial async hydration/loading state is coordinated in effects.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
