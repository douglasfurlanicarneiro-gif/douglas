// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="pt-BR" style={{ height: "100%", backgroundColor: "#D5CCBB" }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <title>L’Essence Furlani</title>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <meta name="theme-color" content="#D5CCBB" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="L’Essence Furlani" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="dns-prefetch" href="//lessence-furlani-api.onrender.com" />
        <link rel="preconnect" href="https://lessence-furlani-api.onrender.com" crossOrigin="anonymous" />
        <link rel="icon" type="image/png" sizes="192x192" href="/favicon-light.png?v=2" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-light.png?v=2" />
        <link rel="preload" as="image" href="/launch-logo-light.png?v=2" />
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
              body { font-family: DMSans_400Regular, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
              input:-webkit-autofill,
              input:-webkit-autofill:hover,
              input:-webkit-autofill:focus {
                -webkit-text-fill-color: #251F18 !important;
                -webkit-box-shadow: 0 0 0 1000px #FFF9F0 inset !important;
                box-shadow: 0 0 0 1000px #FFF9F0 inset !important;
                caret-color: #251F18;
              }
              #brand-preloader {
                position: fixed;
                inset: 0;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #D5CCBB;
                overflow: hidden;
                transition: opacity 320ms ease;
              }
              #brand-preloader::before {
                content: "";
                position: absolute;
                z-index: 2;
                top: -20%;
                left: 0;
                width: 42vw;
                min-width: 190px;
                max-width: 460px;
                height: 140%;
                border-radius: 46% 54% 38% 62% / 28% 34% 66% 72%;
                background: linear-gradient(90deg,
                  rgba(239, 211, 157, 0) 0%,
                  rgba(255, 249, 240, 0.18) 28%,
                  rgba(255, 239, 204, 0.72) 50%,
                  rgba(199, 162, 92, 0.18) 72%,
                  rgba(199, 162, 92, 0) 100%);
                filter: blur(3px);
                box-shadow: 0 0 54px rgba(255, 239, 204, 0.22);
                animation: brand-page-shine 1.45s ease-in-out infinite;
                pointer-events: none;
              }
              #brand-preloader img {
                width: 100%;
                height: 100%;
                object-fit: contain;
              }
              .brand-preloader-stage {
                position: relative;
                z-index: 1;
                top: -10%;
                width: 88%;
                max-width: 520px;
                aspect-ratio: 1;
              }
              .brand-preloader-caption {
                position: absolute;
                z-index: 1;
                bottom: 13%;
                width: 92%;
                max-width: 500px;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                padding: 8px;
                box-sizing: border-box;
                color: #8C642B;
                font-family: DMSans_700Bold, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                font-size: 11px;
                line-height: 15px;
                font-weight: 400;
                letter-spacing: 2.2px;
                text-align: center;
                white-space: nowrap;
              }
              .brand-preloader-caption::before,
              .brand-preloader-caption::after {
                content: "";
                flex: 1;
                max-width: 48px;
                height: 1px;
                background: linear-gradient(90deg, rgba(140, 100, 43, 0), rgba(140, 100, 43, .9));
              }
              .brand-preloader-caption::after {
                background: linear-gradient(90deg, rgba(140, 100, 43, .9), rgba(140, 100, 43, 0));
              }
              @keyframes brand-page-shine {
                0% { opacity: 0; transform: translate3d(-70vw, 0, 0) rotate(9deg) scaleX(.82); }
                16% { opacity: .92; }
                82% { opacity: .92; }
                100% { opacity: 0; transform: translate3d(170vw, 0, 0) rotate(9deg) scaleX(1.08); }
              }
              @media (prefers-reduced-motion: reduce) {
                #brand-preloader::before { animation: none; opacity: 0; }
              }
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          backgroundColor: "#D5CCBB",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div id="brand-preloader" aria-hidden="true">
          <div className="brand-preloader-stage">
            <img src="/launch-logo-light.png?v=2" alt="" />
          </div>
          <div className="brand-preloader-caption">UMA EXPERIÊNCIA EM PERFUMARIA</div>
        </div>
        {children}
      </body>
    </html>
  );
}
