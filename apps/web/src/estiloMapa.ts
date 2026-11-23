import type { Map as MapaLibre } from "maplibre-gl";

/**
 * Estilo de todos los mapas: estándar a color (OpenFreeMap "liberty": agua, parques, vegetación, carreteras y nombres de calles).
 * Sin sombreado de relieve: se ve más limpio y carga menos.
 */
export const ESTILO = "https://tiles.openfreemap.org/styles/liberty";

const CON_RANK = /\["get","rank"\]/;
const reemplazarRank = (f: unknown): unknown => (Array.isArray(f) ? (f.length === 2 && f[0] === "get" && f[1] === "rank" ? ["coalesce", ["get", "rank"], 0] : f.map(reemplazarRank)) : f);

/**
 * Arregla dos avisos del mapa base (no rompían nada, pero llenaban la consola y desperdiciaban trabajo en cada mosaico):
 *  1) algunos lugares del mapa vienen sin "rank" (nulo) y los filtros de los íconos esperaban un número → se toma 0;
 *  2) el estilo pide íconos que su hoja de imágenes no trae (swimming_pool, office, basin…) → se usa un ícono transparente.
 * Se aplica también cuando el estilo se vuelve a cargar (p. ej. al volver la señal).
 */
export function repararEstilo(m: MapaLibre) {
  const filtros = () => {
    const capas = m.getStyle()?.layers ?? [];
    for (const l of capas) {
      const f = (l as { filter?: unknown }).filter;
      if (f && CON_RANK.test(JSON.stringify(f)) && !JSON.stringify(f).includes('"coalesce",["get","rank"]')) m.setFilter(l.id, reemplazarRank(f) as never);
    }
  };
  m.on("styledata", filtros);
  m.on("styleimagemissing", (e) => {
    if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}
