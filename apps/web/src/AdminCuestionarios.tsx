import { useEffect, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, ClipboardX, FileSpreadsheet, Loader2, Lock, MapPin, Search } from "lucide-react";
import { CUESTIONARIO_VERSION, textoMotivoNoAplica } from "@tortillerias/shared";
import { api, apiDescargar } from "./api";
import { BarraValor, entero, EnVivo, useVivo } from "./AdminVivo";
import CuestionarioAdmin from "./CuestionarioAdmin";
import { Aviso, HojaModal, Tarjeta, Vacio } from "./ui";

type Zona = { clave: string; nombre: string; visitadas: number; aplicados: number; porcentaje: number };
type Indicadores = { nacional: { visitadas: number; aplicados: number; no_aplicados: number; porcentaje: number }; estados: Zona[]; municipios: Zona[] | null; motivos: { motivo: string; n: number }[] };
type Situacion = "aplicado" | "no_aplicado" | "falta";
type Fila = { id: string; nombre: string; domicilio: string | null; estado: string | null; municipio: string | null; situacion: Situacion; fecha: string | null; motivo: string | null; censador: string | null };
type Pagina = { total: number; pagina: number; paginas: number; filas: Fila[] };

const FILTROS: [string, string][] = [["", "Todas"], ["aplicado", "Aplicado"], ["no_aplicado", "No se pudo aplicar"], ["falta", "Falta"]];
const fecha = (s: string) => new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

/**
 * Vista "Cuestionarios" (C21): avance, indicadores, la lista de tortillerías visitadas con su cuestionario y la descarga.
 * Es un permiso RESERVADO (ver_cuestionarios): nadie lo tiene por su rol, solo la cuenta a la que se le marca. La API lo vuelve a revisar.
 */
