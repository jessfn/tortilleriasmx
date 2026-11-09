import type { ReactNode } from "react";
import { ChevronLeft, type LucideIcon } from "lucide-react";

/**
 * Estructura de las pantallas de registro e inicio de sesión: portada con foto de una tortillería
 * (con filtro guinda oscuro, más fuerte arriba) + tarjeta con el formulario y scroll interno.
 */
export default function AuthLayout({
  titulo,
  subtitulo,
  icono: Icono,
  etiqueta,
  alVolver,
  children,
  pie,
}: {
  titulo: string;
  subtitulo: string;
  icono: LucideIcon;
  /** Insignia de la portada (p. ej. "Acceso administrativo") */
  etiqueta?: string;
  alVolver: () => void;
  children: ReactNode;
  pie: ReactNode;
}) {
  return (
    <div className="marco-pc mx-auto flex h-dvh max-w-xl flex-col overflow-hidden bg-guinda-oscuro lg:max-w-2xl">
      <header className="relative shrink-0 overflow-hidden bg-guinda-oscuro pb-12 pt-[max(.5rem,env(safe-area-inset-top))] text-white">
        <img src="/login-tortillas.jpg" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover object-[50%_58%]" />
        {/* Filtro guinda oscuro: más cerrado arriba, deja ver la foto hacia abajo */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#3a081e]/95 via-guinda-oscuro/80 to-guinda-oscuro/40" aria-hidden />

        <div className="relative px-3">
          <div className="flex items-center justify-between">
            <button onClick={alVolver} aria-label="Volver al inicio" className="grid h-9 w-9 place-items-center rounded-full bg-black/15 backdrop-blur hover:bg-white/15">
              <ChevronLeft className="h-6 w-6" />
            </button>
            {etiqueta && <span className="rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold backdrop-blur">{etiqueta}</span>}
          </div>

          <div className="px-2 pb-1 pt-5">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-dorado text-base font-extrabold tracking-tight text-guinda-oscuro shadow-lg shadow-black/25" aria-hidden>
              MX
            </span>
            <h1 className="mt-3 text-[2rem] font-extrabold leading-none tracking-tight drop-shadow-sm">
              Tortillerías<span className="text-dorado">MX</span>
            </h1>
            <p className="mt-2 max-w-[17rem] text-sm leading-snug text-white/85">Registro nacional del precio de la tortilla</p>
          </div>
        </div>
      </header>

      <main className="paso relative z-10 -mt-6 flex min-h-0 flex-1 flex-col rounded-t-[1.75rem] bg-stone-50 shadow-[0_-6px_18px_-6px_rgba(0,0,0,.35)]">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-3 pt-5">
          <div className="flex items-center gap-3 pb-1">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-guinda/10">
              <Icono className="h-5 w-5 text-guinda" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold leading-tight">{titulo}</h2>
              <p className="text-xs text-stone-500">{subtitulo}</p>
            </div>
          </div>
          {children}
        </div>
        <div className="shrink-0 bg-stone-50 px-4 pb-[max(.5rem,calc(var(--sb)*.35))] pt-3">{pie}</div>
      </main>
    </div>
  );
}
