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

  // Una fila por tortillería en la que este usuario capturó un precio o que dio de alta, con su último precio de cada producto
  // y si ya capturó hoy (hora de México). De aquí sale el botón "Actualizar precio".
  app.get("/mis/tortillerias", { preHandler: app.autenticar }, async (req) => {
    const { rows } = await pool.query(
      `WITH hoy AS (SELECT (now() AT TIME ZONE 'America/Mexico_City')::date AS d),
            mias AS (
              SELECT tortilleria_id AS id, max(creado_en) AS ultima FROM capturas_precio WHERE capturista_id = $1 GROUP BY tortilleria_id
              UNION ALL
              SELECT t.id, t.creado_en FROM tortillerias t
               WHERE t.creado_por = $1 AND NOT EXISTS (SELECT 1 FROM capturas_precio c WHERE c.capturista_id = $1 AND c.tortilleria_id = t.id)
            )
       SELECT t.id, t.nombre, t.domicilio, t.estatus, t.origen, m.nombre AS municipio, e.nombre AS estado,
              ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng, mias.ultima,
              (SELECT json_build_object('precio', c.precio_kg::float8, 'fecha', c.fecha) FROM capturas_precio c
                WHERE c.tortilleria_id = t.id AND c.capturista_id = $1 AND c.producto = 'maiz'
                ORDER BY c.fecha DESC, c.creado_en DESC LIMIT 1) AS ultimo_maiz,
              (SELECT json_build_object('precio', c.precio_kg::float8, 'fecha', c.fecha) FROM capturas_precio c
                WHERE c.tortilleria_id = t.id AND c.capturista_id = $1 AND c.producto = 'masa'
                ORDER BY c.fecha DESC, c.creado_en DESC LIMIT 1) AS ultima_masa,
              EXISTS (SELECT 1 FROM capturas_precio c WHERE c.tortilleria_id = t.id AND c.capturista_id = $1 AND c.producto = 'maiz' AND c.fecha = (SELECT d FROM hoy)) AS maiz_hoy,
              EXISTS (SELECT 1 FROM capturas_precio c WHERE c.tortilleria_id = t.id AND c.capturista_id = $1 AND c.producto = 'masa' AND c.fecha = (SELECT d FROM hoy)) AS masa_hoy
         FROM mias
         JOIN tortillerias t ON t.id = mias.id
         LEFT JOIN municipios m ON m.clave = t.municipio_clave
         LEFT JOIN estados e ON e.clave = t.estado_clave
        ORDER BY mias.ultima DESC
        LIMIT 500`,
      [req.user.sub],
    );
    return rows;
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
