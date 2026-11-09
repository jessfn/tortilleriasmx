import { defineConfig } from "vitest/config";

// Pruebas de la lógica del teléfono (bandeja, catálogo local): sin navegador, con IndexedDB simulado
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
