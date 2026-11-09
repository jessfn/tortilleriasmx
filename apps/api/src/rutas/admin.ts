import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditar, pool } from "../db.js";

const uuid = z.string().uuid();
const staff = (app: FastifyInstance) => app.soloRoles("supervisor", "admin");

export function rutasAdmin(app: FastifyInstance) {
  app.get("/admin/resumen", { preHandler: staff(app) }, async () => {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM usuarios WHERE rol = 'capturista') AS usuarios,
         (SELECT count(*)::int FROM tortillerias t WHERE t.origen <> 'denue' OR EXISTS (SELECT 1 FROM capturas_precio c WHERE c.tortilleria_id = t.id)) AS tortillerias,
         (SELECT count(*)::int FROM denue_catalogo) AS catalogo,
         (SELECT count(*)::int FROM tortillerias WHERE estatus = 'pendiente') AS tortillerias_pendientes,
         (SELECT count(*)::int FROM capturas_precio) AS capturas,
         (SELECT count(*)::int FROM capturas_precio WHERE estatus = 'pendiente') AS capturas_pendientes,
         (SELECT count(*)::int FROM capturas_precio WHERE alerta AND estatus = 'pendiente') AS alertas,
         (SELECT round(avg(precio_kg), 2) FROM capturas_precio
           WHERE producto = 'maiz' AND estatus <> 'rechazada' AND fecha > (now() AT TIME ZONE 'America/Mexico_City')::date - 30) AS promedio_maiz,
         (SELECT round(avg(precio_kg), 2) FROM capturas_precio
           WHERE producto = 'masa' AND estatus <> 'rechazada' AND fecha > (now() AT TIME ZONE 'America/Mexico_City')::date - 30) AS promedio_masa,
         (SELECT count(*)::int FROM capturas_precio WHERE fecha = (now() AT TIME ZONE 'America/Mexico_City')::date) AS capturas_hoy,
         (SELECT count(DISTINCT capturista_id)::int FROM capturas_precio WHERE fecha = (now() AT TIME ZONE 'America/Mexico_City')::date) AS censadores_hoy`,
    );
    const por = await pool.query(
      `SELECT e.nombre AS estado, round(avg(c.precio_kg), 2) AS promedio, count(*)::int AS n
         FROM capturas_precio c
         JOIN tortillerias t ON t.id = c.tortilleria_id
         JOIN estados e ON e.clave = t.estado_clave
        WHERE c.producto = 'maiz' AND c.estatus <> 'rechazada'
        GROUP BY e.nombre ORDER BY n DESC LIMIT 10`,
    );
    return { ...rows[0], porEstado: por.rows };
  });

  app.get("/admin/tortillerias", { preHandler: staff(app) }, async (req) => {
    const estatus = z.enum(["pendiente", "validada", "rechazada"]).optional().safeParse((req.query as any).estatus);
    const { rows } = await pool.query(
      `SELECT t.id, t.nombre, t.domicilio, t.estatus, t.origen, t.creado_en,
              ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng,
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
        WHERE ($1::text IS NULL OR t.estatus = $1)
          AND (t.origen <> 'denue' OR EXISTS (SELECT 1 FROM capturas_precio c WHERE c.tortilleria_id = t.id))
        ORDER BY t.creado_en DESC LIMIT 100`,
      [estatus.success ? estatus.data ?? null : null],
    );
    return rows;
  });

  app.get<{ Params: { id: string } }>("/admin/tortillerias/:id/fotos", { preHandler: staff(app) }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query("SELECT id FROM fotos WHERE tortilleria_id = $1 ORDER BY fecha DESC", [req.params.id]);
    return rows;
  });

  app.get("/admin/capturas", { preHandler: staff(app) }, async (req, reply) => {
    const q = req.query as { estatus?: string; alertas?: string; tortilleria?: string };
    const estatus = z.enum(["pendiente", "validada", "rechazada"]).safeParse(q.estatus);
    const tortilleria = q.tortilleria ? uuid.safeParse(q.tortilleria) : null;
    if (tortilleria && !tortilleria.success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query(
      `SELECT c.id, c.producto, c.precio_kg, c.fecha, c.estatus, c.alerta, c.tortilleria_id,
              t.nombre, m.nombre AS municipio, e.nombre AS estado, u.correo AS capturista
         FROM capturas_precio c
         JOIN tortillerias t ON t.id = c.tortilleria_id
         LEFT JOIN municipios m ON m.clave = t.municipio_clave
         LEFT JOIN estados e ON e.clave = t.estado_clave
         LEFT JOIN usuarios u ON u.id = c.capturista_id
        WHERE ($1::text IS NULL OR c.estatus = $1) AND ($2::boolean IS NOT TRUE OR c.alerta)
          AND ($3::uuid IS NULL OR c.tortilleria_id = $3)
        ORDER BY ${tortilleria ? "c.creado_en DESC" : "c.alerta DESC, c.creado_en DESC"} LIMIT 100`,
      [estatus.success ? estatus.data : null, q.alertas === "1", tortilleria?.success ? tortilleria.data : null],
    );
    return rows;
  });

  app.patch<{ Params: { id: string } }>("/admin/capturas/:id", { preHandler: staff(app) }, async (req, reply) => {
    const p = z.object({ estatus: z.enum(["validada", "rechazada"]) }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Datos inválidos" });
    const r = await pool.query("UPDATE capturas_precio SET estatus = $1 WHERE id = $2", [p.data.estatus, req.params.id]);
    if (!r.rowCount) return reply.code(404).send({ error: "No existe" });
    await pool.query("UPDATE alertas SET estatus = 'resuelta' WHERE captura_id = $1", [req.params.id]);
    await auditar(req.user.sub, `captura_${p.data.estatus}`, "capturas_precio", req.params.id);
    return { ok: true };
  });

  // Gestión de usuarios: solo administradores
  app.get("/admin/usuarios", { preHandler: app.soloRoles("admin") }, async () => {
    const { rows } = await pool.query(
      `SELECT u.id, u.correo, u.usuario, u.nombre, u.apellidos, u.rol, u.activo, u.creado_en,
              (SELECT count(*)::int FROM capturas_precio c WHERE c.capturista_id = u.id) AS capturas
         FROM usuarios u ORDER BY u.creado_en DESC LIMIT 300`,
    );
    return rows;
  });

  app.patch<{ Params: { id: string } }>("/admin/usuarios/:id", { preHandler: app.soloRoles("admin") }, async (req, reply) => {
    const p = z.object({ rol: z.enum(["capturista", "supervisor", "admin"]).optional(), activo: z.boolean().optional() }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success || (p.data.rol === undefined && p.data.activo === undefined))
      return reply.code(400).send({ error: "Datos inválidos" });
    if (req.params.id === req.user.sub) return reply.code(400).send({ error: "No puedes cambiar tu propio rol ni desactivarte" });
    const r = await pool.query(
      "UPDATE usuarios SET rol = COALESCE($1, rol), activo = COALESCE($2, activo) WHERE id = $3",
      [p.data.rol ?? null, p.data.activo ?? null, req.params.id],
    );
    if (!r.rowCount) return reply.code(404).send({ error: "No existe" });
    await auditar(req.user.sub, "editar_usuario", "usuarios", req.params.id);
    return { ok: true };
  });
}
