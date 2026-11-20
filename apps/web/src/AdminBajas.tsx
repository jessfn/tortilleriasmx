import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpDown, Ban, CalendarDays, ChevronDown, Filter, Landmark, Loader2, MapPin, RotateCcw, Store, Tag, UserRound } from "lucide-react";
import { MOTIVOS_BAJA, textoMotivoBaja } from "@tortillerias/shared";
import { api } from "./api";
import { Aviso, Boton, Tarjeta, Vacio } from "./ui";
import { SelectorFiltro } from "./Filtros";
import { Paginacion, type Pagina } from "./Paginacion";
import MiniMapa from "./MiniMapa";

type Baja = {
  id: string; tortilleria_id: string; nombre: string; domicilio: string | null; estado: string | null; municipio: string | null; operacion: "activa" | "inactiva";
  motivo: string; motivo_otro: string | null; fecha: string; censador: string | null;
  lat: number | null; lng: number | null; reporte_lat: number | null; reporte_lng: number | null; precision_gps: number | null;
  distancia_m: number | null; contradicciones: number; reactivada_en: string | null; reactivada_por: string | null; censador_rechazado?: boolean;
};
type Zona = { clave: string; nombre: string };

const cuando = (s: string) => new Date(s).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
const metros = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
/** Un reporte hecho a más de 500 m del lugar del catálogo merece revisarse */
const LEJOS_M = 500;

/**
 * Bajas ("ya no funciona"): de consulta, no de aprobación. Cada baja ya está aplicada; aquí se ve quién, cuándo y por qué, se ordena lo que
 * merece revisarse (con contradicciones, o reportado lejos del lugar) y, con el permiso, se reactiva.
 */
