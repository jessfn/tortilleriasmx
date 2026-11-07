import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Check, ChevronLeft, Search, X, type LucideIcon } from "lucide-react";

// NOTA: los campos de texto usan 16 px (text-base) a propósito: con menos, iOS hace zoom al enfocarlos.

export function Boton({
  variante = "primario",
  icono: Icono,
  className = "",
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "primario" | "secundario" | "fantasma" | "peligro"; icono?: LucideIcon }) {
  const base =
    "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-semibold transition-all duration-200 active:scale-[.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
  const v = {
    primario: "bg-gradient-to-r from-guinda to-guinda-oscuro text-white shadow-md shadow-guinda/25",
    secundario: "bg-white text-guinda shadow-sm ring-1 ring-stone-200 hover:ring-guinda/40",
    fantasma: "text-stone-600 hover:bg-stone-100",
    peligro: "bg-white text-red-600 shadow-sm ring-1 ring-red-200 hover:bg-red-50",
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
  derecha,
  valido,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; icono?: LucideIcon; error?: string; ayuda?: string; derecha?: ReactNode; valido?: boolean }) {
  const lleno = valido && !error && !derecha && String(p.value ?? "") !== "";
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-stone-600">{etiqueta}</span>
      <span className="relative block">
        {Icono && <Icono className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-stone-400" aria-hidden />}
        <input
          {...p}
          className={`h-12 w-full rounded-xl border bg-white text-base shadow-sm outline-none transition placeholder:text-stone-400 focus:ring-4 ${Icono ? "pl-11" : "pl-3.5"} ${derecha || lleno ? "pr-12" : "pr-3.5"} ${
            error ? "border-red-400 focus:ring-red-100" : lleno ? "border-emerald-400 focus:border-emerald-500 focus:ring-emerald-100" : "border-stone-200 focus:border-guinda focus:ring-guinda/10"
          }`}
        />
        {lleno && <Check className="pointer-events-none absolute right-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-emerald-500" strokeWidth={3} aria-hidden />}
        {derecha &&<span className="absolute right-1.5 top-1/2 -translate-y-1/2">{derecha}</span>}
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
        className="h-11 w-full rounded-xl bg-white/15 pl-10 pr-10 text-base text-white outline-none ring-1 ring-white/20 backdrop-blur placeholder:text-white/60 focus:bg-white/25 focus:ring-2 focus:ring-dorado"
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
    <header className="relative shrink-0 bg-gradient-to-b from-guinda-oscuro from-35% to-guinda px-3 pb-7 pt-[max(.5rem,env(safe-area-inset-top))] text-white">
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
      {/* Barra de avance dentro de la barra, con aire arriba y abajo (no toca el borde) */}
      <div className="mx-1 mt-3 h-1.5 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={paso}>
        <div className="h-full rounded-full bg-dorado transition-all duration-500 ease-out" style={{ width: `${(paso / total) * 100}%` }} />
      </div>
    </header>
  );
}

/** Zona clara que ocupa el resto de la pantalla; el scroll ocurre dentro de ella */
export function Hoja({ children }: { children: ReactNode }) {
  return <main className="relative z-10 -mt-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[1.75rem] bg-stone-50 shadow-[0_-6px_18px_-6px_rgba(0,0,0,.35)]">{children}</main>;
}

