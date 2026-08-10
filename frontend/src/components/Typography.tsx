import React from 'react';
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { FONTS, FONT_SIZES } from '../theme';

const numericWeight = (weight: TextStyle['fontWeight']) => {
  if (weight === 'bold') return 700;
  if (weight === 'normal' || weight == null) return 400;
  const parsed = Number(weight);
  return Number.isFinite(parsed) ? parsed : 400;
};

export function fontFamilyForStyle(style?: StyleProp<TextStyle>) {
  const flattened = StyleSheet.flatten(style) || {};
  const weight = numericWeight(flattened.fontWeight);
  const italic = flattened.fontStyle === 'italic';

  if (italic) return FONTS.italic;
  if (weight >= 700) return FONTS.bold;
  if (weight >= 600) return FONTS.semiBold;
  if (weight >= 500) return FONTS.medium;
  return FONTS.regular;
}

type AppTextFamily = 'sans' | 'editorial';

const normalizedFontStyle = (style?: StyleProp<TextStyle>, family: AppTextFamily = 'sans'): TextStyle => {
  const flattened = StyleSheet.flatten(style) || {};
  const requestedSize = typeof flattened.fontSize === 'number' ? flattened.fontSize : null;
  const fontSize = requestedSize == null
    ? undefined
    : Math.max(requestedSize, FONT_SIZES.caption);
  const lineHeight = typeof flattened.lineHeight === 'number' && fontSize != null
    ? Math.max(flattened.lineHeight, Math.ceil(fontSize * 1.25))
    : undefined;

  return {
    fontFamily: family === 'editorial' ? FONTS.editorial : (flattened.fontFamily || fontFamilyForStyle(style)),
    fontWeight: '400',
    fontStyle: 'normal',
    ...(fontSize == null ? {} : { fontSize }),
    ...(lineHeight == null ? {} : { lineHeight }),
  };
};

export function AppText({ family = 'sans', style, ...props }: TextProps & { family?: AppTextFamily }) {
  return <NativeText {...props} style={[style, normalizedFontStyle(style, family)]} />;
}

export const AppTextInput = React.forwardRef<
  React.ElementRef<typeof NativeTextInput>,
  TextInputProps
>(function AppTextInput({ style, ...props }, ref) {
  return (
    <NativeTextInput
      ref={ref}
      {...props}
      style={[style, normalizedFontStyle(style)]}
    />
  );
});
