import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Tortillería en 3D (modelo GLB). Se carga bajo demanda: mientras llega, o si el dispositivo no
 * soporta WebGL o falla la descarga, se muestra la escena CSS de respaldo (`fallback`).
 */
export default function Escena3D({ fallback }: { fallback: ReactNode }) {
  const marco = useRef<HTMLDivElement>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    const el = marco.current!;
    let vivo = true;
    let limpiar = () => {};

    (async () => {
      try {
        const probe = document.createElement("canvas");
        if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) return;
        const [THREE, { GLTFLoader }] = await Promise.all([import("three"), import("three/examples/jsm/loaders/GLTFLoader.js")]);
        if (!vivo) return;

        const render = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
        render.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        render.outputColorSpace = THREE.SRGBColorSpace;
        render.toneMapping = THREE.NeutralToneMapping;
        render.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
        el.appendChild(render.domElement);

        const escena = new THREE.Scene();
        escena.add(new THREE.HemisphereLight(0xfff4e0, 0x6b4a3a, 1.5));
        const sol = new THREE.DirectionalLight(0xffffff, 2.2);
        sol.position.set(4, 8, 6);
        escena.add(sol);
        const camara = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

        const gltf = await new GLTFLoader().loadAsync("/modelos/tortilleria.glb");
        if (!vivo) {
          render.dispose();
          return;
        }
        const modelo = gltf.scene;
        const caja = new THREE.Box3().setFromObject(modelo);
        const centro = caja.getCenter(new THREE.Vector3());
        const tam = caja.getSize(new THREE.Vector3());
        modelo.position.sub(centro);
        const grupo = new THREE.Group(); // gira alrededor del centro del modelo
        grupo.add(modelo);
        escena.add(grupo);
        const radio = tam.length() / 2;

        // Sombra suave en el piso
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        const g = c.getContext("2d")!;
        const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
        grad.addColorStop(0, "rgba(0,0,0,.45)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        const sombra = new THREE.Mesh(
          new THREE.PlaneGeometry(Math.max(tam.x, tam.z) * 1.5, Math.max(tam.x, tam.z) * 1.5),
          new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
        );
        sombra.rotation.x = -Math.PI / 2;
        sombra.position.y = -tam.y / 2 + 0.02;
        grupo.add(sombra);

        // Chispas doradas que flotan alrededor, con brillo aditivo
        const cb = document.createElement("canvas");
        cb.width = cb.height = 64;
        const gb = cb.getContext("2d")!;
        const gr = gb.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, "rgba(255,236,170,1)");
        gr.addColorStop(0.25, "rgba(232,201,135,.85)");
        gr.addColorStop(1, "rgba(232,201,135,0)");
        gb.fillStyle = gr;
        gb.fillRect(0, 0, 64, 64);
        const N = 36;
        const pos = new Float32Array(N * 3);
        const sem = Array.from({ length: N }, () => ({ a: Math.random() * 6.28, r: radio * (0.75 + Math.random() * 0.55), y: (Math.random() - 0.5) * tam.y * 1.3, v: 0.04 + Math.random() * 0.08, f: Math.random() * 6.28 }));
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        const chispas = new THREE.Points(
          geo,
          new THREE.PointsMaterial({ map: new THREE.CanvasTexture(cb), size: radio * 0.16, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }),
        );
        chispas.frustumCulled = false;
        grupo.add(chispas);

        // Cámara como en el visor de ejemplo: azimut 30°, polar 70° (elevación 20°)
        const ajustar = () => {
          const w = el.clientWidth || 1;
          const h = el.clientHeight || 1;
          render.setSize(w, h, false);
          camara.aspect = w / h;
          const vfov = (camara.fov * Math.PI) / 180;
          const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camara.aspect);
          const dist = (radio * 0.92) / Math.sin(Math.min(vfov, hfov) / 2);
          const el_ = (20 * Math.PI) / 180;
          camara.position.set(0, Math.sin(el_) * dist, Math.cos(el_) * dist);
          camara.lookAt(0, -radio * 0.04, 0);
          camara.updateProjectionMatrix();
        };
        ajustar();
        const ro = new ResizeObserver(ajustar);
        ro.observe(el);

        // Inclinación con el dedo o el cursor
        let objX = 0;
        let objY = 0;
        const mover = (e: PointerEvent) => {
          const r = el.getBoundingClientRect();
          objY = Math.max(-1, Math.min(1, (e.clientX - r.left) / r.width - 0.5)) * 0.6;
          objX = Math.max(-1, Math.min(1, (e.clientY - r.top) / r.height - 0.5)) * 0.25;
        };
        const soltar = () => {
          objX = 0;
          objY = 0;
        };
        el.addEventListener("pointermove", mover);
        el.addEventListener("pointerleave", soltar);
        el.addEventListener("pointerup", soltar);

        const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const base = (30 * Math.PI) / 180;
        let ry = 0;
        let rx = 0;
        let raf = 0;
        const t0 = performance.now();
        const cuadro = (t: number) => {
          raf = requestAnimationFrame(cuadro);
          if (document.hidden) return;
          const s = (t - t0) / 1000;
          const vaiven = quieto ? 0 : Math.sin(s * 0.5) * 0.35;
          ry += (objY + vaiven - ry) * 0.06;
          rx += (objX - rx) * 0.06;
          grupo.rotation.set(rx, base * 0 + ry - 0.35, 0);
          grupo.position.y = quieto ? 0 : Math.sin(s * 1.1) * radio * 0.012;
          const lim = tam.y * 0.65;
          sem.forEach((p, i) => {
            const y = ((((p.y + (quieto ? 0 : s * p.v * radio)) + lim) % (2 * lim)) + 2 * lim) % (2 * lim) - lim;
            pos[i * 3] = Math.cos(p.a + s * 0.12) * p.r;
            pos[i * 3 + 1] = y;
            pos[i * 3 + 2] = Math.sin(p.a + s * 0.12) * p.r * 0.7;
          });
          geo.attributes.position.needsUpdate = true;
          chispas.material.opacity = quieto ? 0.9 : 0.65 + Math.sin(s * 2.2) * 0.3;
          render.render(escena, camara);
        };
        raf = requestAnimationFrame(cuadro);
        setListo(true);

        limpiar = () => {
          cancelAnimationFrame(raf);
          ro.disconnect();
          el.removeEventListener("pointermove", mover);
          el.removeEventListener("pointerleave", soltar);
          el.removeEventListener("pointerup", soltar);
          escena.traverse((o) => {
            const m = o as import("three").Mesh;
            m.geometry?.dispose();
            const mat = m.material as import("three").Material | import("three").Material[] | undefined;
            (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => {
              (x as import("three").MeshStandardMaterial).map?.dispose();
              x.dispose();
            });
          });
          render.dispose();
          render.domElement.remove();
        };
      } catch {
        // Sin WebGL o sin red: se queda la escena CSS
      }
    })();

    return () => {
      vivo = false;
      limpiar();
    };
  }, []);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {!listo && fallback}
      <div
        ref={marco}
        className={`absolute inset-0 touch-none transition-opacity duration-500 ${listo ? "opacity-100" : "pointer-events-none opacity-0"}`}
        role="img"
        aria-label="Tortillería en 3D"
      />
    </div>
  );
}
