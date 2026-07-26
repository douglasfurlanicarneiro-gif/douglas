// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="pt-BR" style={{ height: "100%", backgroundColor: "#080706" }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <title>L’Essence Furlani</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <meta name="theme-color" content="#080706" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="L’Essence Furlani" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="preload" as="image" href="/launch-logo.jpg" />
        {/*
          Disable body scrolling on web to make ScrollView components work correctly.
          If you want to enable scrolling, remove `ScrollViewStyleReset` and
          set `overflow: auto` on the body style below.
        */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body > div:first-child { position: fixed !important; top: 0; left: 0; right: 0; bottom: 0; }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
              #brand-preloader {
                position: fixed;
                inset: 0;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #080706;
                transition: opacity 180ms ease;
              }
              #brand-preloader img {
                width: 88%;
                max-width: 520px;
                height: auto;
                animation: brand-intro-pulse 1.15s ease-in-out infinite;
              }
              @keyframes brand-intro-pulse {
                0%, 100% { opacity: .88; transform: scale(.985); filter: brightness(.92); }
                50% { opacity: 1; transform: scale(1); filter: brightness(1.12); }
              }
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          backgroundColor: "#080706",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div id="brand-preloader" aria-hidden="true">
          <img src="/launch-logo.jpg" alt="" />
        </div>
        {children}
      </body>
    </html>
  );
}
