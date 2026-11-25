import { useState } from "react";
import { AlertTriangle, Ban, Banknote, BarChart3, ClipboardList, Clock, Landmark, Layers, Loader2, Map as MapaIcono, PlusCircle, Store, TriangleAlert, Users, Wheat } from "lucide-react";
import { api } from "./api";
import { BarraValor, dinero, entero, EnVivo, Tendencia, useVivo, type DiaPrecio } from "./AdminVivo";
import type { FilaZona, FocoMapa } from "./AdminMapa";
import { Dato, Insignia, Tarjeta } from "./ui";

export type Resumen = {
  usuarios: number; catalogo: number; tortillerias_pendientes: number; capturas: number; capturas_pendientes: number; alertas: number;
  /** del catálogo con al menos un precio que cuenta, total del catálogo y avance del censo (%) */
  denue_visitadas: number; denue_total: number; avance_censo: number;
  /** tortillerías que los censadores dieron de baja ("ya no funcionan"): salen del total del avance */
  dadas_de_baja?: number;
  nuevas: { total: number; validadas: number; pendientes: number; rechazadas: number };
  promedio_maiz: string | null; promedio_masa: string | null; capturas_hoy: number; censadores_hoy: number;
  porEstado: { estado: string; promedio: string; n: number }[];
};
type Actividad = {
  id: string; producto: "maiz" | "harina" | "masa"; precio_kg: number; estatus: string; alerta: boolean; creado_en: string; tortilleria_id: string;
  nombre: string; municipio: string | null; estado: string | null; capturista: string | null;
};

const hace = (s: string) => {
  const seg = Math.max(0, Math.round((Date.now() - new Date(s).getTime()) / 1000));
  if (seg < 60) return "hace un momento";
  if (seg < 3600) return `hace ${Math.round(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.round(seg / 3600)} h`;
  return `hace ${Math.round(seg / 86400)} d`;
};

