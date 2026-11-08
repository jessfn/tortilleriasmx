import { lazy, Suspense } from "react";
import { ClipboardPlus, LayoutDashboard, LogIn, LogOut } from "lucide-react";
import type { Sesion } from "./api";

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

const Escena3D = lazy(() => import("./Escena3D"));

type Props = { sesion: Sesion | null; alRegistrar: () => void; alIniciar: () => void; alPanel: () => void; alCerrarSesion: () => void };

export default function Inicio({ sesion, alRegistrar, alIniciar, alPanel, alCerrarSesion }: Props) {
  const boton = "a-entra flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl text-base transition active:scale-[.97]";
  return (
    <div className="marco-pc relative mx-auto flex h-dvh max-w-xl flex-col overflow-hidden lg:grid lg:max-w-5xl lg:grid-cols-[1.15fr_1fr] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-x-10 lg:px-14 lg:pt-10 bg-gradient-to-b from-guinda-oscuro via-guinda to-guinda-oscuro px-6 pb-[max(1.25rem,var(--sb))] pt-[max(1.25rem,calc(env(safe-area-inset-top)+.75rem))] text-white">
      <div className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-dorado/15 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-verde/30 blur-3xl" aria-hidden />

      <div className="a-entra relative lg:col-span-2" style={{ animationDelay: ".05s" }}>
        <LogoGobierno />
      </div>

      <Suspense fallback={<div className="min-h-0 flex-1" />}>
        <Escena3D />
      </Suspense>

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
