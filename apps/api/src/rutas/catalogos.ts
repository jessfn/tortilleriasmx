import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

// Catálogos públicos: la captura no requiere iniciar sesión
export function rutasCatalogos(app: FastifyInstance) {
  app.get("/estados", async () => {
    const { rows } = await pool.query("SELECT clave, nombre FROM estados ORDER BY nombre");
    return rows;
  });

  app.get<{ Params: { clave: string } }>("/estados/:clave/municipios", async (req) => {
    const { rows } = await pool.query(
      "SELECT clave, nombre FROM municipios WHERE estado_clave = $1 ORDER BY nombre",
      [req.params.clave],
    );
    return rows;
  });

  // Estado y municipio de un punto (para precargar el formulario de una tortillería nueva cuando se usó el GPS):
  // el de la tortillería más cercana del catálogo, que casi siempre es del mismo municipio.
  app.get("/ubicacion/cercana", async (req, reply) => {
    const p = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).safeParse(req.query);
    if (!p.success) return reply.code(400).send({ error: "Parámetros inválidos" });
    const { rows } = await pool.query(
      `SELECT t.estado_clave, e.nombre AS estado, t.municipio_clave, m.nombre AS municipio
         FROM tortillerias t
         JOIN municipios m ON m.clave = t.municipio_clave
         JOIN estados e ON e.clave = t.estado_clave
        WHERE t.geom IS NOT NULL
        ORDER BY t.geom <-> ST_SetSRID(ST_MakePoint($1,$2),4326)
        LIMIT 1`,
      [p.data.lng, p.data.lat],
    );
    const r = rows[0];
    if (!r) return { estado: null, municipio: null };
    return { estado: { clave: r.estado_clave, nombre: r.estado }, municipio: { clave: r.municipio_clave, nombre: r.municipio } };
  });
}
