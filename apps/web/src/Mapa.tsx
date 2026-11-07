import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { buscarLugar, type Lugar } from "./geocoder";

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
  el.innerHTML = `<svg width="40" height="52" viewBox="0 0 40 52" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 4px 6px rgba(0,0,0,.35))"><path d="M20 0C9 0 0 9 0 20c0 14 20 32 20 32s20-18 20-32C40 9 31 0 20 0z" fill="#9D2449"/><circle cx="20" cy="20" r="8" fill="#fff"/></svg>`;
  el.style.cursor = "grab";
  return el;
}

export default function Mapa({ pos, centro, onElegir }: Props) {
  const cont = useRef<HTMLDivElement>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const pin = useRef<maplibregl.Marker | null>(null);
  const cb = useRef(onElegir);
  cb.current = onElegir;

  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Lugar[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [sinResultados, setSinResultados] = useState(false);

  // Crear el mapa una sola vez
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
    mapa.current = m;
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mover/crear el pin cuando cambia la posición
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

  // Centrar en el municipio si todavía no hay pin
  useEffect(() => {
    if (!pos && centro) mapa.current?.flyTo({ center: [centro.lng, centro.lat], zoom: 12, duration: 700 });
  }, [centro?.lat, centro?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Búsqueda con espera (respeta el uso razonable del servicio gratuito)
  useEffect(() => {
    setSinResultados(false);
    if (q.trim().length < 3) return setResultados([]);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await buscarLugar(q, ctrl.signal);
        setResultados(r);
        setSinResultados(r.length === 0);
      } catch {
        /* cancelada o sin red */
      } finally {
        setBuscando(false);
      }
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  function elegir(l: Lugar) {
    setQ("");
    setResultados([]);
    cb.current(l.lat, l.lng);
  }

  return (
    <div className="relative overflow-hidden rounded-3xl shadow-lg ring-1 ring-black/5">
      <div ref={cont} className="h-[26rem] w-full" role="application" aria-label="Mapa para marcar la tortillería" />

      <div className="absolute inset-x-3 top-3">
        <div className="flex items-center gap-2 rounded-2xl bg-white/95 px-3 shadow-lg backdrop-blur">
          <Search className="h-5 w-5 shrink-0 text-stone-400" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar calle, colonia o lugar"
            aria-label="Buscar dirección"
            className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-stone-400"
          />
          {buscando ? (
            <Loader2 className="h-5 w-5 animate-spin text-guinda" aria-hidden />
          ) : q ? (
            <button onClick={() => setQ("")} aria-label="Borrar búsqueda" className="rounded-full p-1 text-stone-400 hover:text-stone-700">
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </div>

        {(resultados.length > 0 || sinResultados) && (
          <ul className="mt-2 max-h-60 overflow-auto rounded-2xl bg-white/95 py-1 shadow-xl backdrop-blur">
            {sinResultados && <li className="px-4 py-3 text-sm text-stone-500">Sin resultados. Prueba con otra palabra o toca el mapa.</li>}
            {resultados.map((l, i) => (
              <li key={i}>
                <button onClick={() => elegir(l)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-stone-100">
                  <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-guinda" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{l.nombre}</span>
                    <span className="block truncate text-sm text-stone-500">{l.detalle}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
