import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ברכות שר לשמחה — Shiurim de Berajot",
    short_name: "ברכות",
    description: "Shiurim de Guemará sobre Masejet Berajot con transcripción sincronizada.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5efe0",
    theme_color: "#15223f",
    lang: "es",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
