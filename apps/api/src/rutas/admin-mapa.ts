import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";
import { MAX_CELDAS, tamanoCelda, zoomSchema } from "../celdas.js";

const staff = (app: FastifyInstance) => app.soloRoles("supervisor", "admin");
const uuid = z.string().uuid();

/** El día cuenta en hora de México, igual que el límite de captura */
const HOY_MX = "(now() AT TIME ZONE 'America/Mexico_City')::date";
export const MAX_PUNTOS_ADMIN = 5000;

const periodo = z.coerce.number().int().min(0).max(3650).default(30); // 0 = todo el historial
const bboxSchema = z
  .string()
  .transform((s) => s.split(",").map(Number))
  .pipe(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .refine(([x1, y1, x2, y2]) => x1 < x2 && y1 < y2, "bbox inválido");

/** Días hacia atrás para filtrar (0 = sin límite) */
const desde = (dias: number) => (dias === 0 ? 36500 : dias);

type Precio = { precio: number; fecha: string } | null;
const precio = (p: unknown, f: unknown): Precio => (p == null ? null : { precio: Number(p), fecha: String(f).slice(0, 10) });

/**
 * Vistas de supervisión: mapa con los precios capturados, estadísticas por estado y municipio, tendencia y actividad reciente.
 * Todo es solo para supervisor y administrador. Las capturas rechazadas nunca cuentan.
 */
export function rutasAdminMapa(app: FastifyInstance) {
  // Tortillerías del área visible, con su último precio de cada producto (de cualquier censador)
  app.get("/admin/mapa", { preHandler: staff(app) }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const b = bboxSchema.safeParse(q.bbox);
    if (!b.success) return reply.code(400).send({ error: "bbox inválido: minLng,minLat,maxLng,maxLat" });
    const dias = periodo.safeParse(q.dias);
    const [x1, y1, x2, y2] = b.data;
    const soloConPrecios = q.solo === "precios";
    const { rows } = await pool.query(
      `SELECT t.id, t.nombre, t.domicilio, t.estatus, t.origen, ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng,
              COALESCE(s.n, 0) AS n_capturas,
              s.maiz, s.maiz_fecha, s.masa, s.masa_fecha, COALESCE(s.alerta, false) AS alerta
         FROM tortillerias t
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS n,
                  (array_agg(c.precio_kg::float8 ORDER BY c.fecha DESC, c.creado_en DESC) FILTER (WHERE c.producto = 'maiz'))[1] AS maiz,
                  (array_agg(to_char(c.fecha, 'YYYY-MM-DD') ORDER BY c.fecha DESC, c.creado_en DESC) FILTER (WHERE c.producto = 'maiz'))[1] AS maiz_fecha,
                  (array_agg(c.precio_kg::float8 ORDER BY c.fecha DESC, c.creado_en DESC) FILTER (WHERE c.producto = 'masa'))[1] AS masa,
                  (array_agg(to_char(c.fecha, 'YYYY-MM-DD') ORDER BY c.fecha DESC, c.creado_en DESC) FILTER (WHERE c.producto = 'masa'))[1] AS masa_fecha,
                  bool_or(c.alerta AND c.estatus = 'pendiente') AS alerta
             FROM capturas_precio c
            WHERE c.tortilleria_id = t.id AND c.estatus <> 'rechazada' AND c.producto IN ('maiz','masa')
              AND c.fecha >= ${HOY_MX} - $6::int
         ) s ON true
        WHERE t.geom && ST_MakeEnvelope($1,$2,$3,$4,4326) AND t.estatus <> 'rechazada'
          AND ($7::boolean IS NOT TRUE OR COALESCE(s.n, 0) > 0)
        LIMIT $5`,
      [x1, y1, x2, y2, MAX_PUNTOS_ADMIN + 1, desde(dias.success ? dias.data : 30), soloConPrecios],
    );
    if (rows.length > MAX_PUNTOS_ADMIN) return { demasiadas: true };
    return {
      puntos: rows.map((r) => ({
        id: r.id, nombre: r.nombre, domicilio: r.domicilio, estatus: r.estatus, origen: r.origen, lat: r.lat, lng: r.lng,
        n_capturas: r.n_capturas, ultimo_maiz: precio(r.maiz, r.maiz_fecha), ultima_masa: precio(r.masa, r.masa_fecha), alerta: r.alerta,
      })),
    };
  });

  // Mapa a poco zoom: tortillerías agrupadas en celdas, con cuántas hay y el precio promedio de cada producto en la celda
  app.get("/admin/mapa/celdas", { preHandler: staff(app) }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const b = bboxSchema.safeParse(q.bbox);
    if (!b.success) return reply.code(400).send({ error: "bbox inválido: minLng,minLat,maxLng,maxLat" });
    const dias = periodo.safeParse(q.dias);
    const [x1, y1, x2, y2] = b.data;
    const { rows } = await pool.query(
      `WITH cap AS (
         SELECT DISTINCT ON (c.tortilleria_id, c.producto) c.tortilleria_id, c.producto, c.precio_kg::float8 AS precio
           FROM capturas_precio c
          WHERE c.estatus <> 'rechazada' AND c.producto IN ('maiz','masa') AND c.fecha >= ${HOY_MX} - $6::int
          ORDER BY c.tortilleria_id, c.producto, c.fecha DESC, c.creado_en DESC
       )
       SELECT count(*)::int AS n, avg(ST_X(t.geom)) AS lng, avg(ST_Y(t.geom)) AS lat,
              min(ST_X(t.geom)) AS x1, min(ST_Y(t.geom)) AS y1, max(ST_X(t.geom)) AS x2, max(ST_Y(t.geom)) AS y2,
              (count(*) FILTER (WHERE t.estatus = 'pendiente'))::int AS pendientes,
              count(m.precio)::int AS maiz_n, COALESCE(sum(m.precio), 0)::float8 AS maiz_suma,
              count(a.precio)::int AS masa_n, COALESCE(sum(a.precio), 0)::float8 AS masa_suma
         FROM tortillerias t
         LEFT JOIN cap m ON m.tortilleria_id = t.id AND m.producto = 'maiz'
         LEFT JOIN cap a ON a.tortilleria_id = t.id AND a.producto = 'masa'
        WHERE t.geom && ST_MakeEnvelope($1,$2,$3,$4,4326) AND t.estatus <> 'rechazada'
          AND ($7::boolean IS NOT TRUE OR m.precio IS NOT NULL OR a.precio IS NOT NULL)
        GROUP BY floor(ST_X(t.geom) / $5::float8), floor(ST_Y(t.geom) / $5::float8)
        LIMIT $8`,
      [x1, y1, x2, y2, tamanoCelda(zoomSchema.parse(q.zoom)), desde(dias.success ? dias.data : 30), q.solo === "precios", MAX_CELDAS],
    );
    return {
      celdas: rows.map((r) => ({
        lat: r.lat, lng: r.lng, n: r.n, pendientes: r.pendientes,
        maiz_n: r.maiz_n, maiz_suma: r.maiz_suma, masa_n: r.masa_n, masa_suma: r.masa_suma,
        bbox: [r.x1, r.y1, r.x2, r.y2],
      })),
    };
  });

  // Estadísticas por estado o, con ?estado=, por municipio de ese estado
  app.get("/admin/estadisticas", { preHandler: staff(app) }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const dias = periodo.safeParse(q.dias);
    const estado = q.estado && /^\d{2}$/.test(q.estado) ? q.estado : null;
    if (q.estado && !estado) return reply.code(400).send({ error: "estado inválido" });
    const porMunicipio = !!estado;
    const col = porMunicipio ? "municipio_clave" : "estado_clave";

    const base = await pool.query(
      `SELECT t.${col} AS clave, count(*)::int AS tortillerias,
              avg(ST_Y(t.geom)) AS lat, avg(ST_X(t.geom)) AS lng,
              min(ST_X(t.geom)) AS x1, min(ST_Y(t.geom)) AS y1, max(ST_X(t.geom)) AS x2, max(ST_Y(t.geom)) AS y2
         FROM tortillerias t
        WHERE t.estatus <> 'rechazada' AND t.geom IS NOT NULL AND t.${col} IS NOT NULL AND ($1::text IS NULL OR t.estado_clave = $1)
        GROUP BY t.${col}`,
      [estado],
    );
    const nombres = porMunicipio ? await pool.query("SELECT clave, nombre FROM municipios WHERE estado_clave = $1", [estado]) : await pool.query("SELECT clave, nombre FROM estados");
    const caps = await pool.query(
      `SELECT t.${col} AS clave, c.producto, count(*)::int AS capturas, count(DISTINCT c.tortilleria_id)::int AS tiendas,
              round(avg(c.precio_kg), 2)::float8 AS promedio, min(c.precio_kg)::float8 AS minimo, max(c.precio_kg)::float8 AS maximo
         FROM capturas_precio c
         JOIN tortillerias t ON t.id = c.tortilleria_id
        WHERE c.estatus <> 'rechazada' AND c.producto IN ('maiz','masa') AND c.fecha >= ${HOY_MX} - $2::int
          AND ($1::text IS NULL OR t.estado_clave = $1)
        GROUP BY t.${col}, c.producto`,
      [estado, desde(dias.success ? dias.data : 30)],
    );

    const nombre = new Map<string, string>(nombres.rows.map((n: any) => [n.clave, n.nombre]));
    const porClave = new Map<string, any>();
    for (const c of caps.rows) {
      const r = porClave.get(c.clave) ?? { capturas: 0, maiz: null, masa: null, conPrecios: 0 };
      r.capturas += c.capturas;
      r.conPrecios = Math.max(r.conPrecios, c.tiendas);
      r[c.producto] = { promedio: c.promedio, minimo: c.minimo, maximo: c.maximo, capturas: c.capturas };
      porClave.set(c.clave, r);
    }
    return base.rows
      .map((b: any) => {
        const c = porClave.get(b.clave);
        return {
          clave: b.clave,
          nombre: nombre.get(b.clave) ?? b.clave,
          tortillerias: b.tortillerias,
          con_precios: c?.conPrecios ?? 0,
          capturas: c?.capturas ?? 0,
          maiz: c?.maiz ?? null,
          masa: c?.masa ?? null,
          lat: b.lat, lng: b.lng,
          bbox: [b.x1, b.y1, b.x2, b.y2],
        };
      })
      .sort((a: any, b: any) => b.capturas - a.capturas || a.nombre.localeCompare(b.nombre, "es"));
  });

  // Promedio diario de cada producto (para la gráfica de tendencia), nacional o por estado/municipio
  app.get("/admin/tendencia", { preHandler: staff(app) }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const dias = periodo.safeParse(q.dias);
    const estado = q.estado && /^\d{2}$/.test(q.estado) ? q.estado : null;
    const municipio = q.municipio && /^\d{5}$/.test(q.municipio) ? q.municipio : null;
    if ((q.estado && !estado) || (q.municipio && !municipio)) return reply.code(400).send({ error: "clave inválida" });
    const { rows } = await pool.query(
      `SELECT to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.producto, round(avg(c.precio_kg), 2)::float8 AS promedio, count(*)::int AS n
         FROM capturas_precio c
         JOIN tortillerias t ON t.id = c.tortilleria_id
        WHERE c.estatus <> 'rechazada' AND c.producto IN ('maiz','masa') AND c.fecha >= ${HOY_MX} - $1::int
          AND ($2::text IS NULL OR t.estado_clave = $2) AND ($3::text IS NULL OR t.municipio_clave = $3)
        GROUP BY 1, 2 ORDER BY 1`,
      [desde(dias.success ? dias.data : 30), estado, municipio],
    );
    const dia = new Map<string, { fecha: string; maiz: number | null; masa: number | null; n: number }>();
    for (const r of rows) {
      const d = dia.get(r.fecha) ?? { fecha: r.fecha, maiz: null, masa: null, n: 0 };
      d[r.producto as "maiz" | "masa"] = r.promedio;
      d.n += r.n;
      dia.set(r.fecha, d);
    }
    return [...dia.values()];
  });

  // Últimas capturas (todas las personas), para la actividad en vivo
  app.get("/admin/actividad", { preHandler: staff(app) }, async (req) => {
    const limite = z.coerce.number().int().min(1).max(50).default(15).safeParse((req.query as any).limite);
    const { rows } = await pool.query(
      `SELECT c.id, c.producto, c.precio_kg::float8 AS precio_kg, c.estatus, c.alerta, c.creado_en, c.tortilleria_id,
              t.nombre, m.nombre AS municipio, e.nombre AS estado, u.correo AS capturista
         FROM capturas_precio c
         JOIN tortillerias t ON t.id = c.tortilleria_id
         LEFT JOIN municipios m ON m.clave = t.municipio_clave
         LEFT JOIN estados e ON e.clave = t.estado_clave
         LEFT JOIN usuarios u ON u.id = c.capturista_id
        ORDER BY c.creado_en DESC
        LIMIT $1`,
      [limite.success ? limite.data : 15],
    );
    return rows;
  });

  // Una tortillería (para abrir su detalle desde el mapa)
  app.get<{ Params: { id: string } }>("/admin/tortillerias/:id", { preHandler: staff(app) }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query(
      `SELECT t.id, t.nombre, t.domicilio, t.estatus, t.origen, t.creado_en, ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng,
              m.nombre AS municipio, e.nombre AS estado, u.correo AS creador,
              t.localidad, t.tipo_vial, t.calle, t.numero_ext, t.numero_int, t.colonia, t.codigo_postal, t.telefono, t.correo,
              t.personal_ocupado, t.codigo_scian, t.fecha_alta,
              (SELECT count(*)::int FROM fotos f WHERE f.tortilleria_id = t.id) AS n_fotos,
              (EXISTS (SELECT 1 FROM tortilleria_fiscal x WHERE x.tortilleria_id = t.id)
               OR EXISTS (SELECT 1 FROM responsables r WHERE r.tortilleria_id = t.id)) AS tiene_fiscal
         FROM tortillerias t
         LEFT JOIN municipios m ON m.clave = t.municipio_clave
         LEFT JOIN estados e ON e.clave = t.estado_clave
         LEFT JOIN usuarios u ON u.id = t.creado_por
        WHERE t.id = $1`,
      [req.params.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: "No existe" });
    return rows[0];
  });
}
