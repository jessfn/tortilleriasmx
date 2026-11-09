import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { capturaPrecioSchema } from "@tortillerias/shared";
import { pool } from "../db.js";

/** El día de captura se cuenta en hora de México (el servidor puede estar en UTC) */
export const HOY_MX = "(now() AT TIME ZONE 'America/Mexico_City')::date";

const uuid = z.string().uuid();

/** Una captura hecha sin conexión se acepta hasta con 7 días de retraso; hacia el futuro solo se tolera el desajuste del reloj */
export const MAX_DIAS_ATRASO = 7;
const TOLERANCIA_FUTURO_MS = 10 * 60 * 1000;

export function rutasPrecios(app: FastifyInstance) {
  // Solo usuarios registrados. Queda "pendiente" hasta que un supervisor la revise.
  // Límite: una captura por censador, tortillería, producto y día.
  app.post("/precios", { preHandler: app.autenticar, config: { rateLimit: { max: 90, timeWindow: "1 minute" } } }, async (req, reply) => {
    const p = capturaPrecioSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos", detalle: p.error.flatten() });
    const d = p.data;

    // Reintento de algo que ya llegó: se responde con el registro existente, sin duplicar
    if (d.idCliente) {
      const ya = await pool.query("SELECT id, alerta FROM capturas_precio WHERE id_cliente = $1", [d.idCliente]);
      if (ya.rowCount) return reply.code(200).send({ id: ya.rows[0].id, alerta: ya.rows[0].alerta, existente: true });
    }

    // Hora real de la captura (la del teléfono) y el día de México que le corresponde
    let capturadoEn: Date | null = null;
    if (d.capturadoEn) {
      capturadoEn = new Date(d.capturadoEn);
      const dif = Date.now() - capturadoEn.getTime();
      if (dif < -TOLERANCIA_FUTURO_MS) return reply.code(400).send({ error: "La hora de captura está en el futuro. Revisa la hora de tu teléfono." });
      if (dif > MAX_DIAS_ATRASO * 24 * 3600 * 1000) return reply.code(400).send({ error: `La captura tiene más de ${MAX_DIAS_ATRASO} días y ya no se puede enviar` });
    }
    const FECHA = capturadoEn ? "($9::timestamptz AT TIME ZONE 'America/Mexico_City')::date" : HOY_MX;
    const extra = capturadoEn ? [capturadoEn.toISOString()] : [];

    const t = await pool.query("SELECT municipio_clave, estatus FROM tortillerias WHERE id = $1", [d.tortilleriaId]);
    if (!t.rowCount || t.rows[0].estatus === "rechazada") return reply.code(404).send({ error: "Tortillería no existe" });

    const yaCapturado = (precioKg: unknown) =>
      reply.code(409).send({ error: "Ya capturaste este producto hoy en esta tortillería", precioKg: precioKg === null ? null : Number(precioKg), producto: d.producto });

    const previa = await pool.query(
      `SELECT precio_kg FROM capturas_precio
        WHERE capturista_id = $1 AND tortilleria_id = $2 AND producto = $3 AND fecha = ${capturadoEn ? "($4::timestamptz AT TIME ZONE 'America/Mexico_City')::date" : HOY_MX} LIMIT 1`,
      [req.user.sub, d.tortilleriaId, d.producto, ...extra],
    );
    if (previa.rowCount) return yaCapturado(previa.rows[0].precio_kg);

    // Mediana municipal de los últimos 90 días para detectar precios atípicos (±30 %)
    const med = await pool.query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY c.precio_kg) AS mediana, count(*) AS n
         FROM capturas_precio c JOIN tortillerias t ON t.id = c.tortilleria_id
        WHERE t.municipio_clave = $1 AND c.producto = $2 AND c.fecha > ${HOY_MX} - 90`,
      [t.rows[0].municipio_clave, d.producto],
    );
    const mediana = med.rows[0].mediana === null ? null : Number(med.rows[0].mediana);
    const atipico = mediana !== null && Number(med.rows[0].n) >= 3 && Math.abs(d.precioKg - mediana) / mediana > 0.3;

    // El GPS es opcional: sin coordenadas, geom_captura queda en NULL
    const conGps = d.lat !== undefined && d.lng !== undefined;
    let id: string;
    try {
      const { rows } = await pool.query(
        `INSERT INTO capturas_precio(tortilleria_id, producto, precio_kg, geom_captura, precision_gps, alerta, capturista_id, origen, fecha, id_cliente, capturado_en)
         VALUES ($1,$2,$3, CASE WHEN $4::float8 IS NULL OR $5::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($4,$5),4326) END, $6,$7,$8,'app', ${FECHA}, $10, $9::timestamptz)
         RETURNING id`,
        [d.tortilleriaId, d.producto, d.precioKg, conGps ? d.lng : null, conGps ? d.lat : null, d.precisionGps ?? null, atipico, req.user.sub, capturadoEn ? capturadoEn.toISOString() : null, d.idCliente ?? null],
      );
      id = rows[0].id;
    } catch (e: any) {
      // dos peticiones al mismo tiempo: el índice único deja pasar solo la primera
      if (e?.code === "23505") {
        if (d.idCliente) {
          const ya = await pool.query("SELECT id, alerta FROM capturas_precio WHERE id_cliente = $1", [d.idCliente]);
          if (ya.rowCount) return reply.code(200).send({ id: ya.rows[0].id, alerta: ya.rows[0].alerta, existente: true });
        }
        return yaCapturado(null);
      }
      throw e;
    }
    if (atipico) await pool.query("INSERT INTO alertas(tipo, captura_id) VALUES ('precio_atipico',$1)", [id]);
    return reply.code(201).send({ id, alerta: atipico });
  });

  // Lo que ESTE censador ya capturó hoy en esa tortillería: la pantalla de precio deshabilita esos campos
  app.get<{ Params: { id: string } }>("/tortillerias/:id/mis-precios-hoy", { preHandler: app.autenticar }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query(
      `SELECT producto, precio_kg FROM capturas_precio
        WHERE capturista_id = $1 AND tortilleria_id = $2 AND fecha = ${HOY_MX} AND producto IN ('maiz','masa')`,
      [req.user.sub, req.params.id],
    );
    const out: { maiz: number | null; masa: number | null } = { maiz: null, masa: null };
    for (const r of rows) out[r.producto as "maiz" | "masa"] = Number(r.precio_kg);
    return out;
  });
}
