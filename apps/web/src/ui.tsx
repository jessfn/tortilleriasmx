import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Check, ChevronLeft, Search, X, type LucideIcon } from "lucide-react";

export function Boton({
  variante = "primario",
  icono: Icono,
  className = "",
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "primario" | "secundario" | "fantasma"; icono?: LucideIcon }) {
  const base =
    "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-semibold transition-all duration-200 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
  const v = {
    primario: "bg-gradient-to-r from-guinda to-guinda-oscuro text-white shadow-md shadow-guinda/25",
    secundario: "bg-white text-guinda shadow-sm ring-1 ring-stone-200 hover:ring-guinda/40",
    fantasma: "text-stone-600 hover:bg-stone-100",
  }[variante];
  return (
    <button {...p} className={`${base} ${v} ${className}`}>
      {Icono && <Icono className="h-5 w-5 shrink-0" aria-hidden />}
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
      <span className="mb-1 block text-xs font-semibold text-stone-600">{etiqueta}</span>
      <span className="relative block">
        {Icono && <Icono className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-stone-400" aria-hidden />}
        <input
          {...p}
          className={`h-12 w-full rounded-xl border bg-white text-[15px] shadow-sm outline-none transition focus:ring-4 ${Icono ? "pl-11" : "pl-3.5"} pr-3.5 ${
            error ? "border-red-400 focus:ring-red-100" : "border-stone-200 focus:border-guinda focus:ring-guinda/10"
          }`}
        />
      </span>
      {error ? <span className="mt-0.5 block text-xs text-red-600">{error}</span> : ayuda ? <span className="mt-0.5 block text-xs text-stone-500">{ayuda}</span> : null}
    </label>
  );
}

/** Buscador para la barra superior (sobre fondo guinda) */
export function Buscador({ value, onChange, placeholder, cargando }: { value: string; onChange: (v: string) => void; placeholder: string; cargando?: boolean }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-white/70" aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoComplete="off"
        className="h-11 w-full rounded-xl bg-white/15 pl-10 pr-10 text-[15px] text-white outline-none ring-1 ring-white/20 backdrop-blur placeholder:text-white/60 focus:bg-white/25 focus:ring-2 focus:ring-dorado"
      />
      {cargando ? (
        <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
      ) : value ? (
        <button onClick={() => onChange("")} aria-label="Borrar búsqueda" className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-white/80 hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
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
      className={`flex w-full items-center gap-3 rounded-xl border bg-white px-3 py-2.5 text-left text-[15px] leading-snug shadow-sm transition-all duration-200 active:scale-[.98] ${
        activo ? "border-guinda bg-guinda/5 ring-2 ring-guinda/20" : "border-stone-200 hover:border-stone-300"
      }`}
    >
      {Icono && (
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition ${activo ? "bg-guinda text-white" : "bg-stone-100 text-stone-500"}`}>
          <Icono className="h-[18px] w-[18px]" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">{children}</span>
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full transition ${activo ? "bg-guinda text-white" : "border border-stone-300"}`} aria-hidden>
        {activo && <Check className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}

/** Barra superior delgada y fija. `children` permite poner un buscador dentro de la barra. */
export function Cabecera({
  paso,
  total,
  titulo,
  subtitulo,
  icono: Icono,
  atras,
  children,
}: {
  paso: number;
  total: number;
  titulo: string;
  subtitulo?: string;
  icono: LucideIcon;
  atras?: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="relative z-30 shrink-0 bg-gradient-to-br from-guinda-oscuro via-guinda to-guinda-oscuro px-3 pb-4 pt-[max(.5rem,env(safe-area-inset-top))] text-white">
      <div className="flex items-center gap-2">
        {atras ? (
          <button onClick={atras} aria-label="Volver" className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-white/10 active:bg-white/20">
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center">
            <Icono className="h-5 w-5 text-dorado" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[17px] font-bold leading-tight">{titulo}</h1>
          {subtitulo && <p className="truncate text-xs leading-tight text-white/70">{subtitulo}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium">
          {paso}/{total}
        </span>
      </div>
      {children && <div className="mt-2.5">{children}</div>}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={paso}>
        <div className="h-full rounded-r-full bg-dorado transition-all duration-500 ease-out" style={{ width: `${(paso / total) * 100}%` }} />
      </div>
    </header>
  );
}

/** Zona blanca que ocupa el resto de la pantalla; el scroll ocurre dentro de ella */
export function Hoja({ children }: { children: ReactNode }) {
  return <main className="relative -mt-2 flex min-h-0 flex-1 flex-col rounded-t-3xl bg-stone-50">{children}</main>;
}

export function Barra({ children }: { children: ReactNode }) {
  return (
    <footer className="shrink-0 border-t border-stone-200/70 bg-white px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2.5">
      <div className="mx-auto flex max-w-xl gap-3">{children}</div>
    </footer>
  );
}

export function Aviso({ tipo = "error", children }: { tipo?: "error" | "info" | "ok"; children: ReactNode }) {
  const c = { error: "bg-red-50 text-red-700 ring-red-200", info: "bg-amber-50 text-amber-800 ring-amber-200", ok: "bg-emerald-50 text-emerald-800 ring-emerald-200" }[tipo];
  return (
    <div role={tipo === "error" ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-xs leading-snug ring-1 ${c}`}>
      {children}
    </div>
  );
}
