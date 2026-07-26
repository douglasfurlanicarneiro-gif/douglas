import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { COLORS } from '../theme';

export function LaunchIntro({ onFinish }: { onFinish: () => void }) {
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.88)).current;
  const auraOpacity = useRef(new Animated.Value(0)).current;
  const auraScale = useRef(new Animated.Value(0.72)).current;
  const captionOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          speed: 8,
          bounciness: 2,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(auraOpacity, {
            toValue: 0.28,
            duration: 500,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(auraOpacity, {
            toValue: 0.08,
            duration: 650,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(auraScale, {
          toValue: 1.18,
          duration: 1150,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.sequence([
          Animated.timing(logoScale, {
            toValue: 1.035,
            duration: 380,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(logoScale, {
            toValue: 1,
            duration: 420,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(captionOpacity, {
          toValue: 1,
          duration: 650,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(250),
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 650,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1.06,
          duration: 650,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    animation.start(({ finished }) => {
      if (finished) onFinish();
    });

    return () => animation.stop();
  }, [auraOpacity, auraScale, captionOpacity, logoOpacity, logoScale, onFinish, overlayOpacity]);

  return (
    <Animated.View
      accessibilityLabel="Apresentação L’Essence Furlani"
      style={[styles.overlay, { opacity: overlayOpacity }]}
      testID="launch-intro"
    >
      <View style={styles.stage}>
        <Animated.View
          style={[
            styles.aura,
            {
              opacity: auraOpacity,
              transform: [{ scale: auraScale }],
            },
          ]}
        />
        <Animated.Image
          source={require('../../assets/images/icon.png')}
          resizeMode="contain"
          style={[
            styles.logo,
            {
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        />
      </View>
      <Animated.View style={[styles.captionWrap, { opacity: captionOpacity }]}>
        <View style={styles.captionLine} />
        <Text style={styles.caption}>UMA EXPERIÊNCIA EM PERFUMARIA</Text>
        <View style={styles.captionLine} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: '#080706',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    width: '74%',
    maxWidth: 360,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aura: {
    position: 'absolute',
    width: '76%',
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: COLORS.gold,
    shadowColor: COLORS.gold,
    shadowOpacity: 0.45,
    shadowRadius: 36,
    shadowOffset: { width: 0, height: 0 },
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  captionWrap: {
    position: 'absolute',
    bottom: '10%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  captionLine: {
    width: 28,
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.gold,
    opacity: 0.65,
  },
  caption: {
    color: COLORS.gold,
    fontSize: 8,
    letterSpacing: 2.1,
  },
});
