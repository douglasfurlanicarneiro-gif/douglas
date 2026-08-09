import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Platform } from "react-native";

import { useAppFonts } from "@/src/hooks/use-app-fonts";


// Keep the native splash visible from cold start until icon fonts register.
// Required because @expo/vector-icons' componentDidMount fallback fires
// Font.loadAsync against a broken vendor path if any <Icon> mounts before
// the family is registered — which throws on Android Expo Go.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useAppFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  // If the CDN is unreachable we fall through on error rather than wedging
  // the app — icons will tofu, but the app still boots.
  // Na web o HTML já é renderizado estaticamente. O primeiro render do
  // navegador precisa manter a mesma árvore mesmo enquanto as fontes terminam
  // de registrar; retornar null aqui causava hydration mismatch (React #418)
  // e, ocasionalmente, uma tela vazia. O splash nativo continua aguardando.
  if (Platform.OS !== "web" && !loaded && !error) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}
