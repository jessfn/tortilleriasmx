import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Check, List, Loader2, LocateFixed, Map as MapaIcono, MapPin, Navigation, Plus, ShieldAlert, Store, WifiOff, X } from "lucide-react";
import { api } from "./api";
import { alCambiarCatalogo, cercanas, cubre, delMunicipio } from "./catalogo";
import { Aviso, Boton, Buscador, Cabecera, Hoja, Opcion } from "./ui";
import BuscadorLugar from "./BuscadorLugar";
import type { EstadoMapa, MapaRef, Punto } from "./MapaTortillerias";

const Mapa = lazy(() => import("./MapaTortillerias"));

type Pos = { lat: number; lng: number; precision?: number };
type Item = { clave: string; nombre: string };

type Props = {
  cab: { paso: number; total: number; atras: () => void };
  /** Zona elegida a mano (cuando no hay GPS o se pidió "Otra zona") */
  zona: { estado?: Item; municipio?: Item; centro?: { lat: number; lng: number }; manual: boolean };
  gps: { pos?: Pos; estado: "pidiendo" | "ok" | "error" };
  alMiUbicacion: () => void;
  alOtraZona: () => void;
  /** Elegir una tortillería existente: la pantalla espera a que el paso siguiente esté listo */
  alElegir: (p: Punto) => Promise<void>;
  modo: "elegir" | "marcar";
  setModo: (m: "elegir" | "marcar") => void;
  pin?: Pos;
  setPin: (p: Pos) => void;
  /** Pin confirmado: sigue el formulario de la tortillería nueva */
  alConfirmarPin: () => void;
};

