import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Pos = { lat: number; lng: number };
type Props = {
  pos?: Pos;
  /** Centro inicial cuando aún no hay posición elegida (p. ej. el municipio) */
  centro?: Pos;
  onElegir: (lat: number, lng: number) => void;
};

// Estilo vectorial moderno y gratuito (OpenFreeMap)
const ESTILO = "https://tiles.openfreemap.org/styles/positron";
const MEXICO: Pos = { lat: 23.6, lng: -102.5 };

function crearPin() {
  const el = document.createElement("div");
  el.innerHTML = `<svg width="36" height="46" viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 4px 6px rgba(0,0,0,.35))"><path d="M20 0C9 0 0 9 0 20c0 14 20 32 20 32s20-18 20-32C40 9 31 0 20 0z" fill="#9D2449"/><circle cx="20" cy="20" r="8" fill="#fff"/></svg>`;
  el.style.cursor = "grab";
  return el;
}

/** El mapa ocupa todo el alto disponible de su contenedor */
export default function Mapa({ pos, centro, onElegir }: Props) {
  const cont = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const pin = useRef<maplibregl.Marker | null>(null);
  const cb = useRef(onElegir);
  cb.current = onElegir;

  useEffect(() => {
    const inicio = pos ?? centro ?? MEXICO;
    const m = new maplibregl.Map({
      container: cont.current!,
      style: ESTILO,
      center: [inicio.lng, inicio.lat],
      zoom: pos ? 17 : centro ? 12 : 4.5,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    m.on("click", (e) => cb.current(e.lngLat.lat, e.lngLat.lng));
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(cont.current!);
    mapa.current = m;
    return () => {
      ro.disconnect();
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !pos) return;
    if (!pin.current) {
      pin.current = new maplibregl.Marker({ element: crearPin(), draggable: true, anchor: "bottom" }).setLngLat([pos.lng, pos.lat]).addTo(m);
      pin.current.on("dragend", () => {
        const p = pin.current!.getLngLat();
        cb.current(p.lat, p.lng);
      });
    } else {
      pin.current.setLngLat([pos.lng, pos.lat]);
    }
    m.flyTo({ center: [pos.lng, pos.lat], zoom: Math.max(m.getZoom(), 17), duration: 700 });
  }, [pos?.lat, pos?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pos && centro) mapa.current?.flyTo({ center: [centro.lng, centro.lat], zoom: 12, duration: 700 });
  }, [centro?.lat, centro?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={cont} className="h-full w-full overflow-hidden rounded-2xl ring-1 ring-black/5" role="application" aria-label="Mapa para marcar la tortillería" />;
}
