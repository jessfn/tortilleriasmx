import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "./api";
import { agregarRelieve, ESTILO } from "./estiloMapa";
import { alCambiarCatalogo, cubre, enCaja } from "./catalogo";

export type Punto = { id: string; nombre: string; domicilio: string | null; estatus: string; lat: number; lng: number; razon_social: string | null };
/** zonas = a poco zoom se muestran zonas agrupadas (con su número de tortillerías) en lugar de puntos */
export type EstadoMapa = { lejano: boolean; cargando: boolean; total: number; zonas?: boolean };
type Zona = { lat: number; lng: number; n: number; bbox: [number, number, number, number] };
export type MapaRef = { volarA: (lat: number, lng: number, zoom?: number) => void };

type Props = {
  /** elegir: tocar un punto abre su tarjeta · marcar: se arrastra un pin para ubicar una tortillería nueva */
  modo: "elegir" | "marcar";
  /** Ubicación del censador (punto azul) */
  pos?: { lat: number; lng: number };
  /** Hacia dónde mirar cuando no hay GPS (p. ej. el municipio) */
  centro?: { lat: number; lng: number };
  pin?: { lat: number; lng: number };
  /** Filtra los puntos visibles por nombre o calle */
  filtro?: string;
  seleccionId?: string;
  onSeleccion: (p: Punto | null) => void;
  onPin: (lat: number, lng: number) => void;
  onEstado: (e: EstadoMapa) => void;
  onCentro?: (lat: number, lng: number) => void;
  /** true cuando no hay mapa base (sin señal y sin caché): solo se ve un fondo liso con los puntos */
  onRespaldo?: (activo: boolean) => void;
};

// Estilo vectorial moderno y gratuito (OpenFreeMap)
// Sin señal (y sin el mapa en caché): fondo liso crema. Sin "glyphs" no hay texto, por eso los grupos se dibujan sin número.
const ESTILO_RESPALDO: StyleSpecification = { version: 8, sources: {}, layers: [{ id: "fondo", type: "background", paint: { "background-color": "#F5F1EA" } }] };
const POR_ENVIAR = "#64748B";
const MEXICO = { lat: 23.6, lng: -102.5 };
const ZOOM_MIN_DATOS = 9.5; // más lejos que esto el servidor agrupa las tortillerías por zonas (con el estado descargado se usan sus puntos)
const CAPAS_PUNTOS = ["grupos", "grupos-n", "puntos", "puntos-pendientes", "puntos-porenviar", "seleccion"];
const GUINDA = "#9D2449";
const DORADO = "#BC955C";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function crearPin() {
  const el = document.createElement("div");
  el.innerHTML = `<svg width="38" height="48" viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 4px 6px rgba(0,0,0,.35))"><path d="M20 0C9 0 0 9 0 20c0 14 20 32 20 32s20-18 20-32C40 9 31 0 20 0z" fill="${DORADO}"/><circle cx="20" cy="20" r="8" fill="#fff"/></svg>`;
  el.style.cursor = "grab";
  return el;
}

function crearPuntoAzul() {
  const el = document.createElement("div");
  el.setAttribute("aria-label", "Estás aquí");
  el.style.cssText = "position:relative;width:20px;height:20px";
  el.innerHTML = `<span style="position:absolute;inset:-10px;border-radius:50%;background:rgba(37,99,235,.22);animation:pulsoAzul 2s ease-out infinite"></span><span style="position:absolute;inset:0;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,.4)"></span>`;
  return el;
}