/** Resumen general en vivo: precios promedio, actividad de hoy, tendencia y últimas capturas */
export default function AdminResumen({
  r, ultima, fallo, alRevisar, alEstadisticas, alMapa, puedeEstadisticas = true, puedeMapa = true, puedeRevision = true,
}: {
  r?: Resumen; ultima?: number; fallo?: boolean; alRevisar: () => void; alEstadisticas: () => void; alMapa: (f?: FocoMapa) => void;
  /** a qué otras pantallas tiene acceso esta cuenta: lo que no, no se ofrece */
  puedeEstadisticas?: boolean; puedeMapa?: boolean; puedeRevision?: boolean;
}) {
  const [tendencia, setTendencia] = useState<DiaPrecio[]>([]);
  const [actividad, setActividad] = useState<Actividad[]>();
  const [estados, setEstados] = useState<FilaZona[]>([]);

  useVivo(async () => {
    const [t, a, e] = await Promise.all([
      api<DiaPrecio[]>("/admin/tendencia?dias=30"),
      api<Actividad[]>("/admin/actividad?limite=12"),
      api<FilaZona[]>("/admin/estadisticas?dias=30"),
    ]);
    setTendencia(t);
    setActividad(a);
    setEstados(e);
  }, 20_000);

  if (!r) return <div className="grid place-items-center py-12 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  // Solo se revisan a mano los precios atípicos (los normales se aprueban solos) y las tortillerías nuevas
  const porRevisar = r.tortillerias_pendientes + r.capturas_pendientes;
  const top = estados.filter((e) => e.maiz).sort((a, b) => b.maiz!.promedio - a.maiz!.promedio);
  const max = Math.max(1, ...top.map((e) => e.maiz!.promedio));
  const P = { maiz: { t: "Tortilla", i: Wheat }, harina: { t: "Harina", i: Layers }, masa: { t: "Masa", i: Layers } };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Resumen general</h2>
        <EnVivo ultima={ultima} fallo={fallo} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tarjeta className="flex items-center gap-3 bg-gradient-to-br from-guinda to-guinda-oscuro !text-white !ring-0">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15"><Banknote className="h-6 w-6 text-dorado" aria-hidden /></span>
          <div>
            <p className="text-xs text-white/70">Promedio del kilo de tortilla de maíz · 30 días</p>
            <p className="text-3xl font-bold leading-tight">{r.promedio_maiz ? dinero(Number(r.promedio_maiz)) : "Sin datos"}</p>
          </div>
        </Tarjeta>
        <Tarjeta className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-verde/10 text-verde"><Layers className="h-6 w-6" aria-hidden /></span>
          <div>
            <p className="text-xs text-stone-500">Promedio del kilo de masa · 30 días</p>
            <p className="text-3xl font-bold leading-tight">{r.promedio_masa ? dinero(Number(r.promedio_masa)) : "Sin datos"}</p>
          </div>
        </Tarjeta>
        <Tarjeta className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-guinda/10 text-guinda"><BarChart3 className="h-6 w-6" aria-hidden /></span>
          <div>
            <p className="text-xs text-stone-500">Capturas de hoy</p>
            <p className="text-3xl font-bold leading-tight">{entero(r.capturas_hoy)}</p>
            <p className="text-[11px] text-stone-400">{entero(r.censadores_hoy)} {r.censadores_hoy === 1 ? "censador activo" : "censadores activos"}</p>
          </div>
        </Tarjeta>
        <button onClick={alRevisar} disabled={!puedeRevision} className={`flex items-center gap-3 rounded-2xl p-3 text-left shadow-sm ring-1 transition enabled:active:scale-[.98] disabled:cursor-default ${porRevisar ? "bg-amber-50 ring-amber-200" : "bg-white ring-stone-200"}`}>
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${porRevisar ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>{porRevisar ? <AlertTriangle className="h-6 w-6" aria-hidden /> : <Clock className="h-6 w-6" aria-hidden />}</span>
          <div>
            <p className="text-xs text-stone-500">Precios atípicos por revisar</p>
            <p className="text-3xl font-bold leading-tight">{entero(r.capturas_pendientes)}</p>
            <p className="text-[11px] text-stone-500">{entero(r.tortillerias_pendientes)} {r.tortillerias_pendientes === 1 ? "tortillería nueva" : "tortillerías nuevas"} por validar</p>
          </div>
        </button>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Tarjeta className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">Tendencia del precio · 30 días</h3>
            {puedeEstadisticas && <button onClick={alEstadisticas} className="text-xs font-semibold text-guinda hover:underline">Ver estadísticas</button>}
          </div>
          <Tendencia datos={tendencia} alto={230} />
        </Tarjeta>

        <Tarjeta className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-bold"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden /> Actividad reciente</h3>
          {!actividad ? (
            <div className="grid place-items-center py-8 text-stone-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : actividad.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-500">Todavía no hay capturas.</p>
          ) : (
            <ul className="max-h-[17rem] divide-y divide-stone-100 overflow-y-auto">
              {actividad.map((a) => {
                const I = P[a.producto].i;
                return (
                  <li key={a.id} className="flex items-center gap-2.5 py-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-guinda/10 text-guinda"><I className="h-4 w-4" aria-hidden /></span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-medium">{a.nombre}</span>
                      <span className="block truncate text-[11px] text-stone-500">{[a.municipio, a.estado].filter(Boolean).join(", ")} · {hace(a.creado_en)}</span>
                    </span>
                    <span className="text-right leading-tight">
                      <span className="block text-sm font-bold">{dinero(a.precio_kg)}</span>
                      {a.alerta ? <span className="text-[10px] font-bold text-red-600">⚠ ALERTA</span> : <Insignia estatus={a.estatus} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Tarjeta>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Tarjeta className="space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">Estados por precio promedio de tortilla</h3>
            {puedeMapa && <button onClick={() => alMapa()} className="inline-flex items-center gap-1 text-xs font-semibold text-guinda hover:underline"><MapaIcono className="h-3.5 w-3.5" aria-hidden /> Abrir mapa</button>}
          </div>
          {top.length === 0 ? (
            <p className="text-sm text-stone-500">Todavía no hay precios capturados.</p>
          ) : (
            top.slice(0, 8).map((e) => (
              <button key={e.clave} onClick={() => alMapa({ bbox: e.bbox, estado: e.clave, n: e.tortillerias })} className="block w-full text-left">
                <div className="flex justify-between text-xs">
                  <span className="truncate font-medium">{e.nombre}</span>
                  <span className="text-stone-500">{dinero(e.maiz!.promedio)} · {entero(e.maiz!.capturas)} reg.</span>
                </div>
                <div className="mt-1"><BarraValor valor={e.maiz!.promedio} max={max} /></div>
              </button>
            ))
          )}
        </Tarjeta>

        <div className="grid grid-cols-2 content-start gap-2">
          <Dato icono={Users} etiqueta="Censadores registrados" valor={entero(r.usuarios)} />
          <Dato icono={ClipboardList} etiqueta="Precios capturados" valor={entero(r.capturas)} tono="gris" />
          <Dato icono={Store} etiqueta="Tortillerías del DENUE visitadas" valor={entero(r.denue_visitadas)} tono="verde" />
          <Dato icono={TriangleAlert} etiqueta="Alertas de precio" valor={entero(r.alertas)} tono="dorado" />
          <Dato icono={Ban} etiqueta="Dadas de baja" valor={entero(r.dadas_de_baja ?? 0)} tono="gris" />
          <Tarjeta className="col-span-2 space-y-1.5 !py-2.5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-guinda/10 text-guinda"><PlusCircle className="h-[18px] w-[18px]" aria-hidden /></span>
              <p className="text-sm leading-tight"><b className="text-2xl">{entero(r.nuevas.total)}</b> <span className="text-stone-600">tortillerías nuevas</span></p>
            </div>
            <p className="text-xs text-stone-500">
              <b className="text-emerald-700">{entero(r.nuevas.validadas)}</b> validadas · <b className="text-amber-700">{entero(r.nuevas.pendientes)}</b> por revisar · <b className="text-red-700">{entero(r.nuevas.rechazadas)}</b> rechazadas
            </p>
          </Tarjeta>
          <Tarjeta className="col-span-2 space-y-1.5 !py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">Avance del censo</p>
              <p className="text-lg font-bold text-guinda">{r.avance_censo.toLocaleString("es-MX", { maximumFractionDigits: 2 })}%</p>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-guinda" style={{ width: `${Math.min(100, r.avance_censo)}%` }} /></div>
            <p className="text-[11px] text-stone-500">{entero(r.denue_visitadas)} de {entero(r.denue_total)} tortillerías del catálogo ya tienen un precio.</p>
          </Tarjeta>
          <Tarjeta className="col-span-2 flex items-center gap-3 !py-2.5">
            <Landmark className="h-5 w-5 shrink-0 text-guinda" aria-hidden />
            <p className="text-sm"><b>{entero(r.catalogo)}</b> tortillerías en el catálogo DENUE para elegir al registrar.</p>
          </Tarjeta>
        </div>
      </div>
    </>
  );
}
