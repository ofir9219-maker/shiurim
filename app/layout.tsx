import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "ברכות שר לשמחה" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
