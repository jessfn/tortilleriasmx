/**
 * Importación del catálogo DENUE.
 *
 * Reglas (para poder actualizar el DENUE sin perder lo capturado por los usuarios):
 *  - `denue_catalogo` (llave id_denue) se reemplaza/actualiza completo en cada carga.
 *  - En `tortillerias` solo se crean o actualizan las filas con origen 'denue', y únicamente sus datos de catálogo
 *    (nombre, domicilio, estado, municipio y ubicación). NUNCA se tocan su estatus, fotos, autor ni nada de lo que
 *    viva en las demás tablas (usuarios, responsables, capturas de precio, fotos, alertas).
 */
export const COLUMNAS = [
  "id_denue", "clee", "nombre", "razon_social", "telefono", "correo", "cve_ent", "entidad", "cve_mun", "municipio",
  "cve_loc", "localidad", "tipo_vial", "calle", "numero_ext", "numero_int", "colonia", "codigo_postal",
  "latitud", "longitud", "codigo_scian", "personal_ocupado", "fecha_alta",
] as const;

export type Columna = (typeof COLUMNAS)[number];
export type Fila = Record<Columna, string>;
export type BaseDatos = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const NUMERICAS = new Set<Columna>(["latitud", "longitud"]);

/** Convierte una línea del archivo (separada por tabuladores) en una fila */
export function parsearLinea(linea: string, indice: Record<string, number>): Fila {
  const c = linea.split("\t");
  const f = {} as Fila;
  for (const col of COLUMNAS) f[col] = (c[indice[col]] ?? "").trim();
  return f;
}

/** Domicilio legible: "CALLE MATAMOROS 106, COL. CALVILLO CENTRO, C.P. 20802" */
export function domicilioDe(f: Fila): string {
  const via = [f.tipo_vial, f.calle].filter(Boolean).join(" ");
  const numero = [f.numero_ext, f.numero_int && `INT. ${f.numero_int}`].filter(Boolean).join(" ");
  return [[via, numero].filter(Boolean).join(" "), f.colonia && `COL. ${f.colonia}`, f.codigo_postal && `C.P. ${f.codigo_postal}`]
    .filter(Boolean)
    .join(", ");
}

const nombreDe = (f: Fila) => f.nombre || f.razon_social || "SIN NOMBRE";
const aNumero = (s: string) => (s === "" || Number.isNaN(Number(s)) ? null : Number(s));

const tipo = (c: Columna) => (NUMERICAS.has(c) ? "float8" : "text");
const LISTA = COLUMNAS.join(", ");

export const SQL_CATALOGO = `
INSERT INTO denue_catalogo (${LISTA})
SELECT * FROM unnest(${COLUMNAS.map((c, i) => `$${i + 1}::${tipo(c)}[]`).join(", ")})
ON CONFLICT (id_denue) DO UPDATE SET
  ${COLUMNAS.filter((c) => c !== "id_denue").map((c) => `${c} = EXCLUDED.${c}`).join(",\n  ")},
  actualizado_en = now()`;

export const SQL_TORTILLERIAS = `
INSERT INTO tortillerias (id_denue, nombre, domicilio, estado_clave, municipio_clave, geom, origen, estatus, denue_sincronizado_en)
SELECT t.id, t.nombre, NULLIF(t.domicilio, ''), t.ent, t.ent || t.mun,
       CASE WHEN t.lat IS NULL OR t.lng IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(t.lng, t.lat), 4326) END,
       'denue', 'validada', now()
FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::float8[], $7::float8[]) AS t(id, nombre, domicilio, ent, mun, lat, lng)
ON CONFLICT (id_denue) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  domicilio = EXCLUDED.domicilio,
  estado_clave = EXCLUDED.estado_clave,
  municipio_clave = EXCLUDED.municipio_clave,
  geom = EXCLUDED.geom,
  denue_sincronizado_en = now()
WHERE tortillerias.origen = 'denue'
RETURNING (xmax = 0) AS insertada`;

/** Importa un lote de filas. Se puede repetir sin duplicar: usa id_denue como llave. */
export async function importarLote(db: BaseDatos, filas: Fila[]): Promise<{ nuevas: number; actualizadas: number }> {
  if (filas.length === 0) return { nuevas: 0, actualizadas: 0 };

  await db.query(
    SQL_CATALOGO,
    COLUMNAS.map((c) =>
      filas.map((f) => (c === "nombre" ? nombreDe(f) : NUMERICAS.has(c) ? aNumero(f[c]) : f[c] === "" ? null : f[c])),
    ),
  );

  const r = await db.query(SQL_TORTILLERIAS, [
    filas.map((f) => f.id_denue),
    filas.map(nombreDe),
    filas.map(domicilioDe),
    filas.map((f) => f.cve_ent),
    filas.map((f) => f.cve_mun),
    filas.map((f) => aNumero(f.latitud)),
    filas.map((f) => aNumero(f.longitud)),
  ]);
  const nuevas = r.rows.filter((x) => x.insertada).length;
  return { nuevas, actualizadas: r.rows.length - nuevas };
}
