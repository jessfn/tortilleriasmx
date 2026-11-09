import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // La versión nueva se activa sola y la app se recarga (el borrador de captura se conserva)
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png", "favicon-48.png", "icon-512-maskable.png"],
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
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,svg,png,jpg,glb}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Mapa sin señal: lo que el censador ya vio con internet (estilo, sprites, fuentes y teselas de OpenFreeMap) queda en el teléfono
        runtimeCaching: [
          {
            // Tipografía Patria del CDN de gob.mx: tras la primera vez también se ve sin señal
            urlPattern: ({ url }: { url: URL }) => url.hostname === "framework-gb.cdn.gob.mx",
            handler: "CacheFirst",
            options: { cacheName: "fuentes", expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 3600 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            // Mapa a color: estilo, teselas y fuentes de OpenFreeMap
            urlPattern: ({ url }: { url: URL }) => url.hostname === "tiles.openfreemap.org",
            handler: "CacheFirst",
            options: {
              cacheName: "mapa",
              expiration: { maxEntries: 3000, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
