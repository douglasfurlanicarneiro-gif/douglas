import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { Platform } from "react-native";

import { useAppFonts } from "@/src/hooks/use-app-fonts";
import { AppErrorBoundary } from "@/src/components/AppErrorBoundary";
import { reportFrontendError } from "@/src/api";


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

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const reportPath = () => window.location.pathname;
    const onError = (event: ErrorEvent) => {
      if (!event.message) return;
      void reportFrontendError({
        tipo: "window_error",
        mensagem: event.message,
        componentStack: event.error instanceof Error ? event.error.stack || "" : "",
        plataforma: "web",
        caminho: reportPath(),
        versao: "1.0.0",
      });
    };
    const onUnhandled = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      void reportFrontendError({
        tipo: "unhandled_rejection",
        mensagem: reason instanceof Error ? reason.message : String(reason || "Promise rejeitada"),
        componentStack: reason instanceof Error ? reason.stack || "" : "",
        plataforma: "web",
        caminho: reportPath(),
        versao: "1.0.0",
      });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  // If the CDN is unreachable we fall through on error rather than wedging
  // the app — icons will tofu, but the app still boots.
  // Na web o HTML já é renderizado estaticamente. O primeiro render do
  // navegador precisa manter a mesma árvore mesmo enquanto as fontes terminam
  // de registrar; retornar null aqui causava hydration mismatch (React #418)
  // e, ocasionalmente, uma tela vazia. O splash nativo continua aguardando.
  if (Platform.OS !== "web" && !loaded && !error) return null;

  return (
    <AppErrorBoundary>
      <Stack screenOptions={{ headerShown: false }} />
    </AppErrorBoundary>
  );
}
