import type maplibregl from "maplibre-gl";

/**
 * Estilo de todos los mapas: a color (OpenFreeMap "liberty": agua, parques, vegetación y carreteras) con sombreado de relieve.
 * El relieve se calcula en el teléfono a partir de mosaicos de elevación (AWS Open Data, gratis y sin clave).
 */
export const ESTILO = "https://tiles.openfreemap.org/styles/liberty";

/** Dónde están los mosaicos de elevación (también los guarda la caché sin conexión, ver vite.config.ts) */
export const HOST_ELEVACION = "s3.amazonaws.com";
export const RUTA_ELEVACION = "/elevation-tiles-prod/";

/** Agrega el sombreado de relieve justo debajo de las etiquetas del mapa base, para que no tape nombres ni lo nuestro */
export function agregarRelieve(m: maplibregl.Map) {
  try {
    if (m.getSource("elevacion")) return;
    m.addSource("elevacion", {
      type: "raster-dem",
      tiles: [`https://${HOST_ELEVACION}${RUTA_ELEVACION}terrarium/{z}/{x}/{y}.png`],
      encoding: "terrarium",
      tileSize: 256,
      maxzoom: 12,
      attribution: "Relieve: Mapzen / AWS Open Data",
    });
    const primeraEtiqueta = m.getStyle().layers.find((l) => l.type === "symbol")?.id;
    m.addLayer(
      {
        id: "relieve", type: "hillshade", source: "elevacion",
        paint: { "hillshade-exaggeration": 0.5, "hillshade-shadow-color": "#5b4a32", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#7a6a50" },
      },
      primeraEtiqueta,
    );
  } catch {
    /* sin relieve el mapa se ve igual de bien: solo a color */
  }
}
