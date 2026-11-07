import { useEffect, useRef, useState } from "react";
import { ClipboardPlus, LayoutDashboard, LogIn, LogOut } from "lucide-react";
import type { Sesion } from "./api";
import "./inicio3d.css";

/** Logotipos oficiales: Gobierno de México y Secretaría de Agricultura y Desarrollo Rural (administración 2024-2030, fuente: gob.mx) */
function LogoGobierno() {
  return (
    <div className="flex items-center gap-3">
      <img src="/logo-gobierno.svg" alt="Gobierno de México" className="h-11 w-auto shrink-0" />
      <span className="h-8 w-px shrink-0 bg-white/30" aria-hidden />
      <img src="/logo-agricultura.png" alt="Agricultura, Secretaría de Agricultura y Desarrollo Rural" className="h-7 w-auto min-w-0 shrink [filter:brightness(0)_invert(1)]" />
    </div>
  );
}

/** Escena 3D de la tortillería. Se inclina con el dedo o el cursor y se ajusta al espacio disponible. */
function Tortilleria3D() {
  const marco = useRef<HTMLDivElement>(null);
  const rotor = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = useState(1);

  useEffect(() => {
    const el = marco.current!;
    const ajustar = () => setEscala(Math.min(el.clientWidth / 320, el.clientHeight / 270, 1.25));
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mover = (e: React.PointerEvent) => {
    const r = marco.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    rotor.current?.style.setProperty("--ry", String(Math.max(-1, Math.min(1, x)) * 18));
    rotor.current?.style.setProperty("--rx", String(Math.max(-1, Math.min(1, y)) * 8));
  };
  const soltar = () => {
    rotor.current?.style.setProperty("--ry", "0");
    rotor.current?.style.setProperty("--rx", "0");
  };

  return (
    <div ref={marco} className="relative flex min-h-0 flex-1 touch-none items-center justify-center" onPointerMove={mover} onPointerLeave={soltar} onPointerUp={soltar}>
      <div style={{ width: 320, height: 270, transform: `scale(${escala})`, flexShrink: 0 }} role="img" aria-label="Tortillería en 3D con una tortilla volteándose en el comal">
        <div className="escena3d">
          <div className="rotor" ref={rotor}>
            <div className="intro">
              <div className="mundo">
                <div className="suelo" />

                <div className="box edificio">
                  <div className="fr"><div className="ventana v1" /><div className="ventana v2" /><div className="puerta" /></div>
                  <div className="bk" /><div className="lf" /><div className="rt" /><div className="tp" />
                </div>

                <div className="box letrero">
                  <div className="fr">TORTILLERÍA</div>
                  <div className="bk" /><div className="lf" /><div className="rt" /><div className="tp" />
                </div>

                <div className="toldo">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <i key={i} />)}</div>

                <div className="box mostrador">
                  <div className="fr" /><div className="bk" /><div className="lf" /><div className="rt" />
                  <div className="tp"><i className="comal" /><i className="tortilla t1" /><i className="tortilla t2" /><i className="sombra-v" /></div>
                </div>
                <div className="vuelo"><div className="cara" /><div className="cara dorso" /></div>

                <div className="vapor p1" /><div className="vapor p2" /><div className="vapor p3" />
                {[1, 2, 3, 4, 5, 6].map((n) => <div key={n} className={`chispa c${n}`} />)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type Props = { sesion: Sesion | null; alRegistrar: () => void; alIniciar: () => void; alPanel: () => void; alCerrarSesion: () => void };

export default function Inicio({ sesion, alRegistrar, alIniciar, alPanel, alCerrarSesion }: Props) {
  const boton = "a-entra flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl text-base transition active:scale-[.97]";
  return (
    <div className="marco-pc relative mx-auto flex h-dvh max-w-xl flex-col overflow-hidden lg:grid lg:max-w-5xl lg:grid-cols-[1.15fr_1fr] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-x-10 lg:px-14 lg:pt-10 bg-gradient-to-b from-guinda-oscuro via-guinda to-guinda-oscuro px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,calc(env(safe-area-inset-top)+.75rem))] text-white">
      <div className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-dorado/15 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-verde/30 blur-3xl" aria-hidden />

      <div className="a-entra relative lg:col-span-2" style={{ animationDelay: ".05s" }}>
        <LogoGobierno />
      </div>

      <Tortilleria3D />

      <div className="flex flex-col lg:col-start-2 lg:row-start-2 lg:justify-center lg:pb-6">
      <div className="relative text-center lg:text-left">
        <h1 className="a-entra text-4xl font-extrabold tracking-tight lg:text-6xl" style={{ animationDelay: "1.2s" }}>
          Tortillerías<span className="text-dorado">MX</span>
        </h1>
        <p className="a-entra mx-auto mt-1.5 max-w-[17rem] text-sm leading-snug text-white/80 lg:mx-0 lg:mt-3 lg:max-w-md lg:text-lg" style={{ animationDelay: "1.4s" }}>
          Registro nacional del precio de la tortilla
        </p>
      </div>

      <div className="relative mt-5 space-y-2.5 lg:mt-8 lg:max-w-sm">
        {sesion ? (
          <>
            <button onClick={alPanel} className={`${boton} bg-white font-bold text-guinda shadow-xl shadow-black/20`} style={{ animationDelay: "1.7s" }}>
              <LayoutDashboard className="h-5 w-5" aria-hidden /> Ir a mi panel
            </button>
            <button onClick={alCerrarSesion} className={`${boton} bg-white/10 font-semibold text-white ring-1 ring-white/30 backdrop-blur`} style={{ animationDelay: "1.9s" }}>
              <LogOut className="h-5 w-5" aria-hidden /> Cerrar sesión
            </button>
          </>
        ) : (
          <>
            <button onClick={alRegistrar} className={`${boton} bg-white font-bold text-guinda shadow-xl shadow-black/20`} style={{ animationDelay: "1.7s" }}>
              <ClipboardPlus className="h-5 w-5" aria-hidden /> Registrar
            </button>
            <button onClick={alIniciar} className={`${boton} bg-white/10 font-semibold text-white ring-1 ring-white/30 backdrop-blur`} style={{ animationDelay: "1.9s" }}>
              <LogIn className="h-5 w-5" aria-hidden /> Iniciar sesión
            </button>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
