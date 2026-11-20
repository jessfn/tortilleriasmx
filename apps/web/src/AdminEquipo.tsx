import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, CalendarCheck, Download, Landmark, Loader2, Search, Store, UserCheck, Users } from "lucide-react";
import { textoEstadoCuenta } from "@tortillerias/shared";
import { api, apiDescargar } from "./api";
import { Aviso, Tarjeta, Vacio } from "./ui";
import { SelectorFiltro } from "./Filtros";

type Fila = {
  id: string; nombre: string; apellidos: string; correo: string | null; estado_cuenta: string; activo: boolean; estado: string | null;
  capturas: number; hoy: number; siete_dias: number; tortillerias: number; ultima_captura: string | null;
};
type Datos = {
  indicadores: { autorizados: number; censadores_hoy: number; capturas_hoy: number; capturas_7d: number; denue_total: number; denue_visitadas: number; avance_censo: number };
  censadores: Fila[];
  puedeExportar: boolean;
};
type Estado = { clave: string; nombre: string };
const num = (n: number) => n.toLocaleString("es-MX");
const ORDENES = [["capturas", "Más capturas"], ["hoy", "Capturaron hoy"], ["siete", "Últimos 7 días"], ["ultima", "Última captura"], ["tiendas", "Más tortillerías"], ["nombre", "Nombre"]] as const;

