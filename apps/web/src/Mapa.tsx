import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Props = { lat: number; lng: number; onCambio: (lat: number, lng: number) => void };

export default function Mapa({ lat, lng, onCambio }: Props) {
  const cont = useRef<HTMLDivElement>(null);
  const marcador = useRef<maplibregl.Marker | null>(null);
  const mapa = useRef<maplibregl.Map | null>(null);
  const cb = useRef(onCambio);
  cb.current = onCambio;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: cont.current!,
      center: [lng, lat],
      zoom: 17,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });
    const mk = new maplibregl.Marker({ color: "#9D2449", draggable: true }).setLngLat([lng, lat]).addTo(m);
    mk.on("dragend", () => {
      const p = mk.getLngLat();
      cb.current(p.lat, p.lng);
    });
    m.on("click", (e) => {
      mk.setLngLat(e.lngLat);
      cb.current(e.lngLat.lat, e.lngLat.lng);
    });
    mapa.current = m;
    marcador.current = mk;
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Si cambia la posición desde fuera (botón GPS), mover el pin
  useEffect(() => {
    marcador.current?.setLngLat([lng, lat]);
    mapa.current?.easeTo({ center: [lng, lat] });
  }, [lat, lng]);

  return <div ref={cont} className="h-72 w-full overflow-hidden rounded-2xl" role="application" aria-label="Mapa para marcar la tortillería" />;
}
