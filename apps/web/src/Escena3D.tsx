import { useEffect, useRef, useState } from "react";
import { Store } from "lucide-react";
import {
  Box3, CanvasTexture, DirectionalLight, Group, HemisphereLight, MathUtils, Mesh, MeshBasicMaterial, NeutralToneMapping, PerspectiveCamera,
  PlaneGeometry, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Modelo 3D de la tortillería (public/modelos/tortilleria.glb). Se inclina con el dedo o el cursor y flota suavemente. */
export default function Escena3D() {
  const marco = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");

  useEffect(() => {
    const el = marco.current!;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      setEstado("error");
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.domElement.className = "relative block h-full w-full touch-none";
    el.appendChild(renderer.domElement);

    const escena = new Scene();
    const camara = new PerspectiveCamera(30, 1, 0.1, 200);
    escena.add(new HemisphereLight(0xfff6ea, 0xc98a5e, 2.8));
    const sol = new DirectionalLight(0xfff4e0, 2.8);
    sol.position.set(-4, 7, 8);
    escena.add(sol);
    const relleno = new DirectionalLight(0xffd1a1, 0.8);
    relleno.position.set(6, 2, 4);
    escena.add(relleno);

    const grupo = new Group(); // se mueve (giro, inclinación, flotado)
    escena.add(grupo);
    let radio = 5;
    let baseY = 0;

    const reducir = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const objetivo = { x: 0, y: 0 }; // inclinación pedida por el dedo o el cursor
    const actual = { x: 0, y: 0 };

    const ajustar = () => {
      const w = el.clientWidth || 1;
      const h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camara.aspect = w / h;
      // distancia para que el modelo quepa a lo ancho y a lo alto con un poco de aire
      const vfov = MathUtils.degToRad(camara.fov);
      const dAlto = radio / Math.sin(vfov / 2);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camara.aspect);
      const dAncho = radio / Math.sin(hfov / 2);
      const d = Math.max(dAlto, dAncho) * 0.92;
      camara.position.set(0, radio * 0.42, d);
      camara.lookAt(0, 0, 0);
      camara.updateProjectionMatrix();
    };

    let vivo = true;
    new GLTFLoader().load(
      "/modelos/tortilleria.glb",
      (gltf) => {
        if (!vivo) return;
        const modelo = gltf.scene;
        // El archivo viene con Z hacia arriba: se gira para que quede de pie
        modelo.rotation.x = -Math.PI / 2;
        // El archivo guarda las texturas con el eje vertical al revés (el letrero salía de cabeza)
        modelo.traverse((o: any) => {
          const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
          for (const m of ms) {
            // flipY no aplica a ImageBitmap: se invierte la coordenada V con la transformación de la textura
            const t = m.map;
            if (t && !t.userData.volteada) {
              t.userData.volteada = true;
              t.repeat.y = -1;
              t.offset.y = 1;
            }
          }
        });
        const caja = new Box3().setFromObject(modelo);
        const centro = caja.getCenter(new Vector3());
        modelo.position.set(-centro.x, -caja.min.y, -centro.z);
        grupo.add(modelo);
        const tam = caja.getSize(new Vector3());
        radio = Math.hypot(tam.x, tam.y, tam.z) / 2;
        baseY = -tam.y * 0.5;
        // Sombra suave en el piso, junto al modelo para que gire y flote con él
        const lienzo = document.createElement("canvas");
        lienzo.width = lienzo.height = 128;
        const g = lienzo.getContext("2d")!;
        const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
        grad.addColorStop(0, "rgba(0,0,0,.55)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        const sombra = new Mesh(new PlaneGeometry(tam.x * 1.25, tam.z * 2.2), new MeshBasicMaterial({ map: new CanvasTexture(lienzo), transparent: true, depthWrite: false }));
        sombra.rotation.x = -Math.PI / 2;
        sombra.position.y = 0.02;
        modelo.parent === grupo && grupo.add(sombra);
        ajustar();
        setEstado("listo");
      },
      undefined,
      () => vivo && setEstado("error"),
    );

    const mover = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      objetivo.y = MathUtils.clamp((e.clientX - r.left) / r.width - 0.5, -0.5, 0.5);
      objetivo.x = MathUtils.clamp((e.clientY - r.top) / r.height - 0.5, -0.5, 0.5);
    };
    const soltar = () => {
      objetivo.x = 0;
      objetivo.y = 0;
    };
    el.addEventListener("pointermove", mover);
    el.addEventListener("pointerleave", soltar);
    el.addEventListener("pointerup", soltar);
    el.addEventListener("pointercancel", soltar);

    const ro = new ResizeObserver(ajustar);
    ro.observe(el);
    ajustar();

    let cuadro = 0;
    const t0 = performance.now();
    const pintar = () => {
      cuadro = requestAnimationFrame(pintar);
      const t = (performance.now() - t0) / 1000;
      actual.x += (objetivo.x - actual.x) * 0.08;
      actual.y += (objetivo.y - actual.y) * 0.08;
      const giro = reducir ? 0 : Math.sin(t * 0.55) * 0.42; // vaivén lento mostrando los lados
      grupo.rotation.y = giro + actual.y * 1.1;
      grupo.rotation.x = actual.x * 0.35;
      grupo.position.y = baseY + (reducir ? 0 : Math.sin(t * 1.1) * 0.05);
      renderer.render(escena, camara);
    };
    pintar();

    return () => {
      vivo = false;
      cancelAnimationFrame(cuadro);
      ro.disconnect();
      el.removeEventListener("pointermove", mover);
      el.removeEventListener("pointerleave", soltar);
      el.removeEventListener("pointerup", soltar);
      el.removeEventListener("pointercancel", soltar);
      escena.traverse((o: any) => {
        o.geometry?.dispose?.();
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) {
          for (const k of Object.keys(m)) m[k]?.isTexture && m[k].dispose();
          m.dispose?.();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div ref={marco} className="relative min-h-0 flex-1" role="img" aria-label="Tortillería en 3D">
      {estado === "cargando" && (
        <div className="absolute inset-0 grid place-items-center" aria-hidden>
          <Store className="h-14 w-14 animate-pulse text-dorado/70" />
        </div>
      )}
      {estado === "error" && (
        <div className="absolute inset-0 grid place-items-center" aria-hidden>
          <Store className="h-24 w-24 text-dorado" strokeWidth={1.25} />
        </div>
      )}
    </div>
  );
}
