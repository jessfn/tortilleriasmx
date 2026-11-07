import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

// Panel del usuario registrado: solo ve lo que él mismo capturó
export function rutasPanel(app: FastifyInstance) {
  app.get("/mis/resumen", { preHandler: app.autenticar }, async (req) => {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS registros,
              count(*) FILTER (WHERE estatus = 'pendiente')::int AS pendientes,
              count(*) FILTER (WHERE estatus = 'validada')::int AS aprobados,
              count(*) FILTER (WHERE estatus = 'rechazada')::int AS rechazados,
              (SELECT count(*)::int FROM tortillerias WHERE creado_por = $1) AS tortillerias
         FROM capturas_precio WHERE capturista_id = $1`,
      [req.user.sub],
    );
    return rows[0];
  });

  app.get("/mis/registros", { preHandler: app.autenticar }, async (req) => {
    const { rows } = await pool.query(
      `SELECT c.id, c.producto, c.precio_kg, c.fecha, c.creado_en, c.estatus, c.alerta,
              t.id AS tortilleria_id, t.nombre, t.domicilio, t.estatus AS tortilleria_estatus,
              m.nombre AS municipio, e.nombre AS estado
         FROM capturas_precio c
         JOIN tortillerias t ON t.id = c.tortilleria_id
         LEFT JOIN municipios m ON m.clave = t.municipio_clave
         LEFT JOIN estados e ON e.clave = t.estado_clave
        WHERE c.capturista_id = $1
        ORDER BY c.creado_en DESC
        LIMIT 200`,
      [req.user.sub],
    );
    return rows;
  });
}
