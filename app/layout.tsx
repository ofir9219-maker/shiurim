import "./globals.css";
import type { ReactNode } from "react";
import type { Viewport } from "next";
import { PlayerProvider } from "../components/player/PlayerProvider";
import PlayerBar from "../components/player/PlayerBar";
import Nav from "../components/Nav";

export const metadata = { title: "ברכות שר לשמחה — Shiurim", description: "Shiurim de Guemará con transcripción sincronizada y búsqueda." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#1b2a4a" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" dir="ltr">
      <head>
        {/* Frank Ruhl Libre: loaded at runtime so an offline build never fails; falls back to system serif. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Frank+Ruhl+Libre:wght@400;500;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap"
        />
      </head>
      <body>
        <PlayerProvider>
          <Nav />
          <main className="page">{children}</main>
          <PlayerBar />
        </PlayerProvider>
      </body>
    </html>
  );
}
