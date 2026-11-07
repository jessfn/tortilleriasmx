import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Check, ChevronLeft, type LucideIcon } from "lucide-react";

export function Boton({
  variante = "primario",
  icono: Icono,
  className = "",
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "primario" | "secundario" | "fantasma"; icono?: LucideIcon }) {
  const base =
    "inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl px-5 text-base font-semibold transition-all duration-200 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
  const v = {
    primario: "bg-gradient-to-r from-guinda to-guinda-oscuro text-white shadow-lg shadow-guinda/25 hover:shadow-xl hover:shadow-guinda/30",
    secundario: "bg-white text-guinda shadow-sm ring-1 ring-stone-200 hover:ring-guinda/40",
    fantasma: "text-stone-600 hover:bg-stone-100",
  }[variante];
  return (
    <button {...p} className={`${base} ${v} ${className}`}>
      {Icono && <Icono className="h-5 w-5" aria-hidden />}
      {children}
    </button>
  );
}

export function Campo({
  etiqueta,
  icono: Icono,
  error,
  ayuda,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; icono?: LucideIcon; error?: string; ayuda?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-stone-700">{etiqueta}</span>
      <span className="relative block">
        {Icono && <Icono className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-400" aria-hidden />}
        <input
          {...p}
          className={`min-h-14 w-full rounded-2xl border bg-white text-base shadow-sm outline-none transition focus:ring-4 ${Icono ? "pl-12" : "pl-4"} pr-4 ${
            error ? "border-red-400 focus:ring-red-100" : "border-stone-200 focus:border-guinda focus:ring-guinda/10"
          }`}
        />
      </span>
      {error ? <span className="mt-1 block text-sm text-red-600">{error}</span> : ayuda ? <span className="mt-1 block text-sm text-stone-500">{ayuda}</span> : null}
    </label>
  );
}

export function Opcion({
  activo,
  icono: Icono,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { activo?: boolean; icono?: LucideIcon }) {
  return (
    <button
      {...p}
      className={`group flex w-full items-center gap-3 rounded-2xl border bg-white px-4 py-3.5 text-left text-base shadow-sm transition-all duration-200 active:scale-[.98] ${
        activo ? "border-guinda bg-guinda/5 ring-2 ring-guinda/20" : "border-stone-200 hover:border-stone-300"
      }`}
    >
      {Icono && (
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${activo ? "bg-guinda text-white" : "bg-stone-100 text-stone-500"}`}>
          <Icono className="h-5 w-5" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">{children}</span>
      <span
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full transition ${activo ? "bg-guinda text-white" : "border border-stone-300"}`}
        aria-hidden
      >
        {activo && <Check className="h-4 w-4" />}
      </span>
    </button>
  );
}

export function Cabecera({
  paso,
  total,
  titulo,
  subtitulo,
  icono: Icono,
  atras,
}: {
  paso: number;
  total: number;
  titulo: string;
  subtitulo?: string;
  icono: LucideIcon;
  atras?: () => void;
}) {
  return (
    <header className="relative overflow-hidden bg-gradient-to-br from-guinda-oscuro via-guinda to-guinda-oscuro px-5 pb-12 pt-[max(1rem,env(safe-area-inset-top))] text-white">
      <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-dorado/20 blur-2xl" aria-hidden />
      <div className="relative mx-auto max-w-xl">
        <div className="flex items-center justify-between">
          {atras ? (
            <button onClick={atras} aria-label="Volver" className="-ml-2 grid h-10 w-10 place-items-center rounded-full hover:bg-white/10">
              <ChevronLeft className="h-6 w-6" />
            </button>
          ) : (
            <span className="flex items-center gap-2 text-sm font-semibold tracking-wide text-dorado">
              <span className="h-2 w-2 rounded-full bg-dorado" /> TortilleríasMX
            </span>
          )}
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
            Paso {paso} de {total}
          </span>
        </div>
        <div className="mt-5 flex items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15 backdrop-blur">
            <Icono className="h-7 w-7 text-dorado" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold leading-tight">{titulo}</h1>
            {subtitulo && <p className="mt-0.5 text-sm text-white/75">{subtitulo}</p>}
          </div>
        </div>
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={paso}>
          <div className="h-full rounded-full bg-dorado transition-all duration-500 ease-out" style={{ width: `${(paso / total) * 100}%` }} />
        </div>
      </div>
    </header>
  );
}

export function Hoja({ children }: { children: ReactNode }) {
  return <main className="relative -mt-6 flex-1 rounded-t-[2rem] bg-stone-50 shadow-[0_-8px_30px_rgba(0,0,0,.08)]">{children}</main>;
}

export function Barra({ children }: { children: ReactNode }) {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200/70 bg-white/85 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
      <div className="mx-auto flex max-w-xl gap-3 px-5">{children}</div>
    </footer>
  );
}

export function Aviso({ tipo = "error", children }: { tipo?: "error" | "info" | "ok"; children: ReactNode }) {
  const c = { error: "bg-red-50 text-red-700 ring-red-200", info: "bg-amber-50 text-amber-800 ring-amber-200", ok: "bg-emerald-50 text-emerald-800 ring-emerald-200" }[tipo];
  return (
    <div role={tipo === "error" ? "alert" : "status"} className={`rounded-2xl p-3.5 text-sm ring-1 ${c}`}>
      {children}
    </div>
  );
}
