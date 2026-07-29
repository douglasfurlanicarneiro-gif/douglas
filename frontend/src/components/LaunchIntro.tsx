import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../theme';

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

export function LaunchIntro({
  onFinish,
  logoUrl = '',
  storeName = 'L’Essence Furlani',
}: {
  onFinish: () => void;
  logoUrl?: string;
  storeName?: string;
}) {
  const [logoReady, setLogoReady] = useState(false);
  const [remoteLogoFailed, setRemoteLogoFailed] = useState(false);
  const overlayOpacity = useRef(new Animated.Value(1)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.94)).current;
  const captionOpacity = useRef(new Animated.Value(0)).current;
  const shineOpacity = useRef(new Animated.Value(0)).current;
  const shineProgress = useRef(new Animated.Value(0)).current;

  const shineTranslateX = shineProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-320, 520],
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
    if (logoUrl && !remoteLogoFailed) {
      setRemoteLogoFailed(true);
      return;
    }
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
          Animated.timing(captionOpacity, {
            toValue: 1,
            duration: 350,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
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
  }, [captionOpacity, logoOpacity, logoReady, logoScale, onFinish, overlayOpacity, shineOpacity, shineProgress]);

  return (
    <Animated.View
      accessibilityLabel={`Apresentação ${storeName}`}
      style={[styles.overlay, { opacity: overlayOpacity }]}
      testID="launch-intro"
    >
      <View style={styles.stage}>
        <Animated.Image
          source={logoUrl && !remoteLogoFailed
            ? { uri: logoUrl }
            : require('../../assets/images/launch-logo.jpg')}
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
        <AnimatedGradient
          colors={[
            'rgba(239, 211, 157, 0)',
            'rgba(255, 239, 204, 0.92)',
            'rgba(199, 162, 92, 0)',
          ]}
          locations={[0, 0.5, 1]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          pointerEvents="none"
          style={[
            styles.shine,
            {
              opacity: shineOpacity,
              transform: [
                { translateX: shineTranslateX },
                { rotate: '16deg' },
              ],
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
  shine: {
    position: 'absolute',
    zIndex: 2,
    top: '-18%',
    left: 0,
    width: '28%',
    height: '136%',
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
