import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Permiso } from "@tortillerias/shared";
import { pool } from "../db.js";
import { MAX_CELDAS, tamanoCelda, zoomSchema } from "../celdas.js";

/** Cada ruta pide al menos uno de estos permisos (un administrador los tiene todos) */
const con = (app: FastifyInstance, ...permisos: Permiso[]) => app.conPermiso(...permisos);
const uuid = z.string().uuid();
const ELAB = ["maquina", "mano", "ambas", "sin"];

/** El día cuenta en hora de México, igual que el límite de captura */
const HOY_MX = "(now() AT TIME ZONE 'America/Mexico_City')::date";
export const MAX_PUNTOS_ADMIN = 5000;

/** Sin datos fiscales (ni en la tabla nueva ni en el registro viejo) */
const SIN_FISCAL = "(NOT EXISTS (SELECT 1 FROM tortilleria_fiscal x WHERE x.tortilleria_id = t.id) AND NOT EXISTS (SELECT 1 FROM responsables r WHERE r.tortilleria_id = t.id))";
/** Sin datos fiscales y el último intento fue por inseguridad: zonas de riesgo para los censadores */
const SIN_FISCAL_INSEGURIDAD = `(${SIN_FISCAL} AND (SELECT n.motivo FROM fiscal_negativas n WHERE n.tortilleria_id = t.id ORDER BY n.creado_en DESC LIMIT 1) = 'inseguridad')`;

/**
 * Un precio CUENTA solo si está validado y su tortillería también (ver la vista `precios_que_cuentan`, migración 010).
 * El precio de una tortillería en un periodo es su ÚLTIMO precio que cuenta, por producto: una tortillería = un valor
 * (así una tortillería capturada 10 veces no pesa 10 veces más). Se usa igual en mapa, estadísticas, tendencia y resumen.
 */
const ultimos = (diasParam: string, extra = "") => `ultimos AS (
         SELECT DISTINCT ON (p.tortilleria_id, p.producto) p.tortilleria_id, p.producto, p.precio_kg::float8 AS precio,
                p.estado_clave, p.municipio_clave
           FROM precios_que_cuentan p
          WHERE p.fecha >= ${HOY_MX} - ${diasParam}::int ${extra}
          ORDER BY p.tortilleria_id, p.producto, p.fecha DESC, p.creado_en DESC
       )`;
