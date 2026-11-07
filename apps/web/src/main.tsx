import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App, { AvisoVersion } from "./App";
import "./index.css";

// La versión nueva NO reemplaza la actual por sorpresa (se perdería una captura a medias):
// se avisa con un botón "Actualizar" y la persona decide cuándo.
const actualizar = registerSW({
  immediate: true,
  onNeedRefresh() {
    window.dispatchEvent(new Event("hay-version-nueva"));
  },
});
(window as unknown as { __actualizarApp: () => void }).__actualizarApp = () => actualizar(true);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <AvisoVersion />
  </StrictMode>,
);
