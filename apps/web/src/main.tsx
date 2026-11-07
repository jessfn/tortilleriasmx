import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";
import { activarDiagnostico, ajustarAltoReal } from "./pantalla";

ajustarAltoReal();
activarDiagnostico();

// Actualización reactiva: la app busca versiones nuevas cada minuto y cada vez que vuelve a primer plano.
// Al detectarla, se activa y la página se recarga sola (la captura a medias se restaura: ver persist.ts).
registerSW({
  immediate: true,
  onRegisteredSW(_url, registro) {
    if (!registro) return;
    const buscar = () => registro.update().catch(() => {});
    setInterval(buscar, 60_000);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && buscar());
    window.addEventListener("online", buscar);
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
