/**
 * Diagnóstico de pantalla. En algunos iPhone la ventana visible mide menos que la pantalla física; ajustar el alto a la pantalla
 * esconde contenido bajo esa franja, así que no se fuerza: la raíz mide lo que el navegador reporta y el fondo de la página
 * se pinta del color del borde inferior de cada vista (ver index.css) para que la franja se funda con la pantalla.
 */
const standalone = () => (navigator as any).standalone === true || matchMedia("(display-mode: standalone)").matches;

/** Solo iPhone/iPad: en Android la pantalla incluye barras del sistema y este ajuste sobraría */
const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function medidas() {
  const retrato = innerHeight >= innerWidth;
  const largo = Math.max(screen.width, screen.height);
  const corto = Math.min(screen.width, screen.height);
  return {
    standalone: standalone(),
    ios: esIOS(),
    inner: `${innerWidth}x${innerHeight}`,
    visual: `${Math.round(visualViewport?.width ?? 0)}x${Math.round(visualViewport?.height ?? 0)}`,
    pantalla: `${screen.width}x${screen.height}`,
    esperado: retrato ? largo : corto,
    dpr: devicePixelRatio,
  };
}

/** Cinco toques rápidos en la esquina superior izquierda muestran las medidas (para diagnosticar en un teléfono real) */
export function activarDiagnostico() {
  let toques: number[] = [];
  addEventListener(
    "pointerdown",
    (e) => {
      if (e.clientX > 70 || e.clientY > 70) return;
      const t = Date.now();
      toques = [...toques.filter((x) => t - x < 2000), t];
      if (toques.length < 5) return;
      toques = [];
      const previo = document.getElementById("diagnostico");
      if (previo) return previo.remove();
      const d = document.createElement("pre");
      d.id = "diagnostico";
      const cs = getComputedStyle(document.documentElement);
      const raiz = document.getElementById("root")!.getBoundingClientRect();
      d.textContent = JSON.stringify({ ...medidas(), raizAlto: Math.round(raiz.height), raizTop: Math.round(raiz.top), alto: cs.getPropertyValue("--alto") || "(sin ajuste)" }, null, 1);
      d.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#000c;color:#fff;font:12px/1.35 monospace;padding:10px;border-radius:10px;white-space:pre-wrap";
      d.onclick = () => d.remove();
      document.body.appendChild(d);
    },
    { passive: true },
  );
}
