import type { FastifyInstance } from "fastify";
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
}
