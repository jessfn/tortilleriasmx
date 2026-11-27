import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ClipboardCheck, FileDown, FileSpreadsheet, Loader2, Sparkles, Store, TrendingDown, TrendingUp, Users, Wheat } from "lucide-react";
import { api, apiDescargar } from "./api";
import { Aviso, Boton } from "./ui";

type Periodo = "dia" | "semana" | "mes" | "anio" | "rango" | "todo";
type Estad = { tiendas: number; promedio: number | null; minimo: number | null; maximo: number | null };
type Totales = { capturas: number; visitadas: number; censadores: number; nuevas: number; maiz: Estad; masa: Estad };
type Vista = { titulo: string; tipo: string; horario: string; anterior: string; dias: number; granularidad: "hora" | "dia" | "mes"; totales: Totales; anteriorTotales: Totales; estados: number };
/** Reporte del cuestionario (C21) */
type TotCuest = { tortillerias: number; registros: number; nuevos: number; actualizados: number; censadores: number; estados: number };
type VistaCuest = { titulo: string; tipo: string; horario: string; anterior: string; ambito: string; granularidad: "hora" | "dia" | "mes"; totales: TotCuest; anteriorTotales: TotCuest; avance: { visitadas: number; conCuestionario: number; porcentaje: number } };
/** Reporte completo: precios + cuestionario, solo tortillerías de máquina */
type VistaCompleto = {
  titulo: string; tipo: string; horario: string; anterior: string; granularidad: "hora" | "dia" | "mes";
  precios: Totales; preciosAnterior: Totales; cuestionario: TotCuest; cuestionarioAnterior: TotCuest;
  avance: { visitadas: number; conCuestionario: number; porcentaje: number }; universo: { clave: string; texto: string; n: number }[];
};

const PERIODOS: { id: Periodo; texto: string }[] = [
  { id: "dia", texto: "Día" },
  { id: "semana", texto: "Semana" },
  { id: "mes", texto: "Mes" },
  { id: "anio", texto: "Año" },
  { id: "rango", texto: "Rango" },
];
const PERIODOS_COMPLETO: { id: Periodo; texto: string }[] = [...PERIODOS, { id: "todo", texto: "De siempre" }];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const PRIMER_ANIO = 2024;
const campo = "min-h-12 w-full rounded-2xl bg-white px-3.5 text-base shadow-sm ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-guinda/50";

/** Hoy en la Ciudad de México (YYYY-MM-DD): el reporte de "hoy" es el de allá, no el del teléfono o la computadora */
const hoyMx = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const aFecha = (s: string) => new Date(`${s}T00:00:00Z`);
const sumar = (s: string, d: number) => new Date(aFecha(s).getTime() + d * 86400000).toISOString().slice(0, 10);
const dias = (a: string, b: string) => Math.round((aFecha(b).getTime() - aFecha(a).getTime()) / 86400000);
const larga = (s: string) => `${aFecha(s).getUTCDate()} de ${MESES[aFecha(s).getUTCMonth()]} de ${aFecha(s).getUTCFullYear()}`;
const pesos = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
const num = (n: number) => n.toLocaleString("es-MX");

function Cifra({ icono: Icono, etiqueta, valor, dif }: { icono: typeof Store; etiqueta: string; valor: string; dif?: { texto: string; bueno: boolean | null } }) {
  return (
    <div className="min-w-0 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200/70">
      <div className="flex items-start gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
        <Icono className="mt-px h-3.5 w-3.5 shrink-0 text-guinda" aria-hidden />
        <span className="leading-tight">{etiqueta}</span>
      </div>
      <div className="mt-1 truncate text-2xl font-bold leading-tight text-guinda">{valor}</div>
      {dif && (
        <div className={`mt-0.5 flex items-center gap-1 text-[11px] font-semibold ${dif.bueno === null ? "text-stone-400" : dif.bueno ? "text-verde" : "text-guinda"}`}>
          {dif.bueno === null ? null : dif.texto.startsWith("−") ? <TrendingDown className="h-3 w-3" aria-hidden /> : <TrendingUp className="h-3 w-3" aria-hidden />}
          <span className="truncate">{dif.texto}</span>
        </div>
      )}
    </div>
  );
}