const metros = (m: number | null | undefined) => (m == null ? "" : m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const distancia = (a: Pos, b: { lat: number; lng: number }) => {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

type Resultado = Punto & { distancia_m: number | null };

/** Paso "Tortillería": mapa a pantalla completa con las tortillerías como puntos, buscador, lista de respaldo y alta de una nueva. */
export default function PasoTortilleria(p: Props) {
  const mapaRef = useRef<MapaRef>(null);
  const [vista, setVista] = useState<"mapa" | "lista">("mapa");
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [estadoMapa, setEstadoMapa] = useState<EstadoMapa>({ lejano: false, cargando: false, total: 0 });
  const [sel, setSel] = useState<Punto | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [error, setError] = useState("");
  const [centroMapa, setCentroMapa] = useState<{ lat: number; lng: number }>();
  const [sinMapaBase, setSinMapaBase] = useState(false);
  // Cambia cuando termina una descarga de estado o se agrega una tortillería nueva del teléfono
  const [versionCatalogo, setVersionCatalogo] = useState(0);
  useEffect(() => alCambiarCatalogo(() => setVersionCatalogo((v) => v + 1)), []);

  // Lista de respaldo
  const [km, setKm] = useState(5);
  const [lista, setLista] = useState<Resultado[]>([]);
  const [cargandoLista, setCargandoLista] = useState(false);
  const [visibles, setVisibles] = useState(60);

  const marcando = p.modo === "marcar";
  const miPos = p.zona.manual ? undefined : p.gps.pos;
  const referencia = miPos ?? centroMapa ?? p.zona.centro;

  // Búsqueda en vivo por nombre o calle, tomando en cuenta TODAS las de la zona (no solo las visibles)
  useEffect(() => {
    if (marcando) return;
    const t = q.trim();
    if (t.length < 2) return setResultados([]);
    let vigente = true;
    setBuscando(true);
    // Con el estado descargado se busca en el teléfono (sin internet y más rápido)
    const local = referencia && cubre(referencia) ? cercanas(referencia, 50, t, 30) : p.zona.municipio && delMunicipio(p.zona.municipio.clave, "", undefined, 1).length ? delMunicipio(p.zona.municipio.clave, t, undefined, 30) : null;
    if (local) {
      setResultados(local);
      setBuscando(false);
      return;
    }
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ q: t, limite: "30" });
      if (referencia) {
        qs.set("lat", String(referencia.lat));
        qs.set("lng", String(referencia.lng));
        qs.set("km", "50");
      } else if (p.zona.municipio) qs.set("municipio", p.zona.municipio.clave);
      api<Resultado[]>(`/tortillerias?${qs}`)
        .then((r) => vigente && setResultados(r))
        .catch(() => vigente && setResultados([]))
        .finally(() => vigente && setBuscando(false));
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, marcando, referencia?.lat, referencia?.lng, p.zona.municipio?.clave, versionCatalogo]);

  // Lista de respaldo: radio alrededor de mi ubicación o el municipio
  useEffect(() => {
    if (vista !== "lista" || marcando) return;
    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    if (miPos && km > 0) {
      qs.set("lat", String(miPos.lat));
      qs.set("lng", String(miPos.lng));
      qs.set("km", String(km));
    } else if (p.zona.municipio) {
      qs.set("municipio", p.zona.municipio.clave);
      if (miPos) {
        qs.set("lat", String(miPos.lat));
        qs.set("lng", String(miPos.lng));
      }
    } else if (centroMapa) {
      qs.set("lat", String(centroMapa.lat));
      qs.set("lng", String(centroMapa.lng));
      qs.set("km", "5");
    } else return;

    // Con el estado descargado la lista sale del teléfono: cercanía calculada con el GPS, funciona sin señal
    const delTelefono = miPos && km > 0 ? (cubre(miPos) ? cercanas(miPos, km, q.trim()) : null)
      : p.zona.municipio ? (delMunicipio(p.zona.municipio.clave, "", undefined, 1).length ? delMunicipio(p.zona.municipio.clave, q.trim(), miPos) : null)
      : centroMapa && cubre(centroMapa) ? cercanas(centroMapa, 5, q.trim())
      : null;
    if (delTelefono) {
      setLista(delTelefono);
      setVisibles(60);
      setCargandoLista(false);
      return;
    }
    let vigente = true;
    setCargandoLista(true);
    const t = setTimeout(
      () =>
        api<Resultado[]>(`/tortillerias?${qs}`)
          .then((r) => vigente && (setLista(r), setVisibles(60)))
          .catch((e) => vigente && setError(e.message))
          .finally(() => vigente && setCargandoLista(false)),
      200,
    );
    return () => {
      vigente = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista, marcando, q, km, miPos?.lat, miPos?.lng, p.zona.municipio?.clave, centroMapa?.lat, centroMapa?.lng, versionCatalogo]);

  const elegirResultado = (r: Resultado) => {
    setQ("");
    setResultados([]);
    setVista("mapa");
    setSel(r);
    mapaRef.current?.volarA(r.lat, r.lng, 17);
  };

  async function elegir() {
    if (!sel) return;
    setEligiendo(true);
    setError("");
    try {
      await p.alElegir(sel);
    } catch (e) {
      setError((e as Error).message);
      setEligiendo(false);
    }
  }

  const titulo = marcando ? "Ubicación" : "Tortillería";
  const sub = marcando ? "Marca el punto de la tortillería nueva" : "Toca un punto y elígela";
  const dist = sel && miPos ? distancia(miPos, sel) : null;

  return (
    <>
      <Cabecera
        paso={p.cab.paso}
        total={p.cab.total}
        titulo={titulo}
        subtitulo={sub}
        icono={marcando ? MapPin : Store}
        atras={marcando ? () => p.setModo("elegir") : p.cab.atras}
      >
        {marcando ? (
          <BuscadorLugar
            onElegir={(l) => {
              p.setPin({ lat: l.lat, lng: l.lng });
              mapaRef.current?.volarA(l.lat, l.lng, 17);
            }}
          />
        ) : (
          <div className="relative">
            <Buscador value={q} onChange={setQ} placeholder="Buscar por nombre o calle" cargando={buscando} />
            {q.trim().length >= 2 && !buscando && (
              <ul className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[45dvh] overflow-y-auto rounded-xl bg-white py-1 text-stone-900 shadow-2xl ring-1 ring-black/5">
                {resultados.length === 0 && <li className="px-4 py-3 text-sm text-stone-500">No encontramos esa tortillería cerca. Prueba con otra palabra o agrega una nueva.</li>}
                {resultados.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => elegirResultado(r)} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-stone-100">
                      <Store className="mt-0.5 h-5 w-5 shrink-0 text-guinda" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium">{r.nombre}</span>
                        <span className="block truncate text-xs text-stone-500">
                          {r.domicilio ?? "Sin domicilio"}
                          {r.distancia_m != null && ` · ${metros(r.distancia_m)}`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!marcando && (
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/20 p-1" role="tablist" aria-label="Cómo ver las tortillerías">
              {(
                [
                  ["mapa", "Mapa", MapaIcono],
                  ["lista", "Lista", List],
                ] as const
              ).map(([v, texto, I]) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={vista === v}
                  onClick={() => setVista(v)}
                  className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition ${vista === v ? "bg-white text-guinda shadow" : "text-white/85"}`}
                >
                  <I className="h-3.5 w-3.5" aria-hidden /> {texto}
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                setSel(null);
                setError("");
                setVista("mapa");
                p.setModo("marcar");
              }}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-dorado px-3.5 text-sm font-bold text-guinda-oscuro shadow-md active:scale-95"
            >
              <Plus className="h-4 w-4" strokeWidth={3} /> Nueva
            </button>
          </div>
        )}
      </Cabecera>

      <Hoja>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* El mapa se queda montado (aunque se vea la lista) para no volver a cargarlo */}
          <div className={`absolute inset-0 ${vista === "mapa" || marcando ? "" : "invisible"}`}>
            <Suspense fallback={<div className="h-full animate-pulse bg-stone-200" />}>
              <Mapa
                ref={mapaRef}
                modo={p.modo}
                pos={miPos}
                centro={p.zona.centro}
                pin={p.pin}
                filtro={q}
                seleccionId={sel?.id}
                onSeleccion={(x) => {
                  setError("");
                  setSel(x);
                }}
                onPin={(lat, lng) => p.setPin({ lat, lng })}
                onEstado={setEstadoMapa}
                onCentro={(lat, lng) => setCentroMapa({ lat, lng })}
                onRespaldo={setSinMapaBase}
              />
            </Suspense>

            {sinMapaBase && (
              <div className="pointer-events-none absolute inset-x-0 top-14 flex justify-center px-3">
                <p className="flex max-w-sm items-center gap-1.5 rounded-xl bg-stone-900/85 px-3 py-1.5 text-center text-[11px] font-medium leading-snug text-white shadow-lg">
                  <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden /> Sin conexión: el mapa no muestra calles, pero puedes elegir por cercanía
                </p>
              </div>
            )}

            {/* Estado del mapa */}
            {!marcando && (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-3">
                <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-white/95 px-3.5 py-1.5 text-xs font-semibold text-stone-700 shadow-lg ring-1 ring-black/5">
                  {p.gps.estado === "pidiendo" && !p.zona.manual ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-guinda" aria-hidden /> Buscando tu ubicación…
                    </>
                  ) : estadoMapa.lejano ? (
                    <>
                      <ShieldAlert className="h-3.5 w-3.5 text-dorado" aria-hidden /> Acércate para ver las tortillerías
                    </>
                  ) : estadoMapa.cargando ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-guinda" aria-hidden /> Cargando…
                    </>
                  ) : estadoMapa.zonas ? (
                    <>
                      <Store className="h-3.5 w-3.5 text-guinda" aria-hidden /> {estadoMapa.total.toLocaleString("es-MX")} tortillerías · toca una zona para acercarte
                    </>
                  ) : (
                    <>
                      <Store className="h-3.5 w-3.5 text-guinda" aria-hidden /> {estadoMapa.total.toLocaleString("es-MX")} {estadoMapa.total === 1 ? "tortillería aquí" : "tortillerías aquí"}
                    </>
                  )}
                  {!p.zona.manual && (
                    <button onClick={p.alOtraZona} className="ml-1 border-l border-stone-200 pl-2 text-guinda">
                      Otra zona
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Lista de respaldo */}
          {vista === "lista" && !marcando && (
            <div className="absolute inset-0 overflow-y-auto overscroll-contain px-3 pb-3 pt-4" onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) setVisibles((v) => v + 60);
            }}>
              {miPos && (
                <div className="mb-2 grid grid-cols-5 gap-1 rounded-xl bg-stone-200/70 p-1" role="radiogroup" aria-label="Distancia">
                  {[1, 5, 10, 20, 0].map((v) => (
                    <button key={v} role="radio" aria-checked={km === v} onClick={() => setKm(v)} className={`h-8 rounded-lg text-xs font-semibold transition ${km === v ? "bg-white text-guinda shadow" : "text-stone-600"}`}>
                      {v === 0 ? "Muni." : `${v} km`}
                    </button>
                  ))}
                </div>
              )}
              <p className="px-1 pb-2 text-xs text-stone-500">
                {cargandoLista ? "Buscando…" : `${lista.length.toLocaleString("es-MX")} tortillerías${miPos && km > 0 ? ` a ${km} km o menos` : ""}${q.trim() ? ` con “${q.trim()}”` : ""}`}
              </p>
              <div className="space-y-2">
                {lista.slice(0, visibles).map((t) => (
                  <Opcion key={t.id} icono={Store} activo={sel?.id === t.id} onClick={() => setSel(t)}>
                    <div className="font-medium">{t.nombre}</div>
                    <div className="text-xs text-stone-500">
                      {t.domicilio ?? "Sin domicilio"}
                      {t.distancia_m != null && ` · ${metros(t.distancia_m)}`}
                      {t.estatus === "pendiente" && " · por validar"}
                      {t.estatus === "porenviar" && " · por enviar"}
                    </div>
                  </Opcion>
                ))}
                {!cargandoLista && lista.length === 0 && <p className="px-1 py-6 text-center text-sm text-stone-500">No hay resultados. Amplía el radio o agrega una nueva.</p>}
              </div>
              <div className="h-40" aria-hidden />
            </div>
          )}

          {/* Zona inferior: botón de mi ubicación y tarjeta de la tortillería (o confirmación del pin) */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-end gap-2 p-3 pb-9">
            {!marcando && vista === "mapa" && p.gps.estado !== "pidiendo" && (
              <button
                onClick={() => {
                  if (miPos) mapaRef.current?.volarA(miPos.lat, miPos.lng, 16);
                  else p.alMiUbicacion();
                }}
                aria-label="Mi ubicación"
                className="pointer-events-auto grid h-12 w-12 place-items-center rounded-full bg-white text-guinda shadow-xl ring-1 ring-black/5 active:scale-95"
              >
                <LocateFixed className="h-6 w-6" aria-hidden />
              </button>
            )}

            {marcando ? (
              <div className="pointer-events-auto w-full rounded-2xl bg-white p-3 shadow-2xl ring-1 ring-black/5">
                <p className="flex items-start gap-2 text-sm text-stone-600">
                  <Navigation className="mt-0.5 h-4 w-4 shrink-0 text-dorado" aria-hidden />
                  Arrastra el pin dorado o toca el mapa en la puerta de la tortillería. Acércate para ser más exacto.
                </p>
                <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-2">
                  <Boton variante="secundario" onClick={() => p.setModo("elegir")} icono={X} className="!min-h-12">
                    Cancelar
                  </Boton>
                  <Boton onClick={p.alConfirmarPin} disabled={!p.pin} icono={Check}>
                    Confirmar ubicación
                  </Boton>
                </div>
              </div>
            ) : (
              sel && (
                <div className="paso pointer-events-auto w-full rounded-2xl bg-white p-3 shadow-2xl ring-1 ring-black/5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-guinda/10 text-guinda">
                      <Store className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold leading-tight">{sel.nombre}</p>
                      <p className="mt-0.5 text-xs text-stone-500">{sel.domicilio ?? "Sin domicilio"}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-500">
                        {dist != null && (
                          <span className="inline-flex items-center gap-1 font-medium text-stone-600">
                            <MapPin className="h-3 w-3" aria-hidden /> a {metros(dist)} de ti
                          </span>
                        )}
                        {sel.estatus === "pendiente" && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200">Por validar</span>}
                        {sel.estatus === "porenviar" && <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-slate-300">Por enviar</span>}
                      </p>
                    </div>
                    <button onClick={() => setSel(null)} aria-label="Cerrar" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-stone-400 hover:bg-stone-100">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {error && <div className="mt-2"><Aviso>{error}</Aviso></div>}
                  <Boton onClick={elegir} disabled={eligiendo} icono={eligiendo ? Loader2 : Check} className="mt-2.5">
                    {eligiendo ? "Un momento…" : "Elegir esta tortillería"}
                  </Boton>
                </div>
              )
            )}
          </div>
        </div>
      </Hoja>
    </>
  );
}
