import "./globals.css";
import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { PlayerProvider } from "../components/player/PlayerProvider";
import PlayerBar from "../components/player/PlayerBar";
import Nav from "../components/Nav";

const DESC = "Shiurim de Guemará sobre Masejet Berajot, con transcripción sincronizada, búsqueda y preguntas sobre cada clase.";
export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || "https://ofirsegal.app"),
  title: { default: "ברכות שר לשמחה — Shiurim de Berajot", template: "%s · ברכות שר לשמחה" },
  description: DESC,
  applicationName: "ברכות שר לשמחה",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ברכות", statusBarStyle: "black-translucent" },
  openGraph: { title: "ברכות שר לשמחה", description: DESC, type: "website", locale: "es_ES", siteName: "ברכות שר לשמחה" },
  twitter: { card: "summary", title: "ברכות שר לשמחה", description: DESC },
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, viewportFit: "cover",
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f5efe0" }, { media: "(prefers-color-scheme: dark)", color: "#0e1424" }],
};

// Sets the saved theme before first paint (no flash). "light" | "dark"; absent = follow the system.
const THEME_INIT = `try{var t=localStorage.getItem("shiurim:theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* Fonts load at runtime so an offline build never fails; every stack has a system fallback. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Frank+Ruhl+Libre:wght@400;500;700;900&family=Inter:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <a className="skip-link" href="#main">Saltar al contenido</a>
        <PlayerProvider>
          <Nav />
          <main id="main" className="page">{children}</main>
          <PlayerBar />
        </PlayerProvider>
      </body>
    </html>
  );
}
