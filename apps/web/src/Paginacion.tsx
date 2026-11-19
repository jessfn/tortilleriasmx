import { ChevronLeft, ChevronRight } from "lucide-react";

export type Pagina<T> = { filas: T[]; total: number; pagina: number; paginas: number; limite: number };
export const POR_PAGINA = [25, 50, 100];

/** Pie de las listas largas: "Mostrando 1–50 de 312", filas por página y botones de página anterior y siguiente */
export function Paginacion({
  total, pagina, paginas, limite, alPagina, alLimite,
}: { total: number; pagina: number; paginas: number; limite: number; alPagina: (n: number) => void; alLimite: (n: number) => void }) {
  const desde = total === 0 ? 0 : (pagina - 1) * limite + 1;
  const hasta = Math.min(pagina * limite, total);
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-stone-200 bg-white px-3 py-2 text-xs text-stone-500">
      <span>{total === 0 ? "Sin registros" : <>Mostrando <b className="text-stone-700">{desde}–{hasta}</b> de <b className="text-stone-700">{total}</b></>}</span>
      <div className="flex items-center gap-3">
        <label className="hidden items-center gap-1.5 sm:flex">
          Por página
          <select value={limite} onChange={(e) => alLimite(Number(e.target.value))} className="rounded-lg border border-stone-200 bg-white px-1.5 py-1 text-xs text-stone-700">
            {POR_PAGINA.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button onClick={() => alPagina(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior" className="grid h-8 w-8 place-items-center rounded-lg bg-stone-100 text-stone-700 transition active:scale-95 disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[5.5rem] text-center font-medium text-stone-700">Página {pagina} de {paginas}</span>
          <button onClick={() => alPagina(pagina + 1)} disabled={pagina >= paginas} aria-label="Página siguiente" className="grid h-8 w-8 place-items-center rounded-lg bg-stone-100 text-stone-700 transition active:scale-95 disabled:opacity-40">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </footer>
  );
}
