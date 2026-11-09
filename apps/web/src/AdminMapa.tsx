import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, Landmark, Layers, Loader2, Building2, MapPin, ShieldAlert, SlidersHorizontal, Store, Wheat, X } from "lucide-react";
import { api } from "./api";
import { COLOR_ALTO, COLOR_BAJO, COLOR_MEDIO, dinero, entero, EnVivo, Tendencia, useVivo, type DiaPrecio } from "./AdminVivo";
import type { MapaAdminRef, PuntoAdm, VistaMapa } from "./MapaAdmin";
import DetalleLazy from "./AdminDetalle";
import { Selector } from "./ui";

const Mapa = lazy(() => import("./MapaAdmin"));

export type FilaZona = {
  clave: string; nombre: string; tortillerias: number; con_precios: number; capturas: number;
  maiz: { promedio: number; minimo: number; maximo: number; capturas: number } | null;
  masa: { promedio: number; minimo: number; maximo: number; capturas: number } | null;
  lat: number; lng: number; bbox: [number, number, number, number];
};
export type FocoMapa = { bbox: [number, number, number, number]; estado?: string; municipio?: string; n: number };

const PERIODOS: [number, string][] = [[7, "7 días"], [30, "30 días"], [90, "90 días"], [0, "Todo"]];

/** Mapa de precios con filtros, zona (estado/municipio) y estadísticas al momento */
export default function AdminMapa({ foco, alCambio }: { foco?: FocoMapa; alCambio: () => void }) {
  const ref = useRef<MapaAdminRef>(null);
  const [producto, setProducto] = useState<"maiz" | "masa">("maiz");
  const [dias, setDias] = useState(30);
  const [solo, setSolo] = useState(false);
  const [tick, setTick] = useState(0);
  const [vista, setVista] = useState<VistaMapa>({ puntos: [], celdas: [], modo: "celdas", lejano: false, cargando: true, rango: [20, 32] });
  const [abierto, setAbierto] = useState(false); // hoja inferior en celular
  const [sel, setSel] = useState<PuntoAdm | null>(null); // tortillería elegida: su detalle va en un panel, no sobre el mapa

  const [estados, setEstados] = useState<FilaZona[]>([]);
  const [municipios, setMunicipios] = useState<FilaZona[]>([]);
  const [estado, setEstado] = useState("");
  const [municipio, setMunicipio] = useState("");
  const [tendencia, setTendencia] = useState<DiaPrecio[]>([]);

  // Todo se actualiza solo: el mapa, las zonas y la tendencia
  const vivo = useVivo(async () => {
    setTick((t) => t + 1);
    const [e, m, t] = await Promise.all([
      api<FilaZona[]>(`/admin/estadisticas?dias=${dias}`),
      estado ? api<FilaZona[]>(`/admin/estadisticas?estado=${estado}&dias=${dias}`) : Promise.resolve([] as FilaZona[]),
      api<DiaPrecio[]>(`/admin/tendencia?dias=${dias || 365}${estado ? `&estado=${estado}` : ""}${municipio ? `&municipio=${municipio}` : ""}`),
    ]);
    setEstados(e);
    setMunicipios(m);
    setTendencia(t);
  }, 30_000, [dias, estado, municipio]);

  // Viene de otra pantalla pidiendo acercar el mapa (por ejemplo, desde Estadísticas)
  useEffect(() => {
    if (!foco) return;
    setEstado(foco.estado ?? "");
    setMunicipio(foco.municipio ?? "");
    const t = setTimeout(() => ref.current?.ajustarA(foco.bbox), 400);
    return () => clearTimeout(t);
  }, [foco]);

  const zona = useMemo(() => (municipio ? municipios.find((m) => m.clave === municipio) : estado ? estados.find((e) => e.clave === estado) : undefined), [estado, municipio, estados, municipios]);

  // Al elegir una tortillería se centra el mapa en ella (el panel ya ocupa su lugar)
  useEffect(() => {
    if (!sel) return;
    const t = setTimeout(() => ref.current?.centrarEn(sel.lat, sel.lng), 120);
    return () => clearTimeout(t);
  }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const detalle = sel && (
    <DetalleLazy
      id={sel.id}
      resumen={sel}
      alCerrar={() => setSel(null)}
      alResuelta={() => {
        setTick((t) => t + 1); // el mapa se actualiza con el nuevo estatus
        alCambio();
        setSel(null);
      }}
    />
  );

  const irA = useCallback((f?: FilaZona) => f && ref.current?.ajustarA(f.bbox), []);

  // Estadísticas de lo que se ve en el mapa
  const resumenVista = useMemo(() => {
    if (vista.modo === "celdas") {
      // Zonas agrupadas: se suman las celdas (el mínimo y máximo exactos solo se conocen al acercarse)
      const [nCampo, sCampo] = producto === "maiz" ? (["maiz_n", "maiz_suma"] as const) : (["masa_n", "masa_suma"] as const);
      const con = vista.celdas.reduce((a, c) => a + c[nCampo], 0);
      const suma = vista.celdas.reduce((a, c) => a + c[sCampo], 0);
      return {
        total: vista.celdas.reduce((a, c) => a + c.n, 0), con, prom: con ? suma / con : null, min: null as number | null, max: null as number | null,
        alertas: 0, porValidar: vista.celdas.reduce((a, c) => a + c.pendientes, 0),
      };
    }
    const con = vista.puntos.filter((x) => (producto === "maiz" ? x.ultimo_maiz : x.ultima_masa));
    const precios = con.map((x) => (producto === "maiz" ? x.ultimo_maiz!.precio : x.ultima_masa!.precio));
    return {
      total: vista.puntos.length,
      con: con.length,
      prom: precios.length ? precios.reduce((a, b) => a + b, 0) / precios.length : null,
      min: precios.length ? Math.min(...precios) : null,
      max: precios.length ? Math.max(...precios) : null,
      alertas: vista.puntos.filter((x) => x.alerta).length,
      porValidar: vista.puntos.filter((x) => x.estatus === "pendiente").length,
    };
  }, [vista.puntos, vista.celdas, vista.modo, producto]);

  const chip = (on: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${on ? "bg-guinda text-white shadow" : "bg-white text-stone-600 ring-1 ring-stone-200"}`;
  const stat = zona?.[producto];

  const panel = (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">Mapa de precios</h2>
        <EnVivo ultima={vivo.ultima} fallo={vivo.fallo} />
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-200/70 p-1" role="tablist" aria-label="Producto">
        {([["maiz", "Tortilla de maíz", Wheat], ["masa", "Masa", Layers]] as const).map(([id, texto, I]) => (
          <button key={id} role="tab" aria-selected={producto === id} onClick={() => setProducto(id)} className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition ${producto === id ? "bg-white text-guinda shadow" : "text-stone-500"}`}>
            <I className="h-4 w-4" aria-hidden /> {texto}
          </button>
        ))}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-stone-500">Periodo de los precios</p>
        <div className="flex flex-wrap gap-1.5">
          {PERIODOS.map(([d, t]) => (
            <button key={d} className={chip(dias === d)} onClick={() => setDias(d)}>{t}</button>
          ))}
        </div>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-white px-3 py-2.5 text-sm shadow-sm ring-1 ring-stone-200">
        <span className="font-medium">Solo tortillerías con precios</span>
        <input type="checkbox" checked={solo} onChange={(e) => setSolo(e.target.checked)} className="h-5 w-5 accent-guinda" />
      </label>

      <div className="space-y-2.5 border-t border-stone-200 pt-3">
        <p className="text-xs font-semibold text-stone-500">Ir a una zona</p>
        <Selector
          etiqueta="Estado"
          icono={Landmark}
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value);
            setMunicipio("");
            irA(estados.find((x) => x.clave === e.target.value));
          }}
          placeholder="Todo el país"
          opciones={estados.map((e) => ({ valor: e.clave, texto: `${e.nombre} · ${entero(e.capturas)} capturas` }))}
        />
        <Selector
          etiqueta="Municipio"
          icono={Building2}
          value={municipio}
          disabled={!estado}
          onChange={(e) => {
            setMunicipio(e.target.value);
            irA(municipios.find((x) => x.clave === e.target.value) ?? estados.find((x) => x.clave === estado));
          }}
          placeholder={estado ? "Todo el estado" : "Primero el estado"}
          opciones={municipios.map((m) => ({ valor: m.clave, texto: `${m.nombre} · ${entero(m.capturas)} capturas` }))}
        />
        {zona && (
          <div className="rounded-xl bg-guinda/5 p-3 ring-1 ring-guinda/10">
            <p className="text-sm font-bold">{zona.nombre}</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div><dd className="text-lg font-bold leading-tight">{entero(zona.tortillerias)}</dd><dt className="text-[11px] text-stone-500">tortillerías</dt></div>
              <div><dd className="text-lg font-bold leading-tight">{entero(zona.con_precios)}</dd><dt className="text-[11px] text-stone-500">con precios</dt></div>
              <div><dd className="text-lg font-bold leading-tight">{entero(zona.capturas)}</dd><dt className="text-[11px] text-stone-500">capturas</dt></div>
            </dl>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-white p-1.5"><div className="text-[11px] text-stone-500">Promedio</div><div className="font-bold">{dinero(stat?.promedio)}</div></div>
              <div className="rounded-lg bg-white p-1.5"><div className="text-[11px] text-stone-500">Mínimo</div><div className="font-bold text-emerald-700">{dinero(stat?.minimo)}</div></div>
              <div className="rounded-lg bg-white p-1.5"><div className="text-[11px] text-stone-500">Máximo</div><div className="font-bold text-guinda">{dinero(stat?.maximo)}</div></div>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t border-stone-200 pt-3">
        <p className="text-xs font-semibold text-stone-500">En esta vista del mapa</p>
        {vista.lejano ? (
          <p className="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-200">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden /> Acércate para ver las tortillerías y sus precios.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white p-2.5 ring-1 ring-stone-200"><div className="text-xl font-bold leading-tight">{entero(resumenVista.total)}</div><div className="text-[11px] text-stone-500">tortillerías visibles</div></div>
              <div className="rounded-xl bg-white p-2.5 ring-1 ring-stone-200"><div className="text-xl font-bold leading-tight">{entero(resumenVista.con)}</div><div className="text-[11px] text-stone-500">con precio de {producto === "maiz" ? "maíz" : "masa"}</div></div>
              <div className="rounded-xl bg-white p-2.5 ring-1 ring-stone-200"><div className="text-xl font-bold leading-tight">{dinero(resumenVista.prom)}</div><div className="text-[11px] text-stone-500">promedio visible</div></div>
              <div className="rounded-xl bg-white p-2.5 ring-1 ring-stone-200"><div className="text-xl font-bold leading-tight">{resumenVista.min == null ? "—" : `${dinero(resumenVista.min)} – ${dinero(resumenVista.max)}`}</div><div className="text-[11px] text-stone-500">rango visible</div></div>
            </div>
            {(resumenVista.alertas > 0 || resumenVista.porValidar > 0) && (
              <p className="flex flex-wrap gap-x-3 text-xs text-stone-600">
                {resumenVista.alertas > 0 && <span className="font-semibold text-red-600">⚠ {resumenVista.alertas} con alerta de precio</span>}
                {resumenVista.porValidar > 0 && <span className="font-semibold text-amber-700">{resumenVista.porValidar} por validar</span>}
              </p>
            )}
          </>
        )}
      </div>

      <div className="space-y-1.5 border-t border-stone-200 pt-3">
        <p className="text-xs font-semibold text-stone-500">Tendencia {zona ? `· ${zona.nombre}` : "· nacional"}</p>
        <Tendencia datos={tendencia} alto={170} />
      </div>

      <div className="space-y-2 border-t border-stone-200 pt-3 text-xs text-stone-600">
        <p className="font-semibold text-stone-500">Cómo leer el mapa</p>
        <div>
          <div className="h-2.5 rounded-full" style={{ background: `linear-gradient(to right, ${COLOR_BAJO}, ${COLOR_MEDIO}, ${COLOR_ALTO})` }} />
          <div className="mt-1 flex justify-between font-semibold"><span>{dinero(vista.rango[0])} más barato</span><span>{dinero(vista.rango[1])} más caro</span></div>
        </div>
        <ul className="space-y-1">
          <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-stone-400" /> Sin precio capturado</li>
          <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-[3px] border-dorado bg-white" /> Tortillería por validar</li>
          <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border-[3px] border-red-600 bg-white" /> Con alerta de precio</li>
          <li className="flex items-center gap-2"><Store className="h-3.5 w-3.5 text-guinda" /> De lejos: cada círculo es una zona (tamaño = tortillerías, color = precio promedio). Al acercarte se ve cada tortillería.</li>
        </ul>
      </div>
    </div>
  );

  return (
    <div className="flex h-full w-full bg-stone-200">
    <div className="relative h-full min-w-0 flex-1">
      <Suspense fallback={<div className="grid h-full place-items-center text-stone-500"><Loader2 className="h-7 w-7 animate-spin" /></div>}>
        <Mapa ref={ref} producto={producto} dias={dias} soloConPrecios={solo} tick={tick} onVista={setVista} onSeleccion={setSel} seleccion={sel && { id: sel.id, lat: sel.lat, lng: sel.lng }} />
      </Suspense>

      {/* Estado del mapa */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-3 lg:left-[22.5rem] lg:justify-start lg:pl-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/95 px-3.5 py-1.5 text-xs font-semibold text-stone-700 shadow-lg ring-1 ring-black/5">
          {vista.cargando ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin text-guinda" aria-hidden /> Cargando…</>
          ) : vista.lejano ? (
            <><ShieldAlert className="h-3.5 w-3.5 text-dorado" aria-hidden /> Acércate para ver las tortillerías</>
          ) : vista.modo === "celdas" ? (
            <><MapPin className="h-3.5 w-3.5 text-guinda" aria-hidden /> {entero(resumenVista.total)} tortillerías en {vista.celdas.length} zonas · toca una para acercarte</>
          ) : (
            <><MapPin className="h-3.5 w-3.5 text-guinda" aria-hidden /> {entero(resumenVista.total)} tortillerías · {entero(resumenVista.con)} con precio</>
          )}
        </div>
      </div>

      {/* Escritorio: panel lateral flotante */}
      <aside className="absolute inset-y-3 left-3 z-20 hidden w-[21rem] overflow-y-auto overscroll-contain rounded-2xl bg-stone-50 p-4 shadow-2xl ring-1 ring-black/5 lg:block">{panel}</aside>

      {/* Celular y tableta: hoja inferior */}
      {!sel && <div className="lg:hidden">
        <div className="absolute inset-x-0 bottom-0 z-20 flex max-h-[78%] flex-col rounded-t-3xl bg-stone-50 shadow-[0_-12px_30px_-10px_rgba(0,0,0,.4)]">
          <button onClick={() => setAbierto(!abierto)} className="flex shrink-0 items-center gap-3 px-4 pb-2 pt-3 text-left" aria-expanded={abierto}>
            <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-stone-300" aria-hidden />
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-guinda/10 text-guinda">{abierto ? <X className="h-5 w-5" /> : <SlidersHorizontal className="h-5 w-5" />}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold leading-tight">{abierto ? "Filtros y estadísticas" : `${producto === "maiz" ? "Maíz" : "Masa"} · ${dias === 0 ? "todo" : `${dias} días`}`}</span>
              <span className="block truncate text-xs text-stone-500">{vista.lejano ? "Acércate para ver los precios" : `${entero(resumenVista.con)} con precio · promedio ${dinero(resumenVista.prom)}`}</span>
            </span>
            <ChevronUp className={`h-5 w-5 text-stone-400 transition ${abierto ? "rotate-180" : ""}`} aria-hidden />
          </button>
          {abierto && <div className="paso min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6">{panel}</div>}
        </div>
      </div>}
      {/* Teléfono: el detalle es una hoja inferior que deja ver el mapa arriba */}
      {sel && (
        <div className="paso absolute inset-x-0 bottom-0 z-30 h-[56%] overflow-hidden rounded-t-3xl shadow-[0_-12px_30px_-10px_rgba(0,0,0,.4)] lg:hidden">{detalle}</div>
      )}
    </div>

    {/* Escritorio: panel lateral que empuja al mapa en lugar de taparlo */}
    <aside
      className={`hidden shrink-0 overflow-hidden border-l border-stone-200 bg-stone-50 transition-[width] duration-300 ease-[cubic-bezier(.3,.9,.3,1)] lg:block ${sel ? "w-[24rem]" : "w-0 border-l-0"}`}
      aria-hidden={!sel}
    >
      <div className="h-full w-[24rem]">{detalle}</div>
    </aside>
    </div>
  );
}