export default function AdminCuestionarios() {
  const [estado, setEstado] = useState<Zona>();
  const [ind, setInd] = useState<Indicadores>();
  const [filtro, setFiltro] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [pagina, setPagina] = useState(1);
  const [lista, setLista] = useState<Pagina>();
  const [abierta, setAbierta] = useState<Fila>();
  const [error, setError] = useState("");
  const [bajando, setBajando] = useState<"" | "datos" | "dic">("");

  const vivo = useVivo(async () => {
    setInd(await api<Indicadores>(`/admin/cuestionarios/indicadores${estado ? `?estado=${estado.clave}` : ""}`));
  }, 60_000, [estado?.clave]);

  useEffect(() => {
    const t = window.setTimeout(() => { setQ(busqueda.trim()); setPagina(1); }, 300);
    return () => window.clearTimeout(t);
  }, [busqueda]);
  useEffect(() => setPagina(1), [estado?.clave, filtro]);
  useEffect(() => {
    let vigente = true;
    const p = new URLSearchParams({ pagina: String(pagina), limite: "25" });
    if (estado) p.set("estado", estado.clave);
    if (filtro) p.set("estatus", filtro);
    if (q) p.set("q", q);
    setLista(undefined);
    api<Pagina>(`/admin/cuestionarios?${p}`).then((r) => vigente && (setLista(r), setError(""))).catch((e) => vigente && setError(e.message));
    return () => { vigente = false; };
  }, [estado?.clave, filtro, q, pagina]);

  async function bajar(cual: "datos" | "dic") {
    setBajando(cual);
    setError("");
    try {
      if (cual === "dic") await apiDescargar("/admin/exportar/cuestionarios/diccionario", `cuestionarios-diccionario-${CUESTIONARIO_VERSION}.csv`);
      else await apiDescargar(`/admin/exportar/cuestionarios${estado ? `?estado=${estado.clave}` : ""}`, "cuestionarios.csv");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBajando("");
    }
  }

  const z = estado ? ind?.estados.find((e) => e.clave === estado.clave) : ind?.nacional;
  const zonas = (estado ? ind?.municipios : ind?.estados) ?? [];
  const noAplicados = ind?.motivos.reduce((a, m) => a + m.n, 0) ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-guinda/10 text-guinda"><ClipboardList className="h-[18px] w-[18px]" aria-hidden /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="text-base font-bold">Cuestionarios</h2>
          <nav aria-label="Ubicación" className="flex min-w-0 items-center gap-1 text-xs text-stone-500">
            <button onClick={() => setEstado(undefined)} className={estado ? "font-semibold text-guinda hover:underline" : "font-semibold"}>Todos los estados</button>
            {estado && <><ChevronRight className="h-3.5 w-3.5" aria-hidden /><span className="truncate font-semibold text-stone-700">{estado.nombre}</span></>}
          </nav>
        </div>
        <EnVivo ultima={vivo.ultima} fallo={vivo.fallo} />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => bajar("dic")} disabled={!!bajando} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-stone-700 ring-1 ring-stone-200 hover:ring-guinda/40 disabled:opacity-60">
            {bajando === "dic" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BookOpen className="h-4 w-4" aria-hidden />} Diccionario de datos
          </button>
          <button onClick={() => bajar("datos")} disabled={!!bajando} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-guinda px-3 text-xs font-semibold text-white shadow-sm active:scale-95 disabled:opacity-60">
            {bajando === "datos" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="h-4 w-4" aria-hidden />} Descargar cuestionarios (CSV)
          </button>
        </div>
      </div>
      <p className="flex items-center gap-1.5 rounded-xl bg-dorado/10 px-3 py-2 text-xs text-stone-700 ring-1 ring-dorado/30">
        <Lock className="h-3.5 w-3.5 shrink-0 text-[#7a5a1f]" aria-hidden /> Información sensible con acceso restringido. Abrir un cuestionario y cada descarga quedan en la auditoría. La descarga no incluye RFC, razón social, celular ni CURP.
      </p>
      {error && <Aviso>{error}</Aviso>}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          ["Con cuestionario", z ? `${z.porcentaje} %` : "–", z ? `${entero(z.aplicados)} de ${entero(z.visitadas)} visitadas` : "", "text-guinda"],
          ["Aplicados", z ? entero(z.aplicados) : "–", "tortillerías con cuestionario vigente", "text-emerald-700"],
          ["Faltan", z ? entero(Math.max(0, z.visitadas - z.aplicados)) : "–", "visitadas sin cuestionario aplicado", "text-[#7a5a1f]"],
          ["No se pudo aplicar", ind ? entero(noAplicados) : "–", "en el último intento (sin uno aplicado)", "text-amber-700"],
        ].map(([t, v, s, c]) => (
          <Tarjeta key={t} className="min-w-0">
            <div className="text-xs font-medium text-stone-500">{t}</div>
            <div className={`mt-0.5 text-2xl font-bold leading-tight ${c}`}>{v}</div>
            <div className="text-[11px] text-stone-400">{s}</div>
          </Tarjeta>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* Lista de tortillerías visitadas con su cuestionario */}
        <Tarjeta className="min-w-0 space-y-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden />
              <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar tortillería o municipio" aria-label="Buscar" className="h-10 w-full rounded-xl border border-stone-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-guinda focus:ring-4 focus:ring-guinda/10" />
            </label>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-stone-200/70 p-1 sm:flex" role="tablist" aria-label="Estatus">
              {FILTROS.map(([v, t]) => (
                <button key={v} role="tab" aria-selected={filtro === v} onClick={() => setFiltro(v)} className={`min-h-8 rounded-lg px-2 text-[11px] font-semibold leading-tight transition sm:px-3 sm:text-xs ${filtro === v ? "bg-white text-guinda shadow" : "text-stone-500"}`}>{t}</button>
              ))}
            </div>
          </div>
          {!lista ? (
            <div className="grid place-items-center py-12 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : lista.filas.length === 0 ? (
            <Vacio icono={ClipboardList} titulo="Sin tortillerías" texto={q || filtro ? "No hay resultados con esos filtros." : "Todavía no hay tortillerías visitadas."} />
          ) : (
            <ul className="divide-y divide-stone-100">
              {lista.filas.map((f) => (
                <li key={f.id}>
                  <button onClick={() => f.situacion !== "falta" && setAbierta(f)} disabled={f.situacion === "falta"} className="flex w-full items-center gap-3 py-2.5 text-left enabled:hover:bg-guinda/5 disabled:cursor-default">
                    <Etiqueta s={f.situacion} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{f.nombre}</span>
                      <span className="flex items-center gap-1 truncate text-xs text-stone-500"><MapPin className="h-3 w-3 shrink-0" aria-hidden /> {[f.municipio, f.estado].filter(Boolean).join(", ") || f.domicilio || "Sin ubicación"}</span>
                      {f.situacion === "no_aplicado" && <span className="block truncate text-xs text-amber-700">{textoMotivoNoAplica(f.motivo)}</span>}
                    </span>
                    <span className="hidden shrink-0 text-right text-xs text-stone-500 sm:block">
                      {f.fecha && <span className="block">{fecha(f.fecha)}</span>}
                      {f.censador && <span className="block max-w-[12rem] truncate text-stone-400">{f.censador}</span>}
                    </span>
                    {f.situacion !== "falta" && <ChevronRight className="h-4 w-4 shrink-0 text-stone-300" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lista && (
            <div className="flex items-center justify-between gap-2 border-t border-stone-100 pt-2 text-xs text-stone-500">
              <span>{entero(lista.total)} {lista.total === 1 ? "tortillería" : "tortillerías"}</span>
              <span className="flex items-center gap-1">
                <button onClick={() => setPagina(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior" className="grid h-8 w-8 place-items-center rounded-lg bg-stone-100 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <span className="min-w-[5.5rem] text-center">Página {lista.pagina} de {lista.paginas}</span>
                <button onClick={() => setPagina(pagina + 1)} disabled={pagina >= lista.paginas} aria-label="Página siguiente" className="grid h-8 w-8 place-items-center rounded-lg bg-stone-100 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </span>
            </div>
          )}
        </Tarjeta>

        <div className="min-w-0 space-y-3 self-start">
          {/* Avance por estado (o por municipio dentro de un estado) */}
          <Tarjeta className="space-y-2">
            <h3 className="text-sm font-bold">Avance {estado ? "por municipio" : "por estado"}</h3>
            {!ind ? (
              <div className="grid place-items-center py-8 text-stone-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : zonas.length === 0 ? (
              <p className="py-4 text-center text-sm text-stone-500">Sin tortillerías visitadas.</p>
            ) : (
              <ul className="max-h-[26rem] space-y-1 overflow-y-auto pr-1">
                {[...zonas].sort((a, b) => b.porcentaje - a.porcentaje || b.visitadas - a.visitadas).map((e) => (
                  <li key={e.clave}>
                    <button onClick={() => !estado && setEstado(e)} disabled={!!estado} className="block w-full rounded-lg px-1.5 py-1.5 text-left enabled:hover:bg-guinda/5 disabled:cursor-default">
                      <span className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium">{e.nombre ?? e.clave}</span>
                        <span className="shrink-0 tabular-nums text-stone-500"><b className="text-stone-800">{e.porcentaje} %</b> · {entero(e.aplicados)}/{entero(e.visitadas)}</span>
                      </span>
                      <BarraValor valor={e.porcentaje} max={100} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          {!!ind?.motivos.length && (
            <Tarjeta className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-sm font-bold"><ClipboardX className="h-4 w-4 text-amber-700" aria-hidden /> No se pudo aplicar · por motivo</h3>
              <ul className="space-y-1 text-xs">
                {ind.motivos.map((m) => (
                  <li key={m.motivo} className="flex justify-between gap-2"><span className="text-stone-600">{textoMotivoNoAplica(m.motivo)}</span><b className="tabular-nums">{entero(m.n)}</b></li>
                ))}
              </ul>
            </Tarjeta>
          )}
        </div>
      </div>

      {abierta && (
        <HojaModal titulo={abierta.nombre} alCerrar={() => setAbierta(undefined)}>
          <p className="flex items-center gap-1.5 text-xs text-stone-500"><MapPin className="h-3.5 w-3.5" aria-hidden /> {[abierta.municipio, abierta.estado].filter(Boolean).join(", ") || abierta.domicilio}</p>
          <CuestionarioAdmin tortilleriaId={abierta.id} />
        </HojaModal>
      )}
    </>
  );
}

function Etiqueta({ s }: { s: Situacion }) {
  const [t, c, I] = s === "aplicado" ? ["Aplicado", "bg-emerald-50 text-emerald-700 ring-emerald-200", ClipboardCheck] : s === "no_aplicado" ? ["No se pudo", "bg-amber-50 text-amber-700 ring-amber-200", ClipboardX] : ["Falta", "bg-stone-100 text-stone-600 ring-stone-200", ClipboardList];
  return (
    <span className={`inline-flex w-[6.5rem] shrink-0 items-center justify-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ${c}`}>
      <I className="h-3.5 w-3.5" aria-hidden /> {t}
    </span>
  );
}
