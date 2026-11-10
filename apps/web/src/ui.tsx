import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Check, ChevronDown, ChevronLeft, Search, X, type LucideIcon } from "lucide-react";

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

/** Selector con el mismo aspecto que Campo (lista nativa: en el celular abre el selector del sistema) */
export function Selector({
  etiqueta,
  icono: Icono,
  error,
  ayuda,
  opciones,
  placeholder,
  ...p
}: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string; icono?: LucideIcon; error?: string; ayuda?: string; opciones: { valor: string; texto: string }[]; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-stone-600">{etiqueta}</span>
      <span className="relative block">
        {Icono && <Icono className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-stone-400" aria-hidden />}
        <select
          {...p}
          className={`h-12 w-full appearance-none rounded-xl border bg-white pr-10 text-base shadow-sm outline-none transition focus:ring-4 ${Icono ? "pl-11" : "pl-3.5"} ${
            error ? "border-red-400 focus:ring-red-100" : "border-stone-200 focus:border-guinda focus:ring-guinda/10"
          } ${p.value ? "text-stone-900" : "text-stone-400"}`}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {opciones.map((o) => (
            <option key={o.valor} value={o.valor} className="text-stone-900">
              {o.texto}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-stone-400" aria-hidden />
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
export function Hoja({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`relative z-10 -mt-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-[1.75rem] bg-stone-50 shadow-[0_-6px_18px_-6px_rgba(0,0,0,.35)] ${className}`}>{children}</main>;
}

export function Barra({ children }: { children: ReactNode }) {
  return (
    <footer className="shrink-0 bg-stone-50 px-3 pb-[max(.5rem,calc(var(--sb)*.35))] pt-2.5">
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

/** Cada sección tiene su color: se ve en el encabezado y en la barra, para saber en cuál estás */
export type TonoNav = "guinda" | "dorado" | "verde";
export type PestañaNav = { id: string; texto: string; icono: LucideIcon; insignia?: number; tono?: TonoNav };
const TONOS: Record<TonoNav, { chip: string; activo: string; fondo: string }> = {
  guinda: { chip: "bg-[#a02c5a]", activo: "text-[#a02c5a] lg:bg-[#a02c5a]/10", fondo: "bg-[#a02c5a]/10" },
  dorado: { chip: "bg-[#b8791a]", activo: "text-[#b8791a] lg:bg-[#b8791a]/10", fondo: "bg-[#b8791a]/10" },
  verde: { chip: "bg-[#2f8a6b]", activo: "text-[#2f8a6b] lg:bg-[#2f8a6b]/10", fondo: "bg-[#2f8a6b]/10" },
};

export function PanelShell({
  titulo,
  inicial,
  derecha,
  pestañas,
  activa,
  alCambiar,
  completo,
  plano,
  children,
}: {
  titulo: string;
  /** Inicial de la persona, en un círculo a la derecha del encabezado */
  inicial?: string;
  derecha?: ReactNode;
  pestañas: PestañaNav[];
  activa: string;
  alCambiar: (id: string) => void;
  /** Administración: en computadora y tableta ocupa toda la pantalla (sin tarjeta flotante) */
  completo?: boolean;
  /** La pestaña activa ocupa toda el área (mapa), sin márgenes ni scroll de página */
  plano?: boolean;
  children: ReactNode;
}) {
  const actual = pestañas.find((p) => p.id === activa);
  return (
    <div
      className={`${completo ? "md:max-w-none lg:w-full" : "marco-pc lg:max-w-6xl"} mx-auto flex h-dvh max-w-xl flex-col overflow-hidden bg-guinda-oscuro lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]`}
    >
      <header className={`relative shrink-0 bg-guinda-oscuro px-5 pb-10 lg:col-span-2 lg:px-8 ${completo ? "lg:pb-4 lg:pt-4" : "lg:pb-9"} pt-[max(1.25rem,env(safe-area-inset-top))] text-white`}>
        <div className="flex items-center gap-4">
          <span key={activa} className={`paso grid h-12 w-12 shrink-0 place-items-center rounded-full text-white shadow-md ring-4 ring-white/15 ${TONOS[actual?.tono ?? "guinda"].chip}`}>
            {actual && <actual.icono className="h-[22px] w-[22px]" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[.2em] text-dorado">TortilleríasMX</p>
            <h1 className="truncate font-patria text-2xl font-normal">{titulo}</h1>
          </div>
          {derecha}
          {inicial && <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-dorado/70 bg-white/5 text-base font-semibold uppercase text-dorado">{inicial}</span>}
        </div>
      </header>
      <Hoja className="lg:col-start-2 lg:row-start-2 lg:mt-0 lg:rounded-none lg:shadow-none">
        <div
          key={activa}
          className={`paso min-h-0 flex-1 ${plano ? "relative overflow-hidden" : "overflow-y-auto overscroll-contain px-3 pb-3 pt-5 lg:px-8 lg:pb-8 lg:pt-8"}`}
        >
          <div className={plano ? "h-full w-full" : `mx-auto w-full space-y-3 ${completo ? "max-w-[92rem]" : "max-w-3xl"}`}>{children}</div>
        </div>
      </Hoja>
      <nav className="shrink-0 bg-stone-50 pb-[max(.125rem,calc(var(--sb)*.3))] shadow-[0_-10px_20px_-14px_rgba(0,0,0,.3)] lg:col-start-1 lg:row-start-2 lg:border-r lg:border-stone-200/70 lg:bg-white lg:p-3 lg:shadow-none" aria-label="Secciones">
        <ul className="mx-auto flex max-w-xl lg:max-w-none lg:flex-col lg:gap-1">
          {pestañas.map((p) => {
            const on = p.id === activa;
            return (
              <li key={p.id} className="flex-1">
                <button
                  onClick={() => alCambiar(p.id)}
                  aria-current={on ? "page" : undefined}
                  className={`relative flex w-full flex-col items-center gap-0 py-1.5 text-[11px] font-semibold transition lg:flex-row lg:gap-3 lg:rounded-xl lg:px-3 lg:py-2.5 lg:text-sm lg:hover:bg-stone-100 ${on ? TONOS[p.tono ?? "guinda"].activo : "text-stone-400 lg:text-stone-600"}`}
                >
                  <span className={`grid h-8 w-14 place-items-center rounded-full transition-all lg:h-auto lg:w-auto ${on ? `${TONOS[p.tono ?? "guinda"].fondo} lg:bg-transparent` : ""}`}>
                    <p.icono className="h-5 w-5" aria-hidden />
                  </span>
                  {p.texto}
                  {!!p.insignia && (
                    <span className="absolute right-[calc(50%-1.6rem)] top-1 lg:static lg:ml-auto lg:mr-1 grid h-4 min-w-4 place-items-center rounded-full bg-guinda px-1 text-[10px] text-white">{p.insignia}</span>
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
      <span className={`grid h-10 w-10 place-items-center rounded-full ${t}`}>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] md:items-center md:p-6" onClick={alCerrar} role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="paso flex max-h-[88dvh] w-full max-w-xl flex-col rounded-t-3xl bg-stone-50 shadow-2xl md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 items-center gap-2 border-b border-stone-200 px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-base font-bold">{titulo}</h2>
          <button onClick={alCerrar} aria-label="Cerrar" className="grid h-9 w-9 place-items-center rounded-full hover:bg-stone-200">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,calc(var(--sb)*.35))]">{children}</div>
      </div>
    </div>
  );
}