/** Mapa a todo el alto con las tortillerías como puntos (con grupos al alejarse). Carga solo lo que se ve. */
const MapaTortillerias = forwardRef<MapaRef, Props>(function MapaTortillerias(props, ref) {
  const cont = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const listo = useRef(false);
  const respaldo = useRef(false);
  const [creado, setCreado] = useState(false);
  const pinM = useRef<maplibregl.Marker | null>(null);
  const azul = useRef<maplibregl.Marker | null>(null);
  const datos = useRef<Punto[]>([]);
  const ctrl = useRef<AbortController | null>(null);
  const temporizador = useRef<number>();
  const p = useRef(props);
  p.current = props;

  useImperativeHandle(ref, () => ({
    volarA: (lat, lng, zoom = 17) => mapa.current?.flyTo({ center: [lng, lat], zoom, duration: 700 }),
  }));

  const aGeoJSON = () => {
    const f = p.current.filtro ? norm(p.current.filtro.trim()) : "";
    const lista = f ? datos.current.filter((x) => norm(`${x.nombre} ${x.domicilio ?? ""}`).includes(f)) : datos.current;
    return {
      type: "FeatureCollection" as const,
      features: lista.map((x) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [x.lng, x.lat] },
        properties: { id: x.id, nombre: x.nombre, domicilio: x.domicilio ?? "", estatus: x.estatus, razon_social: x.razon_social ?? "" },
      })),
    };
  };
  const pintar = () => (mapa.current?.getSource("tortillerias") as GeoJSONSource | undefined)?.setData(aGeoJSON());

  const zonas = useRef<Zona[]>([]);
  const abreviar = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)} mil` : n >= 1000 ? `${(n / 1000).toFixed(1)} mil` : String(n));

  /** Muestra puntos (con grupos) o zonas agrupadas, según el zoom */
  const mostrar = (enZonas: boolean) => {
    const m = mapa.current;
    if (!m || !listo.current) return;
    for (const id of CAPAS_PUNTOS) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", enZonas ? "none" : "visible");
    for (const id of ["celdas-c", "celdas-n"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", enZonas ? "visible" : "none");
  };
  const pintarZonas = (lista: Zona[]) => {
    zonas.current = lista;
    (mapa.current?.getSource("celdas") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: lista.map((z, i) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [z.lng, z.lat] }, properties: { i, n: z.n, txt: abreviar(z.n) } })),
    });
    mostrar(true);
  };

  const cargar = () => {
    const m = mapa.current;
    if (!m || !listo.current) return;
    const c = m.getCenter();
    p.current.onCentro?.(c.lat, c.lng);
    const z = m.getZoom();
    const b = m.getBounds();
    ctrl.current?.abort();

    // Con el estado descargado se usa el catálogo del teléfono (también a poco zoom: el mapa agrupa los puntos solo). Funciona sin internet.
    if (cubre({ lat: c.lat, lng: c.lng })) {
      const r = enCaja(b.getWest(), b.getSouth(), b.getEast(), b.getNorth(), 60000);
      datos.current = r === "demasiadas" ? [] : r;
      mostrar(false);
      pintar();
      return p.current.onEstado({ lejano: false, cargando: false, total: datos.current.length });
    }

    const c1 = new AbortController();
    ctrl.current = c1;
    p.current.onEstado({ lejano: false, cargando: true, total: datos.current.length });
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(6)).join(",");
    const pedirZonas = () =>
      api<Zona[]>(`/tortillerias/mapa/celdas?bbox=${bbox}&zoom=${z.toFixed(2)}`, { signal: c1.signal }).then((r) => {
        if (c1.signal.aborted) return;
        datos.current = [];
        pintar();
        pintarZonas(r);
        p.current.onEstado({ lejano: false, cargando: false, total: r.reduce((a, x) => a + x.n, 0), zonas: true });
      });
    const peticion =
      z < ZOOM_MIN_DATOS
        ? pedirZonas()
        : api<Punto[] | { demasiadas: true }>(`/tortillerias/mapa?bbox=${bbox}`, { signal: c1.signal }).then((r) => {
            if (c1.signal.aborted) return;
            if (!Array.isArray(r)) return pedirZonas(); // demasiadas para dibujar una por una: se agrupan por zonas
            datos.current = r;
            mostrar(false);
            pintar();
            p.current.onEstado({ lejano: false, cargando: false, total: r.length });
          });
    peticion.catch(() => {
      if (!c1.signal.aborted) p.current.onEstado({ lejano: false, cargando: false, total: datos.current.length });
    });
  };
  const programar = () => {
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(cargar, 300);
  };

  // Crear el mapa
  useEffect(() => {
    let cancelado = false;
    let limpiar = () => {};
    void (async () => {
      // Sin señal: si el mapa base no está en caché se usa de una vez el fondo liso (el mapa nunca queda en blanco ni con error)
      let estilo: string | StyleSpecification = ESTILO;
      if (!navigator.onLine) {
        const enCache = await caches.match(ESTILO).catch(() => undefined);
        if (!enCache) {
          estilo = ESTILO_RESPALDO;
          respaldo.current = true;
          p.current.onRespaldo?.(true);
        }
      }
      if (cancelado || !cont.current) return;
      limpiar = crearMapa(estilo);
      setCreado(true);
    })();
    return () => {
      cancelado = true;
      limpiar();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function crearMapa(estilo: string | StyleSpecification) {
    const inicio = props.pos ?? props.centro ?? MEXICO;
    const m = new maplibregl.Map({
      container: cont.current!,
      style: estilo,
      center: [inicio.lng, inicio.lat],
      zoom: props.pos ? 16 : props.centro ? 13 : 4.5,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapa.current = m;

    // Los puntos se agregan en cuanto el estilo está listo, sin esperar a que lleguen todos los mosaicos del mapa base (en redes lentas tardan)
    const iniciar = () => {
      if (listo.current) return;
      if (!respaldo.current) agregarRelieve(m); // con el fondo liso (sin señal) no hay relieve
      m.addSource("tortillerias", { type: "geojson", data: aGeoJSON(), cluster: true, clusterRadius: 50, clusterMaxZoom: 15 });
      // Zonas agrupadas por el servidor (zoom bajo)
      m.addSource("celdas", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "celdas-c", type: "circle", source: "celdas", layout: { visibility: "none" },
        paint: {
          "circle-color": GUINDA, "circle-opacity": 0.92, "circle-stroke-color": "#fff", "circle-stroke-width": 2.5,
          "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "n"]], 1, 10, 6, 15, 20, 23, 60, 32, 140, 42],
        },
      });
      if (!respaldo.current)
        m.addLayer({
          id: "celdas-n", type: "symbol", source: "celdas", layout: { visibility: "none", "text-field": ["get", "txt"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-allow-overlap": true },
          paint: { "text-color": "#fff" },
        });
      m.addLayer({
        id: "grupos", type: "circle", source: "tortillerias", filter: ["has", "point_count"],
        paint: {
          "circle-color": GUINDA, "circle-opacity": 0.92, "circle-stroke-color": "#fff", "circle-stroke-width": 2,
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 20, 50, 25, 200, 30],
        },
      });
      // El número del grupo necesita fuentes del servidor de mapas: en el fondo liso el tamaño del círculo indica cuántas hay
      if (!respaldo.current)
        m.addLayer({
          id: "grupos-n", type: "symbol", source: "tortillerias", filter: ["has", "point_count"],
          layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-allow-overlap": true },
          paint: { "text-color": "#fff" },
        });
      m.addLayer({
        id: "puntos", type: "circle", source: "tortillerias", filter: ["all", ["!", ["has", "point_count"]], ["!=", ["get", "estatus"], "pendiente"], ["!=", ["get", "estatus"], "porenviar"]],
        paint: { "circle-color": GUINDA, "circle-radius": 8, "circle-stroke-color": "#fff", "circle-stroke-width": 2.5 },
      });
      // "por validar": dorado con borde oscuro (se distingue de las validadas)
      m.addLayer({
        id: "puntos-pendientes", type: "circle", source: "tortillerias", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "estatus"], "pendiente"]],
        paint: { "circle-color": DORADO, "circle-radius": 8.5, "circle-stroke-color": "#611232", "circle-stroke-width": 2.5 },
      });
      // "por enviar": alta hecha en este teléfono que todavía no llega al servidor
      m.addLayer({
        id: "puntos-porenviar", type: "circle", source: "tortillerias", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "estatus"], "porenviar"]],
        paint: { "circle-color": POR_ENVIAR, "circle-radius": 8.5, "circle-stroke-color": DORADO, "circle-stroke-width": 3 },
      });
      m.addLayer({
        id: "seleccion", type: "circle", source: "tortillerias", filter: ["==", ["get", "id"], p.current.seleccionId ?? ""],
        paint: { "circle-color": "rgba(188,149,92,0.25)", "circle-radius": 16, "circle-stroke-color": DORADO, "circle-stroke-width": 3 },
      });
      listo.current = true;
      cargar();
    };
    if (m.isStyleLoaded()) iniciar();
    else m.once("style.load", iniciar);

    m.on("moveend", programar);
    m.on("click", (e) => {
      if (p.current.modo === "marcar") return p.current.onPin(e.lngLat.lat, e.lngLat.lng);
      const zona = m.queryRenderedFeatures(e.point, { layers: ["celdas-c"] })[0];
      if (zona) {
        const zn = zonas.current[(zona.properties as any).i];
        if (!zn) return;
        const [x1, y1, x2, y2] = zn.bbox;
        if (x2 - x1 < 1e-4 && y2 - y1 < 1e-4) m.easeTo({ center: [zn.lng, zn.lat], zoom: Math.min(m.getZoom() + 3, 17), duration: 700 });
        else m.fitBounds([[x1, y1], [x2, y2]], { padding: 80, duration: 800, maxZoom: 17 });
        return;
      }
      const g = m.queryRenderedFeatures(e.point, { layers: ["grupos"] })[0];
      if (g) {
        const fuente = m.getSource("tortillerias") as GeoJSONSource;
        fuente.getClusterExpansionZoom(g.properties!.cluster_id).then((z) => m.easeTo({ center: (g.geometry as any).coordinates, zoom: z + 0.5 }));
        return;
      }
      const f = m.queryRenderedFeatures(e.point, { layers: ["puntos", "puntos-pendientes", "puntos-porenviar"] })[0];
      if (f) {
        const [lng, lat] = (f.geometry as any).coordinates as [number, number];
        const pr = f.properties as any;
        return p.current.onSeleccion({ id: pr.id, nombre: pr.nombre, domicilio: pr.domicilio || null, estatus: pr.estatus, lat, lng, razon_social: pr.razon_social || null });
      }
      p.current.onSeleccion(null);
    });
    for (const capa of ["celdas-c", "grupos", "puntos", "puntos-pendientes", "puntos-porenviar"]) {
      m.on("mouseenter", capa, () => p.current.modo === "elegir" && (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", capa, () => (m.getCanvas().style.cursor = ""));
    }

    // Si el mapa base no carga (sin señal y sin caché) se cambia al fondo liso para que nunca quede en blanco
    m.on("error", () => {
      if (listo.current || respaldo.current) return;
      respaldo.current = true;
      p.current.onRespaldo?.(true);
      m.setStyle(ESTILO_RESPALDO);
    });
    // Al volver la señal se intenta recuperar el mapa con calles
    const alVolver = () => {
      if (!respaldo.current) return;
      respaldo.current = false;
      listo.current = false;
      p.current.onRespaldo?.(false);
      m.once("style.load", iniciar);
      m.setStyle(ESTILO);
    };
    window.addEventListener("online", alVolver);
    // Cuando termina una descarga o se agrega una tortillería nueva del teléfono, se redibuja
    const sinCatalogo = alCambiarCatalogo(() => {
      if (listo.current) programar();
    });

    const ro = new ResizeObserver(() => m.resize());
    ro.observe(cont.current!);
    return () => {
      ro.disconnect();
      sinCatalogo();
      window.removeEventListener("online", alVolver);
      window.clearTimeout(temporizador.current);
      ctrl.current?.abort();
      m.remove();
      mapa.current = null;
      listo.current = false;
    };
  }

  // Punto azul "Estás aquí" y vuelo a la primera ubicación
  const primeraPos = useRef(true);
  useEffect(() => {
    const m = mapa.current;
    if (!m || !props.pos) return;
    if (!azul.current) azul.current = new maplibregl.Marker({ element: crearPuntoAzul() }).setLngLat([props.pos.lng, props.pos.lat]).addTo(m);
    else azul.current.setLngLat([props.pos.lng, props.pos.lat]);
    if (primeraPos.current) {
      primeraPos.current = false;
      m.flyTo({ center: [props.pos.lng, props.pos.lat], zoom: 16, duration: 900 });
    }
  }, [creado, props.pos?.lat, props.pos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sin GPS: mirar al municipio elegido
  useEffect(() => {
    if (!props.pos && props.centro) mapa.current?.flyTo({ center: [props.centro.lng, props.centro.lat], zoom: 13, duration: 800 });
  }, [creado, props.centro?.lat, props.centro?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtro por nombre o calle
  useEffect(() => {
    if (listo.current) pintar();
  }, [props.filtro]); // eslint-disable-line react-hooks/exhaustive-deps

  // Punto seleccionado
  useEffect(() => {
    const m = mapa.current;
    if (m && listo.current && m.getLayer("seleccion")) m.setFilter("seleccion", ["==", ["get", "id"], props.seleccionId ?? ""]);
  }, [props.seleccionId]);

  // Modo "marcar": pin arrastrable para la tortillería nueva
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    if (props.modo !== "marcar") {
      pinM.current?.remove();
      pinM.current = null;
      return;
    }
    if (!props.pin) {
      const c = props.pos ?? m.getCenter();
      p.current.onPin(c.lat, c.lng);
      return;
    }
    if (!pinM.current) {
      pinM.current = new maplibregl.Marker({ element: crearPin(), draggable: true, anchor: "bottom" }).setLngLat([props.pin.lng, props.pin.lat]).addTo(m);
      pinM.current.on("dragend", () => {
        const q = pinM.current!.getLngLat();
        p.current.onPin(q.lat, q.lng);
      });
      m.flyTo({ center: [props.pin.lng, props.pin.lat], zoom: Math.max(m.getZoom(), 17), duration: 700 });
    } else {
      pinM.current.setLngLat([props.pin.lng, props.pin.lat]);
    }
  }, [creado, props.modo, props.pin?.lat, props.pin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={cont} className="h-full w-full overflow-hidden" role="application" aria-label="Mapa de tortillerías" />;
});

export default MapaTortillerias;
