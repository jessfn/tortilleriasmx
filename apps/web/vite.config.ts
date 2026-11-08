import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // La versión nueva se activa sola y la app se recarga (el borrador de captura se conserva)
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "TortilleríasMX",
        short_name: "TortilleríasMX",
        description: "Captura del precio de la tortilla",
        lang: "es-MX",
        theme_color: "#611232",
        background_color: "#611232",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png}"],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
