import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../db.js";

/**
 * Catálogo de un estado completo para guardarlo en el teléfono (modo sin conexión).
 * Formato compacto: cada tortillería es un arreglo en este orden (ver COLUMNAS).
 */
export const COLUMNAS = ["id", "nombre", "domicilio", "lat", "lng", "estatus", "municipio_clave", "razon_social", "tiene_fiscal"] as const;

export function rutasCatalogoEstado(app: FastifyInstance) {
  app.get<{ Params: { clave: string }; Querystring: { version?: string } }>(
    "/catalogo/estado/:clave",
    { preHandler: app.autenticar, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const clave = z.string().regex(/^[0-9]{1,3}$/).safeParse(req.params.clave);
      if (!clave.success) return reply.code(400).send({ error: "Clave de estado inválida" });

      // La versión cambia cuando cambia algo del estado (alta, validación, rechazo, datos fiscales)
      const v = await pool.query(
        `SELECT count(*)::int AS n, coalesce(max(floor(extract(epoch FROM actualizado_en) * 1000)), 0)::bigint AS ult
           FROM tortillerias WHERE estado_clave = $1 AND estatus <> 'rechazada' AND geom IS NOT NULL`,
        [clave.data],
      );
      const version = `${v.rows[0].ult}-${v.rows[0].n}`;
      if (req.query.version === version) return { sinCambios: true, version };

      const { rows } = await pool.query(
        `SELECT t.id, t.nombre, t.domicilio, ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng, t.estatus, t.municipio_clave, d.razon_social,
                (EXISTS (SELECT 1 FROM tortilleria_fiscal f WHERE f.tortilleria_id = t.id)
              OR EXISTS (SELECT 1 FROM responsables r WHERE r.tortilleria_id = t.id)) AS tiene_fiscal
           FROM tortillerias t
           LEFT JOIN denue_catalogo d ON d.id_denue = t.id_denue
          WHERE t.estado_clave = $1 AND t.estatus <> 'rechazada' AND t.geom IS NOT NULL`,
        [clave.data],
      );
      return {
        version,
        columnas: COLUMNAS,
        filas: rows.map((r) => [
          r.id, r.nombre, r.domicilio, Math.round(r.lat * 1e6) / 1e6, Math.round(r.lng * 1e6) / 1e6,
          r.estatus === "pendiente" ? 1 : 0, r.municipio_clave, r.razon_social ?? null, r.tiene_fiscal ? 1 : 0,
        ]),
      };
    },
  );
}