export default function AdminBajas({ puedeReactivar, alCambio }: { puedeReactivar: boolean; alCambio: () => void }) {
  const [pag, setPag] = useState<Pagina<Baja>>();
  const [error, setError] = useState("");
  const [pagina, setPagina] = useState(1);
  const [limite, setLimite] = useState(50);
  const [estados, setEstados] = useState<Zona[]>([]);
  const [municipios, setMunicipios] = useState<Zona[]>([]);
  const [estado, setEstado] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [motivo, setMotivo] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [orden, setOrden] = useState("recientes");
  const [vigentes, setVigentes] = useState(false);
  const [rechazados, setRechazados] = useState(false);
  const [abierta, setAbierta] = useState<string | null>(null);
  /** en el celular los filtros se pliegan: la lista necesita el espacio */
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const zona = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Zona[]>("/estados").then(setEstados).catch(() => {});
  }, []);
  useEffect(() => {
    setMunicipio("");
    if (!estado) return setMunicipios([]);
    api<Zona[]>(`/estados/${estado}/municipios`).then(setMunicipios).catch(() => setMunicipios([]));
  }, [estado]);

  const [version, setVersion] = useState(0);
  useEffect(() => {
    let vigente = true;
    const p = new URLSearchParams({ pagina: String(pagina), limite: String(limite), orden });
    if (estado) p.set("estado", estado);
    if (municipio) p.set("municipio", municipio);
    if (motivo) p.set("motivo", motivo);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    if (vigentes) p.set("solo", "vigentes");
    if (rechazados) p.set("rechazado", "1");
    api<Pagina<Baja>>(`/admin/bajas?${p}`)
      .then((r) => {
        if (!vigente) return;
        if (!r.filas.length && pagina > 1) return setPagina(Math.max(1, r.paginas));
        setPag(r);
        setError("");
        zona.current?.scrollTo({ top: 0 });
      })
      .catch((e) => vigente && setError(e.message));
    return () => { vigente = false; };
  }, [pagina, limite, estado, municipio, motivo, desde, hasta, orden, vigentes, rechazados, version]);

  const filtrar = (f: () => void) => { f(); setPagina(1); };

  async function reactivar(b: Baja) {
    setTrabajando(b.id);
    setError("");
    try {
      await api(`/admin/tortillerias/${b.tortilleria_id}/operacion`, { metodo: "PATCH", json: { operacion: "activa" } });
      setConfirmar(null);
      setVersion((v) => v + 1);
      alCambio();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(null);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-hidden px-3 pb-3 pt-4 lg:px-6 lg:pb-5">
      <div className="flex shrink-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-50 text-red-700"><Ban className="h-[18px] w-[18px]" aria-hidden /></span>
        <div className="leading-tight">
          <h2 className="text-base font-bold">Tortillerías dadas de baja</h2>
          <p className="text-xs text-stone-500">Las que los censadores reportaron como "ya no funciona". Cada baja se aplica de inmediato; aquí se revisan y, si hace falta, se reactivan.</p>
        </div>
      </div>

      <button
        onClick={() => setFiltrosAbiertos((v) => !v)}
        aria-expanded={filtrosAbiertos}
        className="flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-xl bg-white px-3 text-sm font-semibold shadow-sm ring-1 ring-stone-200 lg:hidden"
      >
        <span className="flex items-center gap-2"><Filter className="h-4 w-4 text-guinda" aria-hidden /> Filtros y orden{(estado || municipio || motivo || desde || hasta || vigentes || rechazados || orden !== "recientes") && <span className="rounded-full bg-guinda px-2 py-0.5 text-[11px] text-white">activos</span>}</span>
        <ChevronDown className={`h-4 w-4 transition ${filtrosAbiertos ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <div className={`${filtrosAbiertos ? "grid" : "hidden"} max-h-[45dvh] shrink-0 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid lg:max-h-none lg:grid-cols-4 lg:overflow-visible`}>
        <SelectorFiltro icono={Landmark} etiqueta="Estado" valor={estado} activo={!!estado} alCambiar={(v) => filtrar(() => setEstado(v))} opciones={[{ valor: "", texto: "Todos los estados" }, ...estados.map((e) => ({ valor: e.clave, texto: e.nombre }))]} />
        <SelectorFiltro icono={MapPin} etiqueta="Municipio" valor={municipio} activo={!!municipio} alCambiar={(v) => filtrar(() => setMunicipio(v))} opciones={[{ valor: "", texto: estado ? "Todos los municipios" : "Elige un estado" }, ...municipios.map((e) => ({ valor: e.clave, texto: e.nombre }))]} />
        <SelectorFiltro icono={Tag} etiqueta="Motivo" valor={motivo} activo={!!motivo} alCambiar={(v) => filtrar(() => setMotivo(v))} opciones={[{ valor: "", texto: "Todos los motivos" }, ...MOTIVOS_BAJA.map((m) => ({ valor: m.clave, texto: m.texto }))]} />
        <SelectorFiltro
          icono={ArrowUpDown} etiqueta="Ordenar" valor={orden} activo={orden !== "recientes"} alCambiar={(v) => filtrar(() => setOrden(v))}
          opciones={[{ valor: "recientes", texto: "Más recientes" }, { valor: "contradicciones", texto: "Con contradicciones primero" }, { valor: "distancia", texto: "Mayor distancia al catálogo" }]}
        />
        <label className="flex items-center gap-2 text-xs text-stone-500"><CalendarDays className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />Desde <input type="date" value={desde} onChange={(e) => filtrar(() => setDesde(e.target.value))} className="h-11 min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-2 text-sm shadow-sm" /></label>
        <label className="flex items-center gap-2 text-xs text-stone-500"><CalendarDays className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />Hasta <input type="date" value={hasta} onChange={(e) => filtrar(() => setHasta(e.target.value))} className="h-11 min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-2 text-sm shadow-sm" /></label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white px-3 text-sm shadow-sm ring-1 ring-stone-200 sm:col-span-2">
          <input type="checkbox" checked={vigentes} onChange={(e) => filtrar(() => setVigentes(e.target.checked))} className="h-5 w-5 accent-guinda" />
          <span className="font-medium">Solo las que siguen dadas de baja</span>
          <span className="text-xs text-stone-500">(sin las reactivadas)</span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white px-3 text-sm shadow-sm ring-1 ring-stone-200 sm:col-span-2">
          <input type="checkbox" checked={rechazados} onChange={(e) => filtrar(() => setRechazados(e.target.checked))} className="h-5 w-5 accent-guinda" />
          <span className="font-medium">Hechas por un usuario rechazado</span>
        </label>
      </div>
      {error && <Aviso>{error}</Aviso>}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200" aria-label="Bajas">
        <div ref={zona} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {!pag ? (
            <div className="grid place-items-center py-16 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : pag.filas.length === 0 ? (
            <Vacio icono={Ban} titulo="Sin bajas" texto="No hay tortillerías dadas de baja con esos filtros." />
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2 2xl:grid-cols-3">
              {pag.filas.map((b) => {
                const lejos = b.distancia_m != null && b.distancia_m > LEJOS_M;
                const abiertoMapa = abierta === b.id;
                return (
                  <li key={b.id}>
                    <Tarjeta className="space-y-2">
                      <div className="flex items-start gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-500"><Store className="h-5 w-5" aria-hidden /></span>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold leading-tight">{b.nombre}</p>
                          <p className="mt-0.5 truncate text-xs text-stone-500">{[b.domicilio, b.municipio, b.estado].filter(Boolean).join(" · ")}</p>
                        </div>
                        {b.reactivada_en ? (
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">Reactivada</span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">Dada de baja</span>
                        )}
                      </div>
                      <p className="text-sm">
                        <b>{textoMotivoBaja(b.motivo).split(" (")[0]}</b>
                        {b.motivo === "otro" && b.motivo_otro ? <span className="text-stone-600"> — {b.motivo_otro}</span> : null}
                      </p>
                      <ul className="space-y-1 text-xs text-stone-500">
                        <li className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5 shrink-0 text-guinda" aria-hidden /> <span className="truncate">{b.censador ?? "Sin usuario"} · {cuando(b.fecha)}</span>{b.censador_rechazado && <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-200">Hecha por un usuario rechazado</span>}</li>
                        <li className={`flex items-center gap-1.5 ${lejos ? "font-semibold text-amber-700" : ""}`}>
                          <MapPin className={`h-3.5 w-3.5 shrink-0 ${lejos ? "text-amber-600" : "text-guinda"}`} aria-hidden />
                          {b.distancia_m == null ? "El reporte no trae ubicación GPS" : `Reportada a ${metros(b.distancia_m)} del lugar del catálogo${b.precision_gps ? ` (GPS ±${Math.round(b.precision_gps)} m)` : ""}${lejos ? " — conviene revisarla" : ""}`}
                        </li>
                        {b.reactivada_en && <li className="flex items-center gap-1.5 text-emerald-700"><RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden /> Reactivada el {cuando(b.reactivada_en)}{b.reactivada_por ? ` por ${b.reactivada_por}` : ""}</li>}
                      </ul>
                      {b.contradicciones > 0 && (
                        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span>Se intentó capturar un precio después de la baja {b.contradicciones === 1 ? "(1 vez)" : `(${b.contradicciones} veces)`}. Decide si hay que reactivarla.</span>
                        </p>
                      )}
                      {b.lat != null && b.lng != null && (
                        <>
                          <button onClick={() => setAbierta(abiertoMapa ? null : b.id)} aria-expanded={abiertoMapa} className="flex items-center gap-1 text-xs font-semibold text-guinda">
                            <ChevronDown className={`h-4 w-4 transition ${abiertoMapa ? "rotate-180" : ""}`} aria-hidden /> {abiertoMapa ? "Ocultar mapa" : "Ver mapa del reporte"}
                          </button>
                          {abiertoMapa && (
                            <div className="space-y-1">
                              <MiniMapa tortilleria={{ lat: b.lat, lng: b.lng }} captura={b.reporte_lat != null && b.reporte_lng != null ? { lat: b.reporte_lat, lng: b.reporte_lng } : null} alto={200} />
                              <p className="text-[11px] text-stone-500"><span className="font-semibold text-guinda">●</span> Lugar del catálogo {b.reporte_lat != null && <><span className="ml-2 font-semibold text-blue-600">●</span> Donde se hizo el reporte</>}</p>
                            </div>
                          )}
                        </>
                      )}
                      {puedeReactivar && !b.reactivada_en && b.operacion === "inactiva" && (
                        confirmar === b.id ? (
                          <div className="space-y-2 rounded-xl bg-stone-50 p-2.5 ring-1 ring-stone-200">
                            <p className="text-xs font-semibold text-stone-700">¿Reactivar esta tortillería? Volverá a aparecer para los censadores cuando actualicen su catálogo.</p>
                            <div className="grid grid-cols-2 gap-2">
                              <Boton variante="secundario" className="!min-h-10 !text-sm" onClick={() => setConfirmar(null)} disabled={trabajando === b.id}>Cancelar</Boton>
                              <Boton className="!min-h-10 !text-sm" icono={trabajando === b.id ? Loader2 : RotateCcw} onClick={() => reactivar(b)} disabled={trabajando === b.id}>Sí, reactivar</Boton>
                            </div>
                          </div>
                        ) : (
                          <Boton variante="secundario" className="!min-h-10 !text-sm" icono={RotateCcw} onClick={() => setConfirmar(b.id)}>Reactivar</Boton>
                        )
                      )}
                    </Tarjeta>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {pag && <Paginacion total={pag.total} pagina={pag.pagina} paginas={pag.paginas} limite={pag.limite} alPagina={setPagina} alLimite={(n) => { setLimite(n); setPagina(1); }} />}
      </section>
    </div>
  );
}