export { ultimos as ultimosPreciosSql };

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
  app.get("/admin/mapa", { preHandler: con(app, "ver_mapa") }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const b = bboxSchema.safeParse(q.bbox);
    if (!b.success) return reply.code(400).send({ error: "bbox inválido: minLng,minLat,maxLng,maxLat" });
    const dias = periodo.safeParse(q.dias);
    const [x1, y1, x2, y2] = b.data;
    const soloConPrecios = q.solo === "precios";
    const soloInseguridad = q.solo === "inseguridad";
    const conBajas = q.bajas === "1"; // "Mostrar dadas de baja" (el cliente las pinta en gris)
    const elab = ELAB.includes(q.elaboracion as string) ? (q.elaboracion as string) : null;
    const { rows } = await pool.query(
      `SELECT t.id, t.nombre, t.domicilio, t.estatus, t.origen, t.operacion, t.elaboracion, ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng,
              COALESCE(s.n, 0) AS n_capturas,
              s.maiz, s.maiz_fecha, s.masa, s.masa_fecha, COALESCE(s.alerta, false) AS alerta
         FROM tortillerias t
         LEFT JOIN LATERAL (
           SELECT (count(*) FILTER (WHERE c.estatus = 'validada' AND t.estatus = 'validada'))::int AS n,
                  (array_agg(c.precio_kg::float8 ORDER BY c.fecha DESC, c.creado_en DESC) FILTER (WHERE c.producto = 'maiz' AND c.estatus = 'validada' AND t.estatus = 'validada'))[1] AS maiz,
                  (array_agg(to_char(c.fecha, 'YYYY-MM-DD') ORDER BY c.fecha DESC, c.creado_en DESC) FILTER (WHERE c.producto = 'maiz' AND c.estatus = 'validada' AND t.estatus = 'validada'))[1] AS maiz_fecha,
                  (array_agg(c.precio_kg::float8 ORDER BY c.fecha DESC, c.creado_en DESC) FILTER (WHERE c.producto = 'masa' AND c.estatus = 'validada' AND t.estatus = 'validada'))[1] AS masa,
                  (array_agg(to_char(c.fecha, 'YYYY-MM-DD') ORDER BY c.fecha DESC, c.creado_en DESC) FILTER (WHERE c.producto = 'masa' AND c.estatus = 'validada' AND t.estatus = 'validada'))[1] AS masa_fecha,
                  bool_or(c.alerta AND c.estatus = 'pendiente') AS alerta
             FROM capturas_precio c
            WHERE c.tortilleria_id = t.id AND c.estatus <> 'rechazada' AND c.producto IN ('maiz','masa')
              AND c.fecha >= ${HOY_MX} - $6::int
         ) s ON true
        WHERE t.geom && ST_MakeEnvelope($1,$2,$3,$4,4326) AND t.estatus <> 'rechazada'
          AND ($7::boolean IS NOT TRUE OR COALESCE(s.n, 0) > 0)
          AND ($8::boolean IS NOT TRUE OR ${SIN_FISCAL_INSEGURIDAD})
          AND ($9::boolean IS TRUE OR t.operacion = 'activa')
          AND ($10::text IS NULL OR ($10 = 'sin' AND t.elaboracion IS NULL) OR t.elaboracion = $10)
        LIMIT $5`,
      [x1, y1, x2, y2, MAX_PUNTOS_ADMIN + 1, desde(dias.success ? dias.data : 30), soloConPrecios, soloInseguridad, conBajas, elab],
    );
    if (rows.length > MAX_PUNTOS_ADMIN) return { demasiadas: true };
    return {
      puntos: rows.map((r) => ({
        id: r.id, nombre: r.nombre, domicilio: r.domicilio, estatus: r.estatus, origen: r.origen, operacion: r.operacion, elaboracion: r.elaboracion, lat: r.lat, lng: r.lng,
        n_capturas: r.n_capturas, ultimo_maiz: precio(r.maiz, r.maiz_fecha), ultima_masa: precio(r.masa, r.masa_fecha), alerta: r.alerta,
      })),
    };
  });

  // Mapa a poco zoom: tortillerías agrupadas en celdas, con cuántas hay y el precio promedio de cada producto en la celda
  app.get("/admin/mapa/celdas", { preHandler: con(app, "ver_mapa") }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const b = bboxSchema.safeParse(q.bbox);
    if (!b.success) return reply.code(400).send({ error: "bbox inválido: minLng,minLat,maxLng,maxLat" });
    const dias = periodo.safeParse(q.dias);
    const [x1, y1, x2, y2] = b.data;
    const { rows } = await pool.query(
      // Ojo con el rendimiento: unir cada tortillería (112 mil) con los precios hacía un ciclo anidado de ~28 s. Aquí las zonas se cuentan
      // solo con las tortillerías y los precios se suman aparte (solo las que tienen capturas) y se unen por zona: ~0.3 s.
      `WITH ${ultimos("$6").replace("ultimos AS", "cap AS").replace("p.precio_kg::float8 AS precio,", "p.precio_kg::float8 AS precio,")},
       base AS (
         SELECT t.id, t.estatus, ST_X(t.geom) AS x, ST_Y(t.geom) AS y,
                floor(ST_X(t.geom) / $5::float8) AS gx, floor(ST_Y(t.geom) / $5::float8) AS gy
           FROM tortillerias t
          WHERE t.geom && ST_MakeEnvelope($1,$2,$3,$4,4326) AND t.estatus <> 'rechazada'
            AND ($7::boolean IS NOT TRUE OR t.id IN (SELECT tortilleria_id FROM cap))
            AND ($9::boolean IS NOT TRUE OR ${SIN_FISCAL_INSEGURIDAD})
            AND ($10::boolean IS TRUE OR t.operacion = 'activa')
            AND ($11::text IS NULL OR ($11 = 'sin' AND t.elaboracion IS NULL) OR t.elaboracion = $11)
       ),
       precios AS (
         SELECT b.gx, b.gy,
                (count(*) FILTER (WHERE c.producto = 'maiz'))::int AS maiz_n, COALESCE(sum(c.precio) FILTER (WHERE c.producto = 'maiz'), 0)::float8 AS maiz_suma,
                (count(*) FILTER (WHERE c.producto = 'masa'))::int AS masa_n, COALESCE(sum(c.precio) FILTER (WHERE c.producto = 'masa'), 0)::float8 AS masa_suma
           FROM base b JOIN cap c ON c.tortilleria_id = b.id
          GROUP BY b.gx, b.gy
       )
       SELECT count(*)::int AS n, avg(b.x) AS lng, avg(b.y) AS lat,
              min(b.x) AS x1, min(b.y) AS y1, max(b.x) AS x2, max(b.y) AS y2,
              (count(*) FILTER (WHERE b.estatus = 'pendiente'))::int AS pendientes,
              COALESCE(max(p.maiz_n), 0)::int AS maiz_n, COALESCE(max(p.maiz_suma), 0)::float8 AS maiz_suma,
              COALESCE(max(p.masa_n), 0)::int AS masa_n, COALESCE(max(p.masa_suma), 0)::float8 AS masa_suma
         FROM base b LEFT JOIN precios p ON p.gx = b.gx AND p.gy = b.gy
        GROUP BY b.gx, b.gy
        LIMIT $8`,
      [x1, y1, x2, y2, tamanoCelda(zoomSchema.parse(q.zoom)), desde(dias.success ? dias.data : 30), q.solo === "precios", MAX_CELDAS, q.solo === "inseguridad", q.bajas === "1", ELAB.includes(q.elaboracion as string) ? (q.elaboracion as string) : null],
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
  app.get("/admin/estadisticas", { preHandler: con(app, "ver_estadisticas", "ver_resumen", "ver_mapa") }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const dias = periodo.safeParse(q.dias);
    const estado = q.estado && /^\d{2}$/.test(q.estado) ? q.estado : null;
    if (q.estado && !estado) return reply.code(400).send({ error: "estado inválido" });
    const porMunicipio = !!estado;
    const col = porMunicipio ? "municipio_clave" : "estado_clave";

    const base = await pool.query(
      `SELECT t.${col} AS clave, count(*)::int AS tortillerias,
              (count(*) FILTER (WHERE t.origen = 'nueva'))::int AS nuevas,
              avg(ST_Y(t.geom)) AS lat, avg(ST_X(t.geom)) AS lng,
              min(ST_X(t.geom)) AS x1, min(ST_Y(t.geom)) AS y1, max(ST_X(t.geom)) AS x2, max(ST_Y(t.geom)) AS y2
         FROM tortillerias t
        WHERE t.estatus <> 'rechazada' AND t.operacion = 'activa' AND t.geom IS NOT NULL AND t.${col} IS NOT NULL AND ($1::text IS NULL OR t.estado_clave = $1)
        GROUP BY t.${col}`,
      [estado],
    );
    const nombres = porMunicipio ? await pool.query("SELECT clave, nombre FROM municipios WHERE estado_clave = $1", [estado]) : await pool.query("SELECT clave, nombre FROM estados");
    // Promedio, mínimo y máximo de cada zona: sobre el último precio de cada tortillería (una tortillería = un valor)
    const dd = desde(dias.success ? dias.data : 30);
    const caps = await pool.query(
      `WITH ${ultimos("$2", "AND ($1::text IS NULL OR p.estado_clave = $1)")}
       SELECT u.${col} AS clave, u.producto, count(*)::int AS tiendas,
              round(avg(u.precio)::numeric, 2)::float8 AS promedio, min(u.precio) AS minimo, max(u.precio) AS maximo
         FROM ultimos u GROUP BY u.${col}, u.producto`,
      [estado, dd],
    );
    // El número de capturas (todas las que cuentan) se muestra aparte: mide el avance del censo, no se usa para promediar
    const numCapturas = await pool.query(
      `SELECT p.${col} AS clave, p.producto, count(*)::int AS capturas
         FROM precios_que_cuentan p
        WHERE p.fecha >= ${HOY_MX} - $2::int AND ($1::text IS NULL OR p.estado_clave = $1)
        GROUP BY p.${col}, p.producto`,
      [estado, dd],
    );
    // Tortillerías del DENUE que ya se visitaron (al menos un precio que cuenta, en cualquier fecha)
    const visitadas = await pool.query(
      `SELECT p.${col} AS clave, count(DISTINCT p.tortilleria_id)::int AS n
         FROM precios_que_cuentan p
        WHERE p.origen_tortilleria = 'denue' AND p.operacion_tortilleria = 'activa' AND ($1::text IS NULL OR p.estado_clave = $1)
        GROUP BY p.${col}`,
      [estado],
    );
    const visitadasPor = new Map<string, number>(visitadas.rows.map((v: any) => [v.clave, v.n]));
    const capturasPor = new Map<string, Map<string, number>>();
    for (const c of numCapturas.rows) {
      const m = capturasPor.get(c.clave) ?? new Map<string, number>();
      m.set(c.producto, c.capturas);
      capturasPor.set(c.clave, m);
    }

    const nombre = new Map<string, string>(nombres.rows.map((n: any) => [n.clave, n.nombre]));
    const porClave = new Map<string, any>();
    for (const c of caps.rows) {
      const r = porClave.get(c.clave) ?? { capturas: 0, maiz: null, masa: null, conPrecios: 0 };
      const capturas = capturasPor.get(c.clave)?.get(c.producto) ?? 0;
      r.capturas += capturas;
      r.conPrecios = Math.max(r.conPrecios, c.tiendas);
      r[c.producto] = { promedio: c.promedio, minimo: c.minimo, maximo: c.maximo, capturas, tortillerias: c.tiendas };
      porClave.set(c.clave, r);
    }
    return base.rows
      .map((b: any) => {
        const c = porClave.get(b.clave);
        return {
          clave: b.clave,
          nombre: nombre.get(b.clave) ?? b.clave,
          tortillerias: b.tortillerias,
          nuevas: b.nuevas,
          denue_visitadas: visitadasPor.get(b.clave) ?? 0,
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
  app.get("/admin/tendencia", { preHandler: con(app, "ver_estadisticas", "ver_resumen", "ver_mapa") }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const dias = periodo.safeParse(q.dias);
    const estado = q.estado && /^\d{2}$/.test(q.estado) ? q.estado : null;
    const municipio = q.municipio && /^\d{5}$/.test(q.municipio) ? q.municipio : null;
    if ((q.estado && !estado) || (q.municipio && !municipio)) return reply.code(400).send({ error: "clave inválida" });
    // Para cada día: el último precio de cada tortillería ESE día; después, el promedio entre tortillerías (n = tortillerías de ese día)
    const { rows } = await pool.query(
      `WITH diarios AS (
         SELECT DISTINCT ON (p.tortilleria_id, p.producto, p.fecha) p.tortilleria_id, p.producto, p.fecha, p.precio_kg::float8 AS precio
           FROM precios_que_cuentan p
          WHERE p.fecha >= ${HOY_MX} - $1::int
            AND ($2::text IS NULL OR p.estado_clave = $2) AND ($3::text IS NULL OR p.municipio_clave = $3)
          ORDER BY p.tortilleria_id, p.producto, p.fecha, p.creado_en DESC
       )
       SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha, producto, round(avg(precio)::numeric, 2)::float8 AS promedio, count(*)::int AS n
         FROM diarios GROUP BY 1, 2 ORDER BY 1`,
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
  app.get("/admin/actividad", { preHandler: con(app, "ver_resumen") }, async (req) => {
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

  // Historial de "no se obtuvieron los datos fiscales" de una tortillería (con el motivo escrito y quién lo registró)
  app.get<{ Params: { id: string } }>("/admin/tortillerias/:id/negativas", { preHandler: con(app, "ver_revision", "ver_mapa") }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query(
      `SELECT n.id, n.motivo, n.motivo_otro, to_char(coalesce(n.capturado_en, n.creado_en) AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS fecha, u.correo AS censador
         FROM fiscal_negativas n LEFT JOIN usuarios u ON u.id = n.capturista_id
        WHERE n.tortilleria_id = $1 ORDER BY coalesce(n.capturado_en, n.creado_en) DESC`,
      [req.params.id],
    );
    return rows;
  });

  // Veces que no se pudo tomar la foto de una tortillería (con el motivo escrito y quién lo registró)
  app.get<{ Params: { id: string } }>("/admin/tortillerias/:id/negativas-foto", { preHandler: con(app, "ver_revision", "ver_mapa") }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query(
      `SELECT n.id, n.motivo, n.motivo_otro, to_char(coalesce(n.capturado_en, n.creado_en) AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS fecha, u.correo AS censador
         FROM foto_negativas n LEFT JOIN usuarios u ON u.id = n.capturista_id
        WHERE n.tortilleria_id = $1 ORDER BY coalesce(n.capturado_en, n.creado_en) DESC`,
      [req.params.id],
    );
    return rows;
  });

  // Tortillerías sin datos fiscales: total, porcentaje, por motivo (el último intento) y por estado o, con ?estado=, por municipio
  app.get("/admin/sin-fiscal", { preHandler: con(app, "ver_estadisticas") }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const estado = q.estado && /^\d{2}$/.test(q.estado) ? q.estado : null;
    if (q.estado && !estado) return reply.code(400).send({ error: "estado inválido" });
    const municipio = q.municipio && /^\d{3,5}$/.test(q.municipio) ? q.municipio : null;
    const porMunicipio = !!estado;
    const col = porMunicipio ? "municipio_clave" : "estado_clave";
    // Universo: tortillerías VISITADAS = con al menos una captura de precio (salvo rechazada), dadas de alta por un censador (nuevas)
    // o con algún intento sin datos fiscales. Las ~112 mil del DENUE que nadie ha visitado no entran (daban un porcentaje sin sentido).
    const VISITADAS = `visitadas AS (
         SELECT tortilleria_id AS id FROM capturas_precio WHERE estatus <> 'rechazada'
         UNION SELECT tortilleria_id FROM fiscal_negativas
         UNION SELECT id FROM tortillerias WHERE origen = 'nueva'
       )`;
    const donde = `t.estatus <> 'rechazada' AND ($1::text IS NULL OR t.estado_clave = $1) AND ($2::text IS NULL OR t.municipio_clave = $2)`;
    const ultimoMotivo = "(SELECT n.motivo FROM fiscal_negativas n WHERE n.tortilleria_id = t.id ORDER BY n.creado_en DESC LIMIT 1)";
    const filas = await pool.query(
      `WITH ${VISITADAS}
       SELECT t.${col} AS clave, count(*)::int AS tortillerias,
              (count(*) FILTER (WHERE ${SIN_FISCAL}))::int AS sin_fiscal
         FROM tortillerias t JOIN visitadas v ON v.id = t.id WHERE ${donde} AND t.${col} IS NOT NULL GROUP BY t.${col}`,
      [estado, municipio],
    );
    const nombres = porMunicipio ? await pool.query("SELECT clave, nombre FROM municipios WHERE estado_clave = $1", [estado]) : await pool.query("SELECT clave, nombre FROM estados");
    const nombre = new Map<string, string>(nombres.rows.map((n: any) => [n.clave, n.nombre]));
    const motivos = await pool.query(
      `WITH ${VISITADAS}
       SELECT coalesce(${ultimoMotivo}, 'sin_intento') AS motivo, count(*)::int AS n
         FROM tortillerias t JOIN visitadas v ON v.id = t.id WHERE ${donde} AND ${SIN_FISCAL} GROUP BY 1`,
      [estado, municipio],
    );
    const porZona = await pool.query(
      `WITH ${VISITADAS}
       SELECT t.${col} AS clave, coalesce(${ultimoMotivo}, 'sin_intento') AS motivo, count(*)::int AS n
         FROM tortillerias t JOIN visitadas v ON v.id = t.id WHERE ${donde} AND t.${col} IS NOT NULL AND ${SIN_FISCAL} GROUP BY 1, 2`,
      [estado, municipio],
    );
    const total = filas.rows.reduce((a: number, r: any) => a + r.tortillerias, 0);
    const sin = filas.rows.reduce((a: number, r: any) => a + r.sin_fiscal, 0);
    return {
      total, sin_fiscal: sin, porcentaje: total ? Math.round((sin / total) * 1000) / 10 : 0,
      por_motivo: Object.fromEntries(motivos.rows.map((m: any) => [m.motivo, m.n])),
      zonas: filas.rows
        .map((r: any) => ({
          clave: r.clave, nombre: nombre.get(r.clave) ?? r.clave, tortillerias: r.tortillerias, sin_fiscal: r.sin_fiscal,
          porcentaje: r.tortillerias ? Math.round((r.sin_fiscal / r.tortillerias) * 1000) / 10 : 0,
          por_motivo: Object.fromEntries(porZona.rows.filter((m: any) => m.clave === r.clave).map((m: any) => [m.motivo, m.n])),
        }))
        .sort((a: any, b: any) => b.sin_fiscal - a.sin_fiscal || a.nombre.localeCompare(b.nombre, "es")),
    };
  });

  // Una tortillería (para abrir su detalle desde el mapa)
  app.get<{ Params: { id: string } }>("/admin/tortillerias/:id", { preHandler: con(app, "ver_revision", "ver_mapa") }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query(
      `SELECT t.id, t.nombre, t.domicilio, t.estatus, t.origen, t.creado_en, ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng,
              m.nombre AS municipio, e.nombre AS estado, u.correo AS creador,
              t.localidad, t.tipo_vial, t.calle, t.numero_ext, t.numero_int, t.colonia, t.codigo_postal, t.telefono, t.correo,
              t.personal_ocupado, t.codigo_scian, t.fecha_alta, t.operacion, t.elaboracion,
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