/**
 * EXTRAS: reportes descargables (PDF con gráficas o Excel) por día, semana, mes, año o rango de fechas.
 * modo "cuestionarios": el mismo selector para el reporte del cuestionario de supervisión (vista Cuestionarios), nacional o de un estado.
 */
export default function AdminExtras({ modo = "precios", estado }: { modo?: "precios" | "cuestionarios" | "completo"; estado?: { clave: string; nombre: string } } = {}) {
  const esCompleto = modo === "completo";
  const esCuest = modo === "cuestionarios";
  const base = esCompleto ? "/admin/cuestionarios/reporte-completo" : esCuest ? "/admin/cuestionarios/reporte" : "/admin/reportes";
  const deEstado = esCuest && estado ? `&estado=${estado.clave}` : "";
  const [vistaX, setVistaX] = useState<VistaCompleto>();
  const hoy = useMemo(hoyMx, []);
  const anioHoy = Number(hoy.slice(0, 4));
  const [periodo, setPeriodo] = useState<Periodo>("dia");
  const [fecha, setFecha] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [mes, setMes] = useState(Number(hoy.slice(5, 7)));
  const [anio, setAnio] = useState(anioHoy);
  const [vista, setVista] = useState<Vista>();
  const [vistaC, setVistaC] = useState<VistaCuest>();
  const [cargando, setCargando] = useState(false);
  const [descargando, setDescargando] = useState<"pdf" | "xlsx" | null>(null);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState("");

  // Lo que se pide al servidor, ya validado aquí para no mandar fechas imposibles
  const { consulta, problema } = useMemo(() => {
    let f = fecha, h: string | undefined;
    let p = "";
    if (periodo === "todo") {
      return { consulta: new URLSearchParams({ periodo }).toString(), problema: "" };
    } else if (periodo === "mes") {
      f = `${anio}-${String(mes).padStart(2, "0")}-01`;
      if (f > hoy) p = "Ese mes aún no llega";
    } else if (periodo === "anio") {
      f = `${anio}-01-01`;
    } else {
      if (!f) p = "Elige la fecha";
      else if (f > hoy) p = "Esa fecha aún no llega";
      if (periodo === "rango") {
        h = hasta;
        if (!h) p ||= "Elige la fecha final";
        else if (h > hoy) p ||= "La fecha final aún no llega";
        else if (f && h < f) p ||= "La fecha final no puede ser anterior a la inicial";
        else if (f && dias(f, h) + 1 > 366) p ||= "El rango puede ser de máximo 366 días";
      }
    }
    const q = new URLSearchParams({ periodo, fecha: f });
    if (h) q.set("hasta", h);
    return { consulta: q.toString(), problema: p };
  }, [periodo, fecha, hasta, mes, anio, hoy]);

  // Vista previa: qué traerá el reporte (se actualiza un momento después de cambiar el periodo)
  useEffect(() => {
    setHecho("");
    if (problema) {
      setVista(undefined);
      setVistaC(undefined);
      setVistaX(undefined);
      return;
    }
    let vigente = true;
    setCargando(true);
    const t = window.setTimeout(() => {
      api<Vista & VistaCuest & VistaCompleto>(`${base}/vista-previa?${consulta}${deEstado}`)
        .then((v) => vigente && (esCompleto ? setVistaX(v) : esCuest ? setVistaC(v) : setVista(v), setError("")))
        .catch((e) => vigente && (setVista(undefined), setVistaC(undefined), setVistaX(undefined), setError(e instanceof Error ? e.message : "No se pudo preparar la vista previa")))
        .finally(() => vigente && setCargando(false));
    }, 350);
    return () => {
      vigente = false;
      window.clearTimeout(t);
    };
  }, [consulta, problema, base, deEstado]); // eslint-disable-line react-hooks/exhaustive-deps

  async function descargar(formato: "pdf" | "xlsx") {
    if (problema || descargando) return;
    setDescargando(formato);
    setError("");
    setHecho("");
    try {
      await apiDescargar(`${base}/descargar?${consulta}&formato=${formato}${deEstado}`, `TortilleriasMX_${esCompleto ? "ReporteCompleto_Maquina" : esCuest ? "Cuestionario" : "Reporte"}.${formato}`);
      setHecho(formato === "pdf" ? "Reporte en PDF descargado" : "Reporte en Excel descargado");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo descargar el reporte");
    } finally {
      setDescargando(null);
    }
  }

  const semana = periodo === "semana" && fecha ? (() => { const d = (aFecha(fecha).getUTCDay() + 6) % 7; const a = sumar(fecha, -d); return `Semana del ${larga(a)} al ${larga(sumar(a, 6))}`; })() : "";
  const t = vista?.totales, p = vista?.anteriorTotales;
  const difConteo = (a: number, b: number): { texto: string; bueno: boolean | null } | undefined => {
    if (!vista || b === 0) return { texto: `Sin datos de ${vista?.anterior ?? "antes"}`, bueno: null };
    const d = ((a - b) / b) * 100;
    if (Math.abs(d) < 0.05) return { texto: `Igual que ${vista.anterior}`, bueno: null };
    return { texto: `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} % vs. ${vista.anterior}`, bueno: d > 0 };
  };
  const difPrecio = (a: number | null, b: number | null): { texto: string; bueno: boolean | null } | undefined => {
    if (!vista || a == null || b == null) return { texto: `Sin datos de ${vista?.anterior ?? "antes"}`, bueno: null };
    const d = a - b;
    if (Math.abs(d) < 0.005) return { texto: `Igual que ${vista.anterior}`, bueno: null };
    return { texto: `${d > 0 ? "+" : "−"}$${Math.abs(d).toFixed(2)} vs. ${vista.anterior}`, bueno: d < 0 };
  };
  const tc = vistaC?.totales, pc = vistaC?.anteriorTotales;
  const difC = (a: number, b: number): { texto: string; bueno: boolean | null } | undefined => {
    if (!vistaC) return undefined;
    if (b === 0) return { texto: a === 0 ? `Igual que ${vistaC.anterior}` : `Sin datos de ${vistaC.anterior}`, bueno: null };
    const d = ((a - b) / b) * 100;
    if (Math.abs(d) < 0.05) return { texto: `Igual que ${vistaC.anterior}`, bueno: null };
    return { texto: `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} % vs. ${vistaC.anterior}`, bueno: d > 0 };
  };
  const anios = Array.from({ length: anioHoy - PRIMER_ANIO + 1 }, (_, i) => anioHoy - i);

  return (
    <div className="space-y-3">
      {!esCuest && (
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-dorado/15 text-[#8a6a35]"><Sparkles className="h-[18px] w-[18px]" aria-hidden /></span>
          <div className="leading-tight">
            <h2 className="text-base font-bold">Extras</h2>
            <p className="text-xs text-stone-500">Reportes para descargar: cuántas capturas se registraron y los precios promedio por estado.</p>
          </div>
        </div>
      )}

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        {/* ---------- Qué reporte ---------- */}
        <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200" aria-label="Elegir el reporte">
          <div>
            <h3 className="text-sm font-bold">Periodo</h3>
            <div role="radiogroup" aria-label="Periodo del reporte" className={`mt-2 grid grid-cols-3 gap-1.5 ${esCompleto ? "sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6" : "sm:grid-cols-5 lg:grid-cols-3 xl:grid-cols-5"}`}>
              {(esCompleto ? PERIODOS_COMPLETO : PERIODOS).map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={periodo === x.id}
                  onClick={() => setPeriodo(x.id)}
                  className={`min-h-11 rounded-xl px-2 text-sm font-semibold transition-colors ${periodo === x.id ? "bg-guinda text-white shadow-sm" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:ring-guinda/40"}`}
                >
                  {x.texto}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {(periodo === "dia" || periodo === "semana") && (
              <label className="block text-xs font-semibold text-stone-500">
                {periodo === "dia" ? "Día" : "Un día cualquiera de la semana"}
                <input type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} className={`${campo} mt-1`} />
              </label>
            )}
            {periodo === "rango" && (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <label className="block text-xs font-semibold text-stone-500">Desde<input type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} className={`${campo} mt-1`} /></label>
                <label className="block text-xs font-semibold text-stone-500">Hasta<input type="date" value={hasta} max={hoy} onChange={(e) => setHasta(e.target.value)} className={`${campo} mt-1`} /></label>
              </div>
            )}
            {(periodo === "mes" || periodo === "anio") && (
              <div className="grid grid-cols-2 gap-2">
                {periodo === "mes" && (
                  <label className="block text-xs font-semibold text-stone-500">
                    Mes
                    <select value={mes} onChange={(e) => setMes(Number(e.target.value))} className={`${campo} mt-1`}>
                      {MESES.map((m, i) => (
                        <option key={m} value={i + 1} disabled={anio === anioHoy && i + 1 > Number(hoy.slice(5, 7))}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className={`block text-xs font-semibold text-stone-500 ${periodo === "anio" ? "col-span-2" : ""}`}>
                  Año
                  <select value={anio} onChange={(e) => { const a = Number(e.target.value); setAnio(a); if (a === anioHoy && mes > Number(hoy.slice(5, 7))) setMes(Number(hoy.slice(5, 7))); }} className={`${campo} mt-1`}>
                    {anios.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
              </div>
            )}
            {semana && <p className="flex items-start gap-1.5 text-xs text-stone-500"><CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{semana}</p>}
            {periodo === "todo" && <p className="flex items-start gap-1.5 text-xs text-stone-500"><CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />Desde el primer registro de tortillerías de máquina hasta hoy, mes por mes.</p>}
            <p className="text-[11px] leading-snug text-stone-400">
              {periodo === "dia" ? "Va de las 12:00 a. m. a las 11:59 p. m. de ese día." : "Cada día va de las 12:00 a. m. a las 11:59 p. m."} Hora de la Ciudad de México.
            </p>
          </div>

          {problema && <Aviso tipo="info">{problema}</Aviso>}
          {error && <Aviso>{error}</Aviso>}
          {hecho && <Aviso tipo="ok">{hecho}</Aviso>}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Boton icono={descargando === "pdf" ? Loader2 : FileDown} disabled={!!problema || !!descargando} onClick={() => descargar("pdf")}>
              {descargando === "pdf" ? "Preparando…" : "Descargar PDF"}
            </Boton>
            <Boton variante="secundario" icono={descargando === "xlsx" ? Loader2 : FileSpreadsheet} disabled={!!problema || !!descargando} onClick={() => descargar("xlsx")}>
              {descargando === "xlsx" ? "Preparando…" : "Descargar Excel"}
            </Boton>
          </div>
          <p className="text-[11px] leading-snug text-stone-400">
            {esCompleto
              ? "Un solo archivo con portada, la parte de precios (la de Extras) y la del cuestionario, solo de tortillerías que elaboran a máquina. El PDF es una presentación con gráficas; el Excel trae una portada y las hojas de las dos partes, sin datos personales."
              : esCuest
              ? `El PDF es una presentación con gráficas de cada bloque del cuestionario (${estado ? estado.nombre : "nacional"}). El Excel trae los totales, el avance por estado, las respuestas pregunta por pregunta y lo que escribieron en "Otro", sin datos personales.`
              : "El PDF es una presentación con gráficas y los logos de Gobierno de México y Agricultura. El Excel trae las tablas y las capturas del periodo, sin datos personales."}
          </p>
        </section>

        {/* ---------- Vista previa ---------- */}
        <section className="min-w-0 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200" aria-label="Vista previa del reporte" aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-widest text-dorado">{(esCompleto ? vistaX?.tipo : esCuest ? vistaC?.tipo : vista?.tipo) ?? "Vista previa"}</div>
              <h3 className="mt-0.5 break-words font-serif text-2xl leading-tight text-guinda sm:text-3xl">{(esCompleto ? vistaX?.titulo : esCuest ? vistaC?.titulo : vista?.titulo) ?? (problema ? "—" : "Preparando…")}</h3>
              {esCompleto ? vistaX && <p className="mt-1 text-xs text-stone-500">Solo tortillerías de máquina · {vistaX.horario}</p> : esCuest ? vistaC && <p className="mt-1 text-xs text-stone-500">{vistaC.ambito} · {vistaC.horario}</p> : vista && <p className="mt-1 text-xs text-stone-500">{vista.horario}</p>}
            </div>
            {cargando && <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin text-stone-400" aria-label="Cargando" />}
          </div>

          {esCompleto ? (
            vistaX ? (
              <VistaPreviaCompleto v={vistaX} />
            ) : (
              !cargando && <p className="mt-6 rounded-xl bg-stone-50 p-6 text-center text-sm text-stone-500 ring-1 ring-stone-200/70">{problema || error || "Elige un periodo para ver qué incluirá el reporte."}</p>
            )
          ) : esCuest ? (
            tc && pc && vistaC ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  <Cifra icono={ClipboardCheck} etiqueta="Cuestionarios aplicados" valor={num(tc.tortillerias)} dif={difC(tc.tortillerias, pc.tortillerias)} />
                  <Cifra icono={Store} etiqueta="Primera vez" valor={num(tc.nuevos)} dif={difC(tc.nuevos, pc.nuevos)} />
                  <Cifra icono={Store} etiqueta="Actualizados" valor={num(tc.actualizados)} dif={difC(tc.actualizados, pc.actualizados)} />
                  <Cifra icono={Users} etiqueta="Censadores" valor={num(tc.censadores)} dif={difC(tc.censadores, pc.censadores)} />
                  <Cifra icono={Sparkles} etiqueta="Registros" valor={num(tc.registros)} dif={difC(tc.registros, pc.registros)} />
                  <Cifra icono={ClipboardCheck} etiqueta="Avance acumulado" valor={`${vistaC.avance.porcentaje} %`} dif={{ texto: `${num(vistaC.avance.conCuestionario)} de ${num(vistaC.avance.visitadas)} visitadas`, bueno: null }} />
                </div>
                {tc.tortillerias === 0 ? (
                  <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />No hay cuestionarios aplicados en este periodo. El reporte se puede descargar, pero saldrá sin respuestas.</p>
                ) : (
                  <p className="mt-3 text-xs text-stone-500">
                    El reporte incluye los cuestionarios {vistaC.granularidad === "hora" ? "hora por hora" : vistaC.granularidad === "dia" ? "día por día" : "mes por mes"}, el avance por estado, las respuestas de cada bloque (A, B y C) y la comparación con {vistaC.anterior}.
                  </p>
                )}
              </>
            ) : (
              !cargando && <p className="mt-6 rounded-xl bg-stone-50 p-6 text-center text-sm text-stone-500 ring-1 ring-stone-200/70">{problema || error || "Elige un periodo para ver qué incluirá el reporte."}</p>
            )
          ) : t && p && vista ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <Cifra icono={Sparkles} etiqueta="Capturas" valor={num(t.capturas)} dif={difConteo(t.capturas, p.capturas)} />
                <Cifra icono={Store} etiqueta="Tortillerías visitadas" valor={num(t.visitadas)} dif={difConteo(t.visitadas, p.visitadas)} />
                <Cifra icono={Store} etiqueta="Tortillerías nuevas" valor={num(t.nuevas)} dif={difConteo(t.nuevas, p.nuevas)} />
                <Cifra icono={Users} etiqueta="Censadores activos" valor={num(t.censadores)} dif={difConteo(t.censadores, p.censadores)} />
                <Cifra icono={Wheat} etiqueta="Tortilla · promedio" valor={t.maiz.promedio == null ? "—" : `${pesos(t.maiz.promedio)} /kg`} dif={difPrecio(t.maiz.promedio, p.maiz.promedio)} />
                <Cifra icono={Wheat} etiqueta="Masa · promedio" valor={t.masa.promedio == null ? "—" : `${pesos(t.masa.promedio)} /kg`} dif={difPrecio(t.masa.promedio, p.masa.promedio)} />
              </div>
              {t.capturas === 0 ? (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />No hay capturas que cuenten en este periodo. El reporte se puede descargar, pero saldrá sin cifras.</p>
              ) : (
                <p className="mt-3 text-xs text-stone-500">
                  El reporte incluye {vista.granularidad === "hora" ? "las capturas hora por hora" : vista.granularidad === "dia" ? "las capturas día por día" : "las capturas mes por mes"}, el precio promedio de la tortilla por estado ({num(vista.estados)} {vista.estados === 1 ? "estado" : "estados"} con capturas),
                  una tabla por estado, el avance del censo y la comparación con {vista.anterior}.
                </p>
              )}
            </>
          ) : (
            !cargando && <p className="mt-6 rounded-xl bg-stone-50 p-6 text-center text-sm text-stone-500 ring-1 ring-stone-200/70">{problema || error || "Elige un periodo para ver qué incluirá el reporte."}</p>
          )}
        </section>
      </div>
    </div>
  );
}

/** Vista previa del reporte completo: universo de máquina, precios y cuestionario del periodo */
function VistaPreviaCompleto({ v }: { v: VistaCompleto }) {
  const p = v.precios, pa = v.preciosAnterior, c = v.cuestionario, ca = v.cuestionarioAnterior;
  const dif = (a: number, b: number): { texto: string; bueno: boolean | null } => {
    if (b === 0) return { texto: a === 0 ? `Igual que ${v.anterior}` : `Sin datos de ${v.anterior}`, bueno: null };
    const d = ((a - b) / b) * 100;
    if (Math.abs(d) < 0.05) return { texto: `Igual que ${v.anterior}`, bueno: null };
    return { texto: `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} % vs. ${v.anterior}`, bueno: d > 0 };
  };
  const maq = v.universo.find((u) => u.clave === "maquina")?.n ?? 0;
  const tot = Math.max(1, v.universo.reduce((s, u) => s + u.n, 0));
  const colores: Record<string, string> = { maquina: "bg-guinda", ambas: "bg-dorado", mano: "bg-stone-400", sin_dato: "bg-stone-200" };
  const vacio = p.capturas === 0 && c.tortillerias === 0;
  return (
    <>
      <div className="mt-4 rounded-2xl bg-guinda/5 p-3 ring-1 ring-guinda/15">
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold text-stone-600">Catálogo activo por tipo de elaboración</span>
          <span className="shrink-0 font-bold text-guinda">{((maq / tot) * 100).toFixed(1)} % a máquina</span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-stone-100">
          {v.universo.map((u) => <span key={u.clave} className={colores[u.clave] ?? "bg-stone-300"} style={{ width: `${(u.n / tot) * 100}%` }} />)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-500">
          {v.universo.map((u) => (
            <span key={u.clave} className={`inline-flex items-center gap-1 ${u.clave === "maquina" ? "font-bold text-guinda" : ""}`}>
              <span className={`h-2 w-2 rounded-sm ${colores[u.clave] ?? "bg-stone-300"}`} />{u.texto} {num(u.n)}{u.clave === "maquina" ? " · incluidas" : ""}
            </span>
          ))}
        </div>
      </div>
      <h4 className="mt-4 text-[11px] font-bold uppercase tracking-wide text-stone-500">Parte 1 · Precios</h4>
      <div className="mt-1.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Cifra icono={Sparkles} etiqueta="Capturas" valor={num(p.capturas)} dif={dif(p.capturas, pa.capturas)} />
        <Cifra icono={Store} etiqueta="Tortillerías visitadas" valor={num(p.visitadas)} dif={dif(p.visitadas, pa.visitadas)} />
        <Cifra icono={Wheat} etiqueta="Tortilla · promedio" valor={p.maiz.promedio == null ? "—" : `${pesos(p.maiz.promedio)} /kg`} />
      </div>
      <h4 className="mt-4 text-[11px] font-bold uppercase tracking-wide text-stone-500">Parte 2 · Cuestionario</h4>
      <div className="mt-1.5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <Cifra icono={ClipboardCheck} etiqueta="Cuestionarios aplicados" valor={num(c.tortillerias)} dif={dif(c.tortillerias, ca.tortillerias)} />
        <Cifra icono={Users} etiqueta="Censadores" valor={num(c.censadores)} dif={dif(c.censadores, ca.censadores)} />
        <Cifra icono={ClipboardCheck} etiqueta="Avance acumulado" valor={`${v.avance.porcentaje} %`} dif={{ texto: `${num(v.avance.conCuestionario)} de ${num(v.avance.visitadas)} visitadas`, bueno: null }} />
      </div>
      {vacio ? (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />No hay capturas ni cuestionarios de tortillerías de máquina en este periodo. El reporte se puede descargar, pero saldrá sin cifras.</p>
      ) : (
        <p className="mt-3 text-xs text-stone-500">
          Incluye una portada con las cifras clave; de precios, el precio promedio por estado, el avance del censo, las bajas y el tipo de elaboración; y del cuestionario, las respuestas de los bloques A (ubicación y condiciones sanitarias del establecimiento), B y C.
        </p>
      )}
    </>
  );
}
