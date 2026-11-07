export type Lugar = { nombre: string; detalle: string; lat: number; lng: number };

// Photon (OpenStreetMap): búsqueda de direcciones y lugares, limitada a México
const MEXICO_BBOX = "-118.5,14.3,-86.5,32.8";

export async function buscarLugar(texto: string, señal?: AbortSignal): Promise<Lugar[]> {
  const q = texto.trim();
  if (q.length < 3) return [];
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&bbox=${MEXICO_BBOX}`, { signal: señal });
  if (!r.ok) throw new Error("No se pudo buscar el lugar");
  const j = (await r.json()) as { features: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] };
  return j.features.map((f) => {
    const p = f.properties;
    const calle = [p.street, p.housenumber].filter(Boolean).join(" ");
    return {
      nombre: p.name || calle || p.city || "Lugar",
      detalle: [calle && p.name ? calle : "", p.district, p.city, p.state].filter(Boolean).join(", "),
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    };
  });
}
