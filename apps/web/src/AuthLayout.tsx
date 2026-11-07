import type { ReactNode } from "react";
import { ChevronLeft, type LucideIcon } from "lucide-react";

/** Estructura de las pantallas de registro e inicio de sesión: barra delgada + formulario con scroll interno */
export default function AuthLayout({
  titulo,
  subtitulo,
  icono: Icono,
  alVolver,
  children,
  pie,
}: {
  titulo: string;
  subtitulo: string;
  icono: LucideIcon;
  alVolver: () => void;
  children: ReactNode;
  pie: ReactNode;
}) {
  return (
    <div className="mx-auto flex h-dvh max-w-xl flex-col overflow-hidden bg-guinda-oscuro">
      <header className="shrink-0 bg-gradient-to-br from-guinda-oscuro via-guinda to-guinda-oscuro px-3 pb-7 pt-[max(.5rem,env(safe-area-inset-top))] text-white">
        <button onClick={alVolver} aria-label="Volver al inicio" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <div className="mt-1 flex items-center gap-3 px-1">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15">
            <Icono className="h-6 w-6 text-dorado" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">{titulo}</h1>
            <p className="text-xs text-white/75">{subtitulo}</p>
          </div>
        </div>
      </header>
      <main className="paso -mt-3 flex min-h-0 flex-1 flex-col rounded-t-3xl bg-stone-50">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-3 pt-5">{children}</div>
        <div className="shrink-0 border-t border-stone-200/70 bg-white px-4 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-3">{pie}</div>
      </main>
    </div>
  );
}
