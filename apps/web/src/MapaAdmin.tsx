import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "./api";
import { COLOR_ALTO, COLOR_BAJO, COLOR_MEDIO, dinero, diaCorto, rangoPrecios } from "./AdminVivo";

export type Precio = { precio: number; fecha: string } | null;
export type PuntoAdm = {
  id: string; nombre: string; domicilio: string | null; estatus: string; origen: string; lat: number; lng: number;
  n_capturas: number; ultimo_maiz: Precio; ultima_masa: Precio; alerta: boolean;
};
export type VistaMapa = { puntos: PuntoAdm[]; lejano: boolean; cargando: boolean; rango: [number, number] };
export type MapaAdminRef = {
  ajustarA: (bbox: [number, number, number, number]) => void;
  volarA: (lat: number, lng: number, zoom?: number) => void;
};

type Props = {
  producto: "maiz" | "masa";
  /** Días hacia atrás (0 = todo el historial) */
  dias: number;
  soloConPrecios: boolean;
  /** Se incrementa para volver a pedir los datos (actualización en vivo) */
  tick: number;
  onVista: (v: VistaMapa) => void;
  onDetalle: (id: string) => void;
  onZoom?: (z: number) => void;
};

const ESTILO = "https://tiles.openfreemap.org/styles/positron";
const ZOOM_MIN = 8.5; // más lejos hay demasiadas tortillerías para dibujar
const MEXICO = { lat: 23.6, lng: -102.5 };

