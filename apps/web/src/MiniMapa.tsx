import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ESTILO } from "./estiloMapa";

export type PuntoMini = { lat: number; lng: number };

/**
 * Mapa pequeño para ver dónde está una tortillería (y, si se tiene, dónde se hizo la captura del precio).
 * Solo lectura: sin elegir ni mover nada. Se limpia solo al cerrar.
 */
export default function MiniMapa({ tortilleria, captura, alto = 220 }: { tortilleria: PuntoMini; captura?: PuntoMini | null; alto?: number }) {
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!caja.current) return;
    let mapa: maplibregl.Map | undefined;
    try {
      mapa = new maplibregl.Map({
        container: caja.current,
        style: ESTILO,
        center: [tortilleria.lng, tortilleria.lat],
        zoom: 16,
        attributionControl: { compact: true },
        cooperativeGestures: true, // en el celular, un dedo desplaza la hoja y dos mueven el mapa
      });
      mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      new maplibregl.Marker({ color: "#7a1b3f" }).setLngLat([tortilleria.lng, tortilleria.lat]).addTo(mapa);
      if (captura) {
        new maplibregl.Marker({ color: "#2563eb" }).setLngLat([captura.lng, captura.lat]).addTo(mapa);
        mapa.fitBounds(
          [
            [Math.min(tortilleria.lng, captura.lng), Math.min(tortilleria.lat, captura.lat)],
            [Math.max(tortilleria.lng, captura.lng), Math.max(tortilleria.lat, captura.lat)],
          ],
          { padding: 50, maxZoom: 17, duration: 0 },
        );
      }
    } catch {
      /* sin WebGL: el enlace a OpenStreetMap queda como respaldo */
    }
    return () => mapa?.remove();
  }, [tortilleria.lat, tortilleria.lng, captura?.lat, captura?.lng]);

  return <div ref={caja} style={{ height: alto }} className="w-full overflow-hidden rounded-2xl bg-stone-200 ring-1 ring-stone-200" role="img" aria-label="Mapa de la ubicación" />;
}
