import { ChevronDown, Search, X, type LucideIcon } from "lucide-react";

/** Lista desplegable con ícono para ordenar o filtrar (en el celular abre el selector del sistema) */
export function SelectorFiltro({
  icono: Icono, etiqueta, valor, opciones, alCambiar, activo,
}: { icono: LucideIcon; etiqueta: string; valor: string; opciones: { valor: string; texto: string }[]; alCambiar: (v: string) => void; activo?: boolean }) {
  return (
    <label className="relative block min-w-0">
      <span className="sr-only">{etiqueta}</span>
      <Icono className={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${activo ? "text-guinda" : "text-stone-400"}`} aria-hidden />
      <select
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        aria-label={etiqueta}
        className={`h-11 w-full appearance-none truncate rounded-xl border bg-white pl-9 pr-8 text-sm shadow-sm outline-none transition focus:border-guinda focus:ring-4 focus:ring-guinda/10 ${activo ? "border-guinda/50 font-semibold text-guinda" : "border-stone-200 text-stone-700"}`}
      >
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>{o.texto}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
    </label>
  );
}

/** Caja de búsqueda con botón para borrar */
export function Buscador({ valor, alCambiar, placeholder, etiqueta }: { valor: string; alCambiar: (v: string) => void; placeholder: string; etiqueta: string }) {
  return (
    <label className="relative block min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-stone-400" aria-hidden />
      <input
        type="text"
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        placeholder={placeholder}
        aria-label={etiqueta}
        className="h-11 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-10 text-base shadow-sm outline-none focus:border-guinda focus:ring-4 focus:ring-guinda/10"
      />
      {valor && (
        <button type="button" onClick={() => alCambiar("")} aria-label="Borrar la búsqueda" className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-stone-400 hover:bg-stone-100">
          <X className="h-4 w-4" />
        </button>
      )}
    </label>
  );
}
