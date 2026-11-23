import type { Map as MapaLibre, StyleSpecification } from "maplibre-gl";

/**
 * Estilo de todos los mapas: estándar a color (OpenFreeMap "liberty": agua, parques, vegetación, carreteras y nombres de calles).
 * Sin sombreado de relieve: se ve más limpio y carga menos.
 */
export const ESTILO = "https://tiles.openfreemap.org/styles/liberty";

/**
 * Algunos lugares del mapa base vienen sin número (rank, admin_level, ref_length = nulo) y los filtros del estilo comparan ese número:
 * en cada mosaico salía "Expected value to be of type number, but found null". Se corrige el estilo ANTES de usarlo:
 * un dato nulo se toma como un valor que no cumple la comparación (el elemento simplemente no se dibuja, igual que antes pero sin el aviso).
 */
const ALTO = ["<", "<="];
const BAJO = [">", ">="];
function sanear(f: unknown): unknown {
  if (!Array.isArray(f)) return f;
  if (typeof f[0] === "string" && (ALTO.includes(f[0]) || BAJO.includes(f[0])) && Array.isArray(f[1]) && f[1][0] === "get") {
    return [f[0], ["coalesce", f[1], ALTO.includes(f[0]) ? 1e9 : -1e9], ...f.slice(2).map(sanear)];
  }
  return f.map(sanear);
}
function transformStyle(_previo: StyleSpecification | undefined, siguiente: StyleSpecification): StyleSpecification {
  return { ...siguiente, layers: siguiente.layers.map((l) => ("filter" in l && l.filter ? { ...l, filter: sanear(l.filter) as never } : l)) };
}
export const OPCIONES_ESTILO = { diff: false, transformStyle };

/**
 * Pone el estilo del mapa (ya corregido) y un ícono transparente para los que el estilo pide y su hoja de imágenes no trae
 * (swimming_pool, office, basin…). Los mapas se crean SIN estilo y se les pone con esta función.
 */
export function repararEstilo(m: MapaLibre, estilo: string | StyleSpecification = ESTILO) {
  m.on("styleimagemissing", (e) => {
    if (!m.hasImage(e.id)) m.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
  m.setStyle(estilo, OPCIONES_ESTILO);
}