/** Mi equipo (solo lectura): indicadores del estado y la tabla de sus censadores. Exportar a CSV (sin CURP) solo si la cuenta puede descargar. */
export default function AdminEquipo({ estadosPermitidos }: { estadosPermitidos?: string[] | null }) {
  const [datos, setDatos] = useState<Datos>();
  const [estados, setEstados] = useState<Estado[]>([]);
  const [estado, setEstado] = useState("");
  const [orden, setOrden] = useState("capturas");
  const [q, setQ] = useState("");
  const [qEnviada, setQEnviada] = useState("");
  const [error, setError] = useState("");
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    api<Estado[]>("/estados").then((e) => setEstados(estadosPermitidos ? e.filter((x) => estadosPermitidos.includes(x.clave)) : e)).catch(() => {});
  }, [estadosPermitidos?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = window.setTimeout(() => setQEnviada(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const consulta = useMemo(() => {
    const p = new URLSearchParams({ orden });
    if (estado) p.set("estado", estado);
    if (qEnviada) p.set("q", qEnviada);
    return p.toString();
  }, [estado, orden, qEnviada]);

  useEffect(() => {
    let vigente = true;
    const cargar = () => api<Datos>(`/admin/equipo?${consulta}`).then((d) => vigente && (setDatos(d), setError(""))).catch((e) => vigente && setError(e.message));
    cargar();
    const t = window.setInterval(cargar, 30_000); // se actualiza solo
    return () => { vigente = false; window.clearInterval(t); };
  }, [consulta]);

  async function exportar() {
    setDescargando(true);
    try {
      await apiDescargar(`/admin/equipo/exportar?${consulta}`, "mi-equipo.csv");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDescargando(false);
    }
  }

  const i = datos?.indicadores;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-verde/10 text-verde"><Users className="h-[18px] w-[18px]" aria-hidden /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="text-base font-bold">Mi equipo</h2>
          <p className="text-xs text-stone-500">Cómo va el trabajo de los censadores de tu estado (solo consulta).</p>
        </div>
        {datos?.puedeExportar && (
          <button onClick={exportar} disabled={descargando || !datos.censadores.length} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-stone-700 ring-1 ring-stone-200 hover:ring-guinda/40 disabled:opacity-50">
            {descargando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />} Descargar CSV
          </button>
        )}
      </div>
      {error && <Aviso>{error}</Aviso>}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {[
          ["Censadores autorizados", i && num(i.autorizados), UserCheck, ""],
          ["Capturaron hoy", i && num(i.censadores_hoy), CalendarCheck, ""],
          ["Capturas de hoy", i && num(i.capturas_hoy), Store, ""],
          ["Capturas, últimos 7 días", i && num(i.capturas_7d), Store, ""],
          ["Avance del censo", i && `${i.avance_censo.toLocaleString("es-MX", { maximumFractionDigits: 2 })} %`, Landmark, i ? `${num(i.denue_visitadas)} de ${num(i.denue_total)} tortillerías` : ""],
        ].map(([t, v, Icono, sub]) => {
          const I = Icono as typeof Store;
          return (
            <Tarjeta key={t as string} className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500"><I className="h-3.5 w-3.5 shrink-0 text-guinda" aria-hidden /><span className="leading-tight">{t as string}</span></div>
              <div className="mt-1 text-2xl font-bold leading-tight text-guinda">{(v as string | undefined) ?? "–"}</div>
              {sub ? <div className="text-[11px] text-stone-400">{sub as string}</div> : null}
            </Tarjeta>
          );
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_14rem_14rem]">
        <label className="relative block min-w-0">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-stone-400" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre o correo" aria-label="Buscar censadores" className="h-11 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-3 text-base shadow-sm outline-none focus:border-guinda focus:ring-4 focus:ring-guinda/10" />
        </label>
        {estados.length > 1 ? (
          <SelectorFiltro icono={Landmark} etiqueta="Estado" valor={estado} activo={!!estado} alCambiar={setEstado} opciones={[{ valor: "", texto: "Todos mis estados" }, ...estados.map((e) => ({ valor: e.clave, texto: e.nombre }))]} />
        ) : <span />}
        <SelectorFiltro icono={ArrowUpDown} etiqueta="Ordenar" valor={orden} activo={orden !== "capturas"} alCambiar={setOrden} opciones={ORDENES.map(([v, t]) => ({ valor: v, texto: t }))} />
      </div>

      <Tarjeta className="overflow-hidden !p-0">
        {!datos ? (
          <div className="grid place-items-center py-16 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : datos.censadores.length === 0 ? (
          <Vacio icono={Users} titulo="Sin censadores" texto={qEnviada ? "No hay resultados con esa búsqueda." : "Todavía no hay censadores en tu estado."} />
        ) : (
          <>
            {/* Computadora y tableta */}
            <div className="hidden max-h-[calc(100dvh-26rem)] min-h-[14rem] overflow-auto md:block">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="sticky top-0 z-10 bg-stone-50 text-xs text-stone-500 shadow-[0_1px_0_#e7e5e4]">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Censador</th>
                    <th className="px-3 py-2 text-left font-semibold">Cuenta</th>
                    <th className="px-3 py-2 text-left font-semibold">Última captura</th>
                    <th className="px-3 py-2 text-right font-semibold">Hoy</th>
                    <th className="px-3 py-2 text-right font-semibold">7 días</th>
                    <th className="px-3 py-2 text-right font-semibold">Totales</th>
                    <th className="px-3 py-2 text-right font-semibold">Tortillerías</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.censadores.map((c) => (
                    <tr key={c.id} className="border-t border-stone-100">
                      <td className="max-w-[16rem] px-3 py-2"><span className="block truncate font-semibold">{`${c.nombre} ${c.apellidos}`.trim() || c.correo}</span><span className="block truncate text-xs text-stone-500">{c.correo}{c.estado ? ` · ${c.estado}` : ""}</span></td>
                      <td className="px-3 py-2"><EtiquetaCuenta c={c} /></td>
                      <td className="px-3 py-2 text-stone-600">{c.ultima_captura ?? "Nunca"}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{num(c.hoy)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(c.siete_dias)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(c.capturas)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(c.tortillerias)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Teléfono */}
            <ul className="divide-y divide-stone-100 md:hidden">
              {datos.censadores.map((c) => (
                <li key={c.id} className="space-y-1.5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate font-semibold leading-tight">{`${c.nombre} ${c.apellidos}`.trim() || c.correo}</p><p className="truncate text-xs text-stone-500">{c.correo}</p></div>
                    <EtiquetaCuenta c={c} />
                  </div>
                  <div className="grid grid-cols-4 gap-1 text-center text-[11px] text-stone-500">
                    {[["Hoy", c.hoy], ["7 días", c.siete_dias], ["Totales", c.capturas], ["Tiendas", c.tortillerias]].map(([t, v]) => (
                      <div key={t as string} className="rounded-lg bg-stone-50 py-1.5"><b className="block text-base text-stone-800">{num(v as number)}</b>{t as string}</div>
                    ))}
                  </div>
                  <p className="text-[11px] text-stone-400">Última captura: {c.ultima_captura ?? "nunca"}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Tarjeta>
    </div>
  );
}

function EtiquetaCuenta({ c }: { c: Fila }) {
  const color = !c.activo ? "bg-stone-100 text-stone-600 ring-stone-200" : c.estado_cuenta === "autorizado" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : c.estado_cuenta === "rechazado" ? "bg-red-50 text-red-700 ring-red-200" : "bg-amber-50 text-amber-700 ring-amber-200";
  return <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${color}`}>{!c.activo ? "Desactivado" : textoEstadoCuenta(c.estado_cuenta)}</span>;
}
