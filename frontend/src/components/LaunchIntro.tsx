import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../theme';

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

export function LaunchIntro({
  onFinish,
  storeName = 'L’Essence Furlani',
}: {
  onFinish: () => void;
  storeName?: string;
}) {
  const { width, height } = useWindowDimensions();
  const [logoReady, setLogoReady] = useState(false);
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.94)).current;
  const captionOpacity = useRef(new Animated.Value(0)).current;
  const captionTranslateY = useRef(new Animated.Value(8)).current;
  const shineOpacity = useRef(new Animated.Value(0)).current;
  const shineProgress = useRef(new Animated.Value(0)).current;

  const shineTranslateX = shineProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-Math.max(width * 0.75, 320), Math.max(width * 1.45, 560)],
  });

  const hideHtmlPreloader = () => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const preloader = document.getElementById('brand-preloader');
    if (!preloader) return;
    preloader.style.opacity = '0';
    setTimeout(() => preloader.remove(), 180);
  };

  const handleLogoLoad = () => {
    setLogoReady(true);
    hideHtmlPreloader();
  };

  const handleLogoError = () => {
    hideHtmlPreloader();
    onFinish();
  };

  useEffect(() => {
    if (!logoReady) return;

    const animation = Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 450,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 450,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(150),
          Animated.parallel([
            Animated.timing(captionOpacity, {
              toValue: 1,
              duration: 350,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(captionTranslateY, {
              toValue: 0,
              duration: 430,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),
      Animated.parallel([
        Animated.timing(shineProgress, {
          toValue: 1,
          duration: 650,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(shineOpacity, {
            toValue: 0.42,
            duration: 180,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(260),
          Animated.timing(shineOpacity, {
            toValue: 0,
            duration: 210,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.delay(60),
      Animated.parallel([
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 350,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1.025,
          duration: 350,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    animation.start(({ finished }) => {
      if (finished) onFinish();
    });

    return () => animation.stop();
  }, [captionOpacity, captionTranslateY, logoOpacity, logoReady, logoScale, onFinish, overlayOpacity, shineOpacity, shineProgress]);

  return (
    <Animated.View
      accessibilityLabel={`Apresentação ${storeName}`}
      style={[styles.overlay, { opacity: overlayOpacity }]}
      testID="launch-intro"
    >
      <View style={styles.stage}>
        <Animated.Image
          source={require('../../assets/images/splash-image-light.png')}
          resizeMode="contain"
          onLoad={handleLogoLoad}
          onError={handleLogoError}
          style={[
            styles.logo,
            {
              opacity: logoOpacity,
              transform: [{ scale: logoScale }],
            },
          ]}
        />
      </View>
      <AnimatedGradient
        colors={[
          'rgba(239, 211, 157, 0)',
          'rgba(255, 249, 240, 0.22)',
          'rgba(255, 239, 204, 0.78)',
          'rgba(199, 162, 92, 0.18)',
          'rgba(199, 162, 92, 0)',
        ]}
        locations={[0, 0.28, 0.5, 0.72, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        pointerEvents="none"
        style={[
          styles.pageShine,
          {
            width: Math.max(width * 0.42, 190),
            height: Math.max(height * 1.4, 720),
            opacity: shineOpacity,
            transform: [
              { translateX: shineTranslateX },
              { rotate: '9deg' },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.captionWrap,
          {
            opacity: captionOpacity,
            transform: [{ translateY: captionTranslateY }],
          },
        ]}
      >
        <LinearGradient
          colors={[COLORS.gold + '00', COLORS.gold + 'E6']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.captionLine}
        />
        <Text style={styles.caption} numberOfLines={1}>UMA EXPERIÊNCIA EM PERFUMARIA</Text>
        <LinearGradient
          colors={[COLORS.gold + 'E6', COLORS.gold + '00']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.captionLine}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    position: 'relative',
    top: '-10%',
    width: '88%',
    maxWidth: 520,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: {
    width: '100%',
    height: '100%',
    zIndex: 1,
  },
  pageShine: {
    position: 'absolute',
    zIndex: 2,
    top: '-20%',
    left: 0,
    borderRadius: 220,
  },
  captionWrap: {
    position: 'absolute',
    bottom: '13%',
    width: '92%',
    maxWidth: 500,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  captionLine: {
    flex: 1,
    maxWidth: 48,
    height: 1,
  },
  caption: {
    color: COLORS.gold,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
    letterSpacing: 2.2,
    textAlign: 'center',
    textShadowColor: 'rgba(239, 211, 157, 0.28)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 9,
  },
});