export function Barra({ children }: { children: ReactNode }) {
  return (
    <footer className="shrink-0 bg-stone-50 px-3 pb-[max(.75rem,calc(env(safe-area-inset-bottom)*.6))] pt-2.5">
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

/* ---------- Estructura de los paneles (usuario y administración) ---------- */

export type PestañaNav = { id: string; texto: string; icono: LucideIcon; insignia?: number };

export function PanelShell({
  titulo,
  subtitulo,
  derecha,
  pestañas,
  activa,
  alCambiar,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  derecha?: ReactNode;
  pestañas: PestañaNav[];
  activa: string;
  alCambiar: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex h-dvh max-w-xl flex-col overflow-hidden bg-guinda-oscuro">
      <header className="relative shrink-0 bg-gradient-to-b from-guinda-oscuro from-35% to-guinda px-4 pb-6 pt-[max(.75rem,env(safe-area-inset-top))] text-white">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[.2em] text-dorado">TortilleríasMX</p>
            <h1 className="truncate text-xl font-bold leading-tight">{titulo}</h1>
            {subtitulo && <p className="truncate text-xs text-white/70">{subtitulo}</p>}
          </div>
          {derecha}
        </div>
      </header>
      <Hoja>
        <div key={activa} className="paso min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 pb-3 pt-5">
          {children}
        </div>
      </Hoja>
      <nav className="shrink-0 border-t border-stone-200/70 bg-white pb-[max(.25rem,calc(env(safe-area-inset-bottom)*.6))]" aria-label="Secciones">
        <ul className="mx-auto flex max-w-xl">
          {pestañas.map((p) => {
            const on = p.id === activa;
            return (
              <li key={p.id} className="flex-1">
                <button
                  onClick={() => alCambiar(p.id)}
                  aria-current={on ? "page" : undefined}
                  className={`relative flex w-full flex-col items-center gap-0.5 py-2 text-[11px] font-semibold transition ${on ? "text-guinda" : "text-stone-400"}`}
                >
                  <span className={`grid h-8 w-14 place-items-center rounded-full transition-all ${on ? "bg-guinda/10" : ""}`}>
                    <p.icono className="h-5 w-5" aria-hidden />
                  </span>
                  {p.texto}
                  {!!p.insignia && (
                    <span className="absolute right-[calc(50%-1.6rem)] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-guinda px-1 text-[10px] text-white">{p.insignia}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function Tarjeta({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200 ${className}`}>{children}</div>;
}

export function Dato({ icono: Icono, etiqueta, valor, tono = "guinda" }: { icono: LucideIcon; etiqueta: string; valor: ReactNode; tono?: "guinda" | "verde" | "dorado" | "gris" }) {
  const t = { guinda: "bg-guinda/10 text-guinda", verde: "bg-verde/10 text-verde", dorado: "bg-dorado/15 text-[#8a6a35]", gris: "bg-stone-100 text-stone-500" }[tono];
  return (
    <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
      <span className={`grid h-9 w-9 place-items-center rounded-xl ${t}`}>
        <Icono className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="mt-2 text-2xl font-bold leading-none">{valor}</div>
      <div className="mt-1 text-xs text-stone-500">{etiqueta}</div>
    </div>
  );
}

export function Insignia({ estatus }: { estatus: string }) {
  const m: Record<string, [string, string]> = {
    pendiente: ["En revisión", "bg-amber-50 text-amber-700 ring-amber-200"],
    validada: ["Aprobada", "bg-emerald-50 text-emerald-700 ring-emerald-200"],
    rechazada: ["Rechazada", "bg-red-50 text-red-700 ring-red-200"],
  };
  const [t, c] = m[estatus] ?? [estatus, "bg-stone-100 text-stone-600 ring-stone-200"];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${c}`}>{t}</span>;
}

export function Vacio({ icono: Icono, titulo, texto }: { icono: LucideIcon; titulo: string; texto?: string }) {
  return (
    <div className="grid place-items-center px-6 py-12 text-center text-stone-500">
      <span className="grid h-16 w-16 place-items-center rounded-3xl bg-stone-100">
        <Icono className="h-8 w-8" aria-hidden />
      </span>
      <p className="mt-3 font-semibold text-stone-700">{titulo}</p>
      {texto && <p className="mt-1 max-w-xs text-sm">{texto}</p>}
    </div>
  );
}

/** Hoja inferior (modal) para ver detalles */
export function HojaModal({ titulo, alCerrar, children }: { titulo: string; alCerrar: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && alCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [alCerrar]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px]" onClick={alCerrar} role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="paso flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-3xl bg-stone-50 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-base font-bold">{titulo}</h2>
          <button onClick={alCerrar} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full hover:bg-stone-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,calc(env(safe-area-inset-bottom)*.6))]">{children}</div>
      </div>
    </div>
  );
}
