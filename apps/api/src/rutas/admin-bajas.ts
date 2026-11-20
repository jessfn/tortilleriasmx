import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MOTIVOS_BAJA } from "@tortillerias/shared";
import { auditar, pool } from "../db.js";

const uuid = z.string().uuid();
const TZ = "America/Mexico_City";
const fechaOk = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * Bajas ("ya no funciona") y tipo de elaboración, vistos desde el administrador.
 * Una baja aplica de inmediato (sin confirmación de supervisor): aquí se consulta, se ordena lo que merece revisarse y se puede reactivar.
 */
export function rutasAdminBajas(app: FastifyInstance) {
  const ver = app.conPermisoNacional("gestionar_bajas", "ver_revision");

  // Lista de bajas con quién, cuándo, por qué, la distancia entre el GPS del reporte y la ubicación del catálogo y las contradicciones
  app.get("/admin/bajas", { preHandler: ver }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const estado = q.estado && /^\d{2}$/.test(q.estado) ? q.estado : null;
    const municipio = q.municipio && /^\d{5}$/.test(q.municipio) ? q.municipio : null;
    const motivo = q.motivo && MOTIVOS_BAJA.some((m) => m.clave === q.motivo) ? q.motivo : null;
    if ((q.estado && !estado) || (q.municipio && !municipio) || (q.motivo && !motivo) || (q.desde && !fechaOk(q.desde)) || (q.hasta && !fechaOk(q.hasta)))
      return reply.code(400).send({ error: "Filtros inválidos" });
    const vigentes = q.solo === "vigentes";
    // Solo claves de una lista: nada del texto de la petición va al SQL
    const ORDEN: Record<string, string> = {
      recientes: "coalesce(b.capturado_en, b.creado_en) DESC",
      contradicciones: "b.contradicciones DESC, coalesce(b.capturado_en, b.creado_en) DESC",
      distancia: "distancia_m DESC NULLS LAST, coalesce(b.capturado_en, b.creado_en) DESC",
    };
    const orden = ORDEN[q.orden ?? ""] ?? ORDEN.recientes;
    const pagina = Math.max(1, Number(q.pagina) || 1);
    const limite = Math.min(200, Math.max(1, Number(q.limite) || 50));
    const FECHA = `(coalesce(b.capturado_en, b.creado_en) AT TIME ZONE '${TZ}')::date`;
    const DONDE = `($1::text IS NULL OR t.estado_clave = $1) AND ($2::text IS NULL OR t.municipio_clave = $2) AND ($3::text IS NULL OR b.motivo = $3)
          AND ($4::date IS NULL OR ${FECHA} >= $4::date) AND ($5::date IS NULL OR ${FECHA} <= $5::date) AND ($6::boolean IS NOT TRUE OR b.reactivada_en IS NULL)
          AND ($7::boolean IS NOT TRUE OR EXISTS (SELECT 1 FROM usuarios ux WHERE ux.id = b.capturista_id AND ux.estado_cuenta = 'rechazado'))`;
    const params = [estado, municipio, motivo, fechaOk(q.desde), fechaOk(q.hasta), vigentes, q.rechazado === "1"];
    const { rows } = await pool.query(
      `SELECT b.id, b.tortilleria_id, t.nombre, t.domicilio, e.nombre AS estado, m.nombre AS municipio, t.operacion,
              b.motivo, b.motivo_otro, coalesce(b.capturado_en, b.creado_en) AS fecha, u.correo AS censador,
              ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng, ST_Y(b.geom_captura) AS reporte_lat, ST_X(b.geom_captura) AS reporte_lng, b.precision_gps,
              CASE WHEN b.geom_captura IS NULL OR t.geom IS NULL THEN NULL ELSE ST_Distance(t.geom::geography, b.geom_captura::geography) END AS distancia_m,
              b.contradicciones, b.reactivada_en, ur.correo AS reactivada_por, (u.estado_cuenta = 'rechazado') AS censador_rechazado
         FROM tortilleria_bajas b
         JOIN tortillerias t ON t.id = b.tortilleria_id
         LEFT JOIN estados e ON e.clave = t.estado_clave
         LEFT JOIN municipios m ON m.clave = t.municipio_clave
         LEFT JOIN usuarios u ON u.id = b.capturista_id
         LEFT JOIN usuarios ur ON ur.id = b.reactivada_por
        WHERE ${DONDE}
        ORDER BY ${orden}, b.id
        LIMIT $8 OFFSET $9`,
      [...params, limite, (pagina - 1) * limite],
    );
    const { rows: [c] } = await pool.query(
      `SELECT count(*)::int AS n FROM tortilleria_bajas b JOIN tortillerias t ON t.id = b.tortilleria_id WHERE ${DONDE}`,
      params,
    );
    return { filas: rows.map((r) => ({ ...r, distancia_m: r.distancia_m == null ? null : Math.round(Number(r.distancia_m)) })), total: c.n, pagina, limite, paginas: Math.max(1, Math.ceil(c.n / limite)) };
  });

  // Reactivar (por ejemplo, reabrió o fue un error). Queda quién y cuándo, y en la bitácora.
  app.patch<{ Params: { id: string } }>("/admin/tortillerias/:id/operacion", { preHandler: app.conPermisoNacional("gestionar_bajas") }, async (req, reply) => {
    const p = z.object({ operacion: z.literal("activa") }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Datos inválidos" });
    const t = await pool.query("SELECT operacion FROM tortillerias WHERE id = $1", [req.params.id]);
    if (!t.rowCount) return reply.code(404).send({ error: "No existe" });
    if (t.rows[0].operacion === "activa") return reply.code(200).send({ ok: true, yaActiva: true });
    await pool.query("UPDATE tortillerias SET operacion = 'activa', operacion_cambiada_en = now() WHERE id = $1", [req.params.id]);
    await pool.query("UPDATE tortilleria_bajas SET reactivada_por = $2, reactivada_en = now() WHERE tortilleria_id = $1 AND reactivada_en IS NULL", [req.params.id, req.user.sub]);
    await auditar(req.user.sub, "reactivar_tortilleria", "tortillerias", req.params.id);
    return { ok: true };
  });

  // Situación de una tortillería para su detalle: operación (con su última baja) y tipo de elaboración con su historial
  app.get<{ Params: { id: string } }>("/admin/tortillerias/:id/situacion", { preHandler: app.conPermisoNacional("ver_revision", "ver_mapa") }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const t = await pool.query("SELECT operacion, elaboracion FROM tortillerias WHERE id = $1", [req.params.id]);
    if (!t.rowCount) return reply.code(404).send({ error: "No existe" });
    const bajas = await pool.query(
      `SELECT b.motivo, b.motivo_otro, coalesce(b.capturado_en, b.creado_en) AS fecha, u.correo AS censador, b.contradicciones, b.reactivada_en, ur.correo AS reactivada_por
         FROM tortilleria_bajas b LEFT JOIN usuarios u ON u.id = b.capturista_id LEFT JOIN usuarios ur ON ur.id = b.reactivada_por
        WHERE b.tortilleria_id = $1 ORDER BY coalesce(b.capturado_en, b.creado_en) DESC`,
      [req.params.id],
    );
    const elab = await pool.query(
      `SELECT e.elaboracion, coalesce(e.capturado_en, e.creado_en) AS fecha, u.correo AS censador
         FROM tortilleria_elaboracion e LEFT JOIN usuarios u ON u.id = e.capturista_id
        WHERE e.tortilleria_id = $1 ORDER BY coalesce(e.capturado_en, e.creado_en) DESC`,
      [req.params.id],
    );
    return { operacion: t.rows[0].operacion, elaboracion: t.rows[0].elaboracion, bajas: bajas.rows, historial_elaboracion: elab.rows };
  });

  // "Dadas de baja": total nacional y por estado (o por municipio con ?estado=), con el desglose por motivo. Solo las que siguen inactivas.
  app.get("/admin/bajas/resumen", { preHandler: app.conPermisoNacional("ver_estadisticas", "gestionar_bajas", "ver_resumen") }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const estado = q.estado && /^\d{2}$/.test(q.estado) ? q.estado : null;
    if (q.estado && !estado) return reply.code(400).send({ error: "estado inválido" });
    const col = estado ? "municipio_clave" : "estado_clave";
    const { rows } = await pool.query(
      `WITH ultima AS (
         SELECT DISTINCT ON (b.tortilleria_id) b.tortilleria_id, b.motivo FROM tortilleria_bajas b
          WHERE b.reactivada_en IS NULL ORDER BY b.tortilleria_id, coalesce(b.capturado_en, b.creado_en) DESC)
       SELECT t.${col} AS clave, u.motivo, count(*)::int AS n
         FROM tortillerias t JOIN ultima u ON u.tortilleria_id = t.id
        WHERE t.operacion = 'inactiva' AND ($1::text IS NULL OR t.estado_clave = $1)
        GROUP BY t.${col}, u.motivo`,
      [estado],
    );
    const nombres = estado ? await pool.query("SELECT clave, nombre FROM municipios WHERE estado_clave = $1", [estado]) : await pool.query("SELECT clave, nombre FROM estados");
    const nombre = new Map<string, string>(nombres.rows.map((n: any) => [n.clave, n.nombre]));
    const porMotivo: Record<string, number> = {};
    const zonas = new Map<string, { clave: string; nombre: string; total: number; por_motivo: Record<string, number> }>();
    for (const r of rows) {
      porMotivo[r.motivo] = (porMotivo[r.motivo] ?? 0) + r.n;
      const z = zonas.get(r.clave) ?? { clave: r.clave, nombre: nombre.get(r.clave) ?? r.clave, total: 0, por_motivo: {} as Record<string, number> };
      z.total += r.n;
      z.por_motivo[r.motivo] = (z.por_motivo[r.motivo] ?? 0) + r.n;
      zonas.set(r.clave, z);
    }
    return {
      total: Object.values(porMotivo).reduce((a, b) => a + b, 0),
      por_motivo: porMotivo,
      zonas: [...zonas.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es")),
    };
  });

  // Tipo de elaboración por estado o municipio: cuántas tortillerías visitadas de cada tipo (y sin dato) y el precio promedio de la tortilla por tipo.
  // Regla de siempre: el último precio que CUENTA de cada tortillería en el periodo (una tortillería = un valor).
  app.get("/admin/estadisticas/elaboracion", { preHandler: app.conPermisoNacional("ver_estadisticas", "ver_resumen") }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const estado = q.estado && /^\d{2}$/.test(q.estado) ? q.estado : null;
    if (q.estado && !estado) return reply.code(400).send({ error: "estado inválido" });
    const dias = Math.min(3650, Math.max(0, Number(q.dias ?? 30) || 30));
    const dd = dias === 0 ? 36500 : dias;
    const col = estado ? "municipio_clave" : "estado_clave";
    const visitadas = await pool.query(
      `SELECT t.${col} AS clave, coalesce(t.elaboracion, 'sin_dato') AS tipo, count(*)::int AS n
         FROM tortillerias t
        WHERE t.estatus <> 'rechazada' AND t.operacion = 'activa' AND ($1::text IS NULL OR t.estado_clave = $1)
          AND EXISTS (SELECT 1 FROM precios_que_cuentan p WHERE p.tortilleria_id = t.id)
        GROUP BY t.${col}, coalesce(t.elaboracion, 'sin_dato')`,
      [estado],
    );
    const promedios = await pool.query(
      `WITH u AS (
         SELECT DISTINCT ON (p.tortilleria_id) p.tortilleria_id, p.${col} AS clave, p.elaboracion_tortilleria AS tipo, p.precio_kg::float8 AS precio
           FROM precios_que_cuentan p
          WHERE p.producto = 'maiz' AND p.operacion_tortilleria = 'activa' AND p.fecha >= (now() AT TIME ZONE '${TZ}')::date - $2::int AND ($1::text IS NULL OR p.estado_clave = $1)
          ORDER BY p.tortilleria_id, p.fecha DESC, p.creado_en DESC)
       SELECT clave, coalesce(tipo, 'sin_dato') AS tipo, count(*)::int AS tortillerias, round(avg(precio)::numeric, 2)::float8 AS promedio FROM u GROUP BY clave, coalesce(tipo, 'sin_dato')`,
      [estado, dd],
    );
    const nombres = estado ? await pool.query("SELECT clave, nombre FROM municipios WHERE estado_clave = $1", [estado]) : await pool.query("SELECT clave, nombre FROM estados");
    const nombre = new Map<string, string>(nombres.rows.map((n: any) => [n.clave, n.nombre]));
    const vacio = () => ({ maquina: 0, mano: 0, ambas: 0, sin_dato: 0 });
    const vacioP = () => ({ maquina: null as number | null, mano: null as number | null, ambas: null as number | null, sin_dato: null as number | null });
    const nacional = { visitadas: vacio(), promedio: vacioP(), tortillerias_precio: vacio() };
    const zonas = new Map<string, { clave: string; nombre: string; visitadas: ReturnType<typeof vacio>; promedio: ReturnType<typeof vacioP> }>();
    const zona = (clave: string) => {
      let z = zonas.get(clave);
      if (!z) zonas.set(clave, (z = { clave, nombre: nombre.get(clave) ?? clave, visitadas: vacio(), promedio: vacioP() }));
      return z;
    };
    for (const r of visitadas.rows) {
      (zona(r.clave).visitadas as any)[r.tipo] += r.n;
      (nacional.visitadas as any)[r.tipo] += r.n;
    }
    const sumas: Record<string, { n: number; suma: number }> = {};
    for (const r of promedios.rows) {
      (zona(r.clave).promedio as any)[r.tipo] = r.promedio;
      const s = (sumas[r.tipo] ??= { n: 0, suma: 0 });
      s.n += r.tortillerias;
      s.suma += r.promedio * r.tortillerias;
    }
    for (const [tipo, s] of Object.entries(sumas)) {
      (nacional.promedio as any)[tipo] = Math.round((s.suma / s.n) * 100) / 100;
      (nacional.tortillerias_precio as any)[tipo] = s.n;
    }
    return { nacional, zonas: [...zonas.values()].sort((a, b) => Object.values(b.visitadas).reduce((x, y) => x + y, 0) - Object.values(a.visitadas).reduce((x, y) => x + y, 0) || a.nombre.localeCompare(b.nombre, "es")) };
  });
}