/** Mapa de supervisión: puntos coloreados por precio, grupos con su promedio y ventana con el detalle al tocar un punto */
const MapaAdmin = forwardRef<MapaAdminRef, Props>(function MapaAdmin(props, ref) {
  const cont = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const listo = useRef(false);
  const ctrl = useRef<AbortController | null>(null);
  const temporizador = useRef<number>();
  const datos = useRef<PuntoAdm[]>([]);
  const popup = useRef<maplibregl.Popup | null>(null);
  const p = useRef(props);
  p.current = props;

  useImperativeHandle(ref, () => ({
    ajustarA: (b) => mapa.current?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, duration: 900, maxZoom: 14 }),
    volarA: (lat, lng, zoom = 15) => mapa.current?.flyTo({ center: [lng, lat], zoom, duration: 800 }),
  }));

  const precioDe = (x: PuntoAdm) => (p.current.producto === "maiz" ? x.ultimo_maiz?.precio : x.ultima_masa?.precio) ?? 0;

  const pintar = () => {
    const m = mapa.current;
    if (!m || !listo.current) return;
    const precios = datos.current.map(precioDe).filter((v) => v > 0);
    const rango = rangoPrecios(precios, p.current.producto === "maiz" ? [20, 32] : [14, 24]);
    const fuente = m.getSource("puntos") as GeoJSONSource | undefined;
    fuente?.setData({
      type: "FeatureCollection",
      features: datos.current.map((x) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [x.lng, x.lat] },
        properties: { id: x.id, p: precioDe(x), n: x.n_capturas, estatus: x.estatus, alerta: x.alerta ? 1 : 0 },
      })),
    });
    const escala = ["interpolate", ["linear"], ["get", "p"], rango[0], COLOR_BAJO, (rango[0] + rango[1]) / 2, COLOR_MEDIO, rango[1], COLOR_ALTO];
    m.setPaintProperty("pts-con", "circle-color", escala as any);
    m.setPaintProperty("grupos", "circle-color", [
      "case", [">", ["get", "con"], 0],
      ["interpolate", ["linear"], ["/", ["get", "suma"], ["get", "con"]], rango[0], COLOR_BAJO, (rango[0] + rango[1]) / 2, COLOR_MEDIO, rango[1], COLOR_ALTO],
      "#a8a29e",
    ] as any);
    p.current.onVista({ puntos: datos.current, lejano: false, cargando: false, rango });
  };

  const cargar = () => {
    const m = mapa.current;
    if (!m || !listo.current) return;
    p.current.onZoom?.(m.getZoom());
    if (m.getZoom() < ZOOM_MIN) {
      ctrl.current?.abort();
      datos.current = [];
      pintar();
      p.current.onVista({ puntos: [], lejano: true, cargando: false, rango: [20, 32] });
      return;
    }
    const b = m.getBounds();
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    p.current.onVista({ puntos: datos.current, lejano: false, cargando: true, rango: [20, 32] });
    const q = new URLSearchParams({
      bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(6)).join(","),
      dias: String(p.current.dias),
      ...(p.current.soloConPrecios ? { solo: "precios" } : {}),
    });
    api<{ puntos: PuntoAdm[] } | { demasiadas: true }>(`/admin/mapa?${q}`, { signal: c.signal })
      .then((r) => {
        if (c.signal.aborted) return;
        if (!("puntos" in r)) {
          datos.current = [];
          pintar();
          return p.current.onVista({ puntos: [], lejano: true, cargando: false, rango: [20, 32] });
        }
        datos.current = r.puntos;
        pintar();
      })
      .catch(() => {
        if (!c.signal.aborted) p.current.onVista({ puntos: datos.current, lejano: false, cargando: false, rango: [20, 32] });
      });
  };
  const programar = () => {
    window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(cargar, 300);
  };

  // Ventana emergente con lo más importante de la tortillería (se arma con nodos de texto: nada de HTML de datos)
  const abrirPopup = (x: PuntoAdm, m: maplibregl.Map) => {
    popup.current?.remove();
    const el = document.createElement("div");
    el.className = "popup-admin";
    const fila = (texto: string, clase = "") => {
      const d = document.createElement("div");
      d.className = clase;
      d.textContent = texto;
      return d;
    };
    const cab = document.createElement("div");
    cab.className = "pa-cab";
    cab.append(fila(x.nombre, "pa-nombre"));
    const insignia = fila(x.estatus === "pendiente" ? "Por validar" : "Validada", `pa-ins ${x.estatus === "pendiente" ? "pa-pend" : "pa-ok"}`);
    cab.append(insignia);
    el.append(cab, fila(x.domicilio || "Sin domicilio", "pa-dom"));

    const precios = document.createElement("div");
    precios.className = "pa-precios";
    for (const [t, v] of [["Maíz", x.ultimo_maiz], ["Masa", x.ultima_masa]] as const) {
      const c = document.createElement("div");
      c.className = "pa-precio";
      c.append(fila(t, "pa-t"), fila(v ? dinero(v.precio) : "Sin precio", v ? "pa-v" : "pa-v pa-sin"));
      if (v) c.append(fila(diaCorto(v.fecha), "pa-f"));
      precios.append(c);
    }
    el.append(precios);
    el.append(fila(`${x.n_capturas} ${x.n_capturas === 1 ? "captura" : "capturas"} en el periodo${x.alerta ? " · ⚠ con alerta de precio" : ""}`, "pa-n"));
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "pa-boton";
    boton.textContent = "Ver detalle y revisión";
    boton.onclick = () => p.current.onDetalle(x.id);
    el.append(boton);

    popup.current = new maplibregl.Popup({ offset: 14, maxWidth: "300px", closeButton: true, className: "popup-admin-caja" })
      .setLngLat([x.lng, x.lat])
      .setDOMContent(el)
      .addTo(m);
  };

  useEffect(() => {
    const m = new maplibregl.Map({
      container: cont.current!,
      style: ESTILO,
      center: [MEXICO.lng, MEXICO.lat],
      zoom: 4.6,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    mapa.current = m;

    // Los puntos se agregan en cuanto el estilo está listo, sin esperar a que lleguen todos los mosaicos del mapa base (en redes lentas tardan)
    const iniciar = () => {
      if (listo.current) return;
      m.addSource("puntos", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true, clusterRadius: 42, clusterMaxZoom: 14,
        // para colorear cada grupo con el promedio de lo que contiene
        clusterProperties: { suma: ["+", ["get", "p"]], con: ["+", ["case", [">", ["get", "p"], 0], 1, 0]] },
      });
      m.addLayer({
        id: "grupos", type: "circle", source: "puntos", filter: ["has", "point_count"],
        paint: {
          "circle-color": "#a8a29e", "circle-opacity": 0.9, "circle-stroke-color": "#fff", "circle-stroke-width": 2,
          "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 24, 250, 30],
        },
      });
      m.addLayer({
        id: "grupos-n", type: "symbol", source: "puntos", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-allow-overlap": true },
        paint: { "text-color": "#1c1917", "text-halo-color": "rgba(255,255,255,.85)", "text-halo-width": 1.4 },
      });
      m.addLayer({
        id: "pts-sin", type: "circle", source: "puntos", filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "p"], 0]],
        paint: { "circle-color": "#a8a29e", "circle-radius": 4.5, "circle-opacity": 0.8, "circle-stroke-color": "#fff", "circle-stroke-width": 1 },
      });
      m.addLayer({
        id: "pts-con", type: "circle", source: "puntos", filter: ["all", ["!", ["has", "point_count"]], [">", ["get", "p"], 0]],
        paint: {
          "circle-color": COLOR_MEDIO,
          "circle-radius": ["step", ["get", "n"], 8, 3, 10, 10, 13],
          // borde rojo = alerta de precio · dorado = tortillería por validar · blanco = normal
          "circle-stroke-color": ["case", [">", ["get", "alerta"], 0], "#dc2626", ["==", ["get", "estatus"], "pendiente"], "#BC955C", "#ffffff"],
          "circle-stroke-width": ["case", [">", ["get", "alerta"], 0], 3.5, ["==", ["get", "estatus"], "pendiente"], 3, 2],
        },
      });
      listo.current = true;
      cargar();
    };
    if (m.isStyleLoaded()) iniciar();
    else m.once("style.load", iniciar);

    m.on("moveend", programar);
    m.on("click", (e) => {
      const g = m.queryRenderedFeatures(e.point, { layers: ["grupos"] })[0];
      if (g) {
        (m.getSource("puntos") as GeoJSONSource).getClusterExpansionZoom(g.properties!.cluster_id).then((z) => m.easeTo({ center: (g.geometry as any).coordinates, zoom: z + 0.4 }));
        return;
      }
      const f = m.queryRenderedFeatures(e.point, { layers: ["pts-con", "pts-sin"] })[0];
      if (!f) return;
      const x = datos.current.find((d) => d.id === (f.properties as any).id);
      if (x) abrirPopup(x, m);
    });
    for (const capa of ["grupos", "pts-con", "pts-sin"]) {
      m.on("mouseenter", capa, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", capa, () => (m.getCanvas().style.cursor = ""));
    }
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(cont.current!);
    return () => {
      ro.disconnect();
      window.clearTimeout(temporizador.current);
      ctrl.current?.abort();
      popup.current?.remove();
      m.remove();
      listo.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cambió el producto, el periodo o el filtro, o toca actualizar en vivo
  useEffect(() => {
    if (listo.current) cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.producto, props.dias, props.soloConPrecios, props.tick]);

  return <div ref={cont} className="h-full w-full" role="application" aria-label="Mapa de precios de tortillas" />;
});

export default MapaAdmin;
