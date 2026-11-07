import type { FastifyInstance } from "fastify";
import { capturaPrecioSchema } from "@tortillerias/shared";
import { pool } from "../db.js";

export function rutasPrecios(app: FastifyInstance) {
  // Pública, con límite por IP. Queda "pendiente" hasta que un supervisor la revise.
  app.post("/precios", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const p = capturaPrecioSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos", detalle: p.error.flatten() });
    const d = p.data;

    const t = await pool.query("SELECT municipio_clave, estatus FROM tortillerias WHERE id = $1", [d.tortilleriaId]);
    if (!t.rowCount || t.rows[0].estatus === "rechazada") return reply.code(404).send({ error: "Tortillería no existe" });

    // Mediana municipal de los últimos 90 días para detectar precios atípicos (±30 %)
    const med = await pool.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY c.precio_kg) AS mediana, count(*) AS n
         FROM capturas_precio c JOIN tortillerias t ON t.id = c.tortilleria_id
        WHERE t.municipio_clave = $1 AND c.producto = $2 AND c.fecha > current_date - 90`,
      [t.rows[0].municipio_clave, d.producto],
    );
    const mediana = med.rows[0].mediana === null ? null : Number(med.rows[0].mediana);
    const atipico = mediana !== null && Number(med.rows[0].n) >= 3 && Math.abs(d.precioKg - mediana) / mediana > 0.3;

    const { rows } = await pool.query(
      `INSERT INTO capturas_precio(tortilleria_id, producto, precio_kg, geom_captura, precision_gps, alerta, origen)
       VALUES ($1,$2,$3,ST_SetSRID(ST_MakePoint($4,$5),4326),$6,$7,'publica') RETURNING id`,
      [d.tortilleriaId, d.producto, d.precioKg, d.lng, d.lat, d.precisionGps ?? null, atipico],
    );
    if (atipico) await pool.query("INSERT INTO alertas(tipo, captura_id) VALUES ('precio_atipico',$1)", [rows[0].id]);
    return reply.code(201).send({ id: rows[0].id, alerta: atipico });
  });
}
