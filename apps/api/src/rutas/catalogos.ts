import type { FastifyInstance } from "fastify";
import { pool } from "../db.js";

export function rutasCatalogos(app: FastifyInstance) {
  app.get("/estados", { preHandler: app.autenticar }, async () => {
    const { rows } = await pool.query("SELECT clave, nombre FROM estados ORDER BY nombre");
    return rows;
  });

  app.get<{ Params: { clave: string } }>("/estados/:clave/municipios", { preHandler: app.autenticar }, async (req) => {
    const { rows } = await pool.query(
      "SELECT clave, nombre FROM municipios WHERE estado_clave = $1 ORDER BY nombre",
      [req.params.clave],
    );
    return rows;
  });
}
