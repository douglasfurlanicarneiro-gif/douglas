import { useCallback, useMemo, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
} from 'react-native';

const RELEASE_DISTANCE = 64;

/**
 * React Native Web não aciona RefreshControl de forma confiável quando a
 * rolagem acontece dentro de FlatList/ScrollView. Este hook preserva o
 * RefreshControl nativo e acrescenta o gesto equivalente no PWA/navegador.
 */
export function useWebPullToRefresh(
  refreshing: boolean,
  onRefresh: () => void | Promise<void>,
) {
  const scrollOffset = useRef(0);
  const refreshingRef = useRef(refreshing);
  const onRefreshRef = useRef(onRefresh);
  const [pullDistance, setPullDistance] = useState(0);
  refreshingRef.current = refreshing;
  onRefreshRef.current = onRefresh;

  const panResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      Platform.OS === 'web'
      && !refreshingRef.current
      && scrollOffset.current <= 1
      && gesture.dy > 10
      && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.3
    ),
    onPanResponderMove: (_, gesture) => {
      setPullDistance(Math.min(92, Math.max(0, gesture.dy)));
    },
    onPanResponderRelease: (_, gesture) => {
      setPullDistance(0);
      if (gesture.dy >= RELEASE_DISTANCE && !refreshingRef.current) {
        void onRefreshRef.current();
      }
    },
    onPanResponderTerminate: () => setPullDistance(0),
  }), []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffset.current = Math.max(0, event.nativeEvent.contentOffset.y);
  }, []);

  return {
    onScroll,
    panHandlers: Platform.OS === 'web' ? panResponder.panHandlers : {},
    pullDistance,
    releaseDistance: RELEASE_DISTANCE,
  };
}
