import React from 'react';
import {
  Pressable as NativePressable,
  type PressableProps,
} from 'react-native';

/**
 * Pressable padrão do sistema.
 *
 * No navegador, o Pressable nativo sem papel é anunciado como elemento
 * genérico. Este componente mantém o mesmo comportamento visual e garante
 * semântica de botão e estado desabilitado por padrão. Papéis específicos
 * (checkbox, radio ou link) continuam podendo ser informados pelo chamador.
 */
export const AccessiblePressable = React.forwardRef<
  React.ElementRef<typeof NativePressable>,
  PressableProps
>(function AccessiblePressable({
  accessibilityRole = 'button',
  accessibilityState,
  disabled,
  ...props
}, ref) {
  return (
    <NativePressable
      ref={ref}
      {...props}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityState={{
        ...accessibilityState,
        disabled: accessibilityState?.disabled ?? !!disabled,
      }}
    />
  );
});
