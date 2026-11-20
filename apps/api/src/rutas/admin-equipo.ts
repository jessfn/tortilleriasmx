import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Readable } from "node:stream";
import { auditar, pool } from "../db.js";
import { aHoraMexico, CLAVE_CORTE, corteDesdeHoraMexico, leerCorte } from "../ajustes.js";
import { alcanceDe, enAlcanceSql, soloConEstado } from "../alcance.js";

const HOY = "(now() AT TIME ZONE 'America/Mexico_City')::date";
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const SIN_ACENTOS_SQL = (col: string) => `translate(lower(${col}), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')`;

/**
 * Mi equipo (solo lectura): los censadores de un estado, con sus capturas y el avance del censo.
 * Para el administrador estatal solo trae sus estados; DGTIC puede elegir el estado. Exportar a CSV (sin CURP) lo hace quien no tiene alcance nacional de solo consulta.
 */
export function rutasAdminEquipo(app: FastifyInstance) {
  const ver = app.conPermiso("ver_mi_equipo");

  /** Estados que cubre la consulta: el alcance de la cuenta, o el estado elegido si está dentro de él */
  function ambito(req: FastifyRequest, estado?: string): { lista: string[] | null; fuera: boolean } {
    const alcance = alcanceDe(req);
    if (!estado) return { lista: alcance, fuera: false };
    if (!/^\d{2}$/.test(estado)) return { lista: alcance, fuera: true };
    if (alcance !== null && !alcance.includes(estado)) return { lista: alcance, fuera: true };
    return { lista: [estado], fuera: false };
  }

  const ORDEN: Record<string, string> = {
    capturas: "coalesce(k.total, 0) DESC, u.creado_en DESC",
    hoy: "coalesce(k.hoy, 0) DESC, coalesce(k.total, 0) DESC",
    ultima: "k.ultima DESC NULLS LAST, u.creado_en DESC",
    siete: "coalesce(k.s7, 0) DESC, coalesce(k.total, 0) DESC",
    tiendas: "coalesce(k.tiendas, 0) DESC, coalesce(k.total, 0) DESC",
    nombre: `${SIN_ACENTOS_SQL("coalesce(nullif(u.nombre,''), u.correo)")} ASC, ${SIN_ACENTOS_SQL("u.apellidos")} ASC`,
  };

  async function censadores(lista: string[] | null, texto: string, orden: string, limite: number, desplazar: number, conEstado: boolean) {
    const donde = `u.rol = 'capturista' AND ${enAlcanceSql("u.estado_clave", 1)} AND ($5::boolean IS NOT TRUE OR u.estado_clave IS NOT NULL)
      AND ($2::text = '' OR ${SIN_ACENTOS_SQL("coalesce(u.correo,'') || ' ' || coalesce(u.nombre,'') || ' ' || coalesce(u.apellidos,'')")} LIKE '%' || $2 || '%')`;
    const { rows } = await pool.query(
      `WITH k AS (
         SELECT c.capturista_id, count(*)::int AS total, (count(*) FILTER (WHERE c.fecha = ${HOY}))::int AS hoy,
                (count(*) FILTER (WHERE c.fecha >= ${HOY} - 6))::int AS s7, count(DISTINCT c.tortilleria_id)::int AS tiendas,
                max(coalesce(c.capturado_en, c.creado_en)) AS ultima
           FROM capturas_precio c WHERE c.capturista_id IN (SELECT u.id FROM usuarios u WHERE u.rol = 'capturista' AND ${enAlcanceSql("u.estado_clave", 1)}) GROUP BY c.capturista_id)
       SELECT u.id, u.nombre, u.apellidos, u.correo, u.estado_cuenta, u.activo, u.datos_completos, es.nombre AS estado,
              coalesce(k.total, 0) AS capturas, coalesce(k.hoy, 0) AS hoy, coalesce(k.s7, 0) AS siete_dias, coalesce(k.tiendas, 0) AS tortillerias,
              to_char(k.ultima AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD HH24:MI') AS ultima_captura
         FROM usuarios u LEFT JOIN estados es ON es.clave = u.estado_clave LEFT JOIN k ON k.capturista_id = u.id
        WHERE ${donde}
        ORDER BY ${orden}, u.id LIMIT $3 OFFSET $4`,
      [lista, texto, limite, desplazar, conEstado],
    );
    return rows;
  }

  app.get("/admin/equipo", { preHandler: ver }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const { lista, fuera } = ambito(req, q.estado);
    if (fuera) return reply.code(403).send({ error: "Ese estado está fuera de tu alcance" });
    const texto = sinAcentos((typeof q.q === "string" ? q.q : "").trim().slice(0, 80));
    const orden = ORDEN[q.orden ?? ""] ?? ORDEN.capturas;
    const { rows: [i] } = await pool.query(
      `SELECT (SELECT count(*)::int FROM usuarios u WHERE u.rol = 'capturista' AND u.estado_cuenta = 'autorizado' AND u.activo AND ${enAlcanceSql("u.estado_clave", 1)}) AS autorizados,
              (SELECT count(DISTINCT c.capturista_id)::int FROM capturas_precio c JOIN usuarios u ON u.id = c.capturista_id
                WHERE u.rol = 'capturista' AND ${enAlcanceSql("u.estado_clave", 1)} AND c.fecha = ${HOY}) AS censadores_hoy,
              (SELECT count(*)::int FROM capturas_precio c JOIN usuarios u ON u.id = c.capturista_id
                WHERE u.rol = 'capturista' AND ${enAlcanceSql("u.estado_clave", 1)} AND c.fecha = ${HOY}) AS capturas_hoy,
              (SELECT count(*)::int FROM capturas_precio c JOIN usuarios u ON u.id = c.capturista_id
                WHERE u.rol = 'capturista' AND ${enAlcanceSql("u.estado_clave", 1)} AND c.fecha >= ${HOY} - 6) AS capturas_7d,
              (SELECT count(*)::int FROM tortillerias t WHERE t.origen = 'denue' AND t.operacion = 'activa' AND ${enAlcanceSql("t.estado_clave", 1)}) AS denue_total,
              (SELECT count(DISTINCT p.tortilleria_id)::int FROM precios_que_cuentan p WHERE p.origen_tortilleria = 'denue' AND p.operacion_tortilleria = 'activa' AND ${enAlcanceSql("p.estado_clave", 1)}) AS denue_visitadas`,
      [lista],
    );
    const filas = await censadores(lista, texto, orden, 500, 0, soloConEstado(req));
    return {
      indicadores: { ...i, avance_censo: i.denue_total ? Math.round((i.denue_visitadas / i.denue_total) * 10000) / 100 : 0 },
      censadores: filas,
      // el administrador estatal con alcance nacional solo consulta: sin ninguna descarga
      puedeExportar: !(req.user.rol === "estatal" && alcanceDe(req) === null),
    };
  });

  // Exportar la tabla a CSV (sin CURP ni contraseñas)
  app.get("/admin/equipo/exportar", { preHandler: ver, config: { rateLimit: { max: process.env.NODE_ENV === "test" ? 1000 : 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (req.user.rol === "estatal" && alcanceDe(req) === null) return reply.code(403).send({ error: "Esta cuenta es de solo consulta: no puede descargar" });
    const q = req.query as Record<string, string | undefined>;
    const { lista, fuera } = ambito(req, q.estado);
    if (fuera) return reply.code(403).send({ error: "Ese estado está fuera de tu alcance" });
    const texto = sinAcentos((typeof q.q === "string" ? q.q : "").trim().slice(0, 80));
    const filas = await censadores(lista, texto, ORDEN[q.orden ?? ""] ?? ORDEN.capturas, 20000, 0, soloConEstado(req));
    const celda = (v: unknown) => {
      if (v === null || v === undefined) return "";
      let t = String(v);
      if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
      return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    const cab = ["nombre", "correo", "estado", "estado_de_la_cuenta", "ultima_captura", "capturas_hoy", "capturas_7_dias", "capturas_totales", "tortillerias_distintas"];
    const cuerpo = filas.map((f: any) => [`${f.nombre} ${f.apellidos}`.trim(), f.correo, f.estado, f.estado_cuenta, f.ultima_captura, f.hoy, f.siete_dias, f.capturas, f.tortillerias].map(celda).join(","));
    await auditar(req.user.sub, "exportar_equipo", "usuarios", JSON.stringify({ estado: q.estado ?? null }));
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="mi-equipo-${new Date().toISOString().slice(0, 10)}.csv"`)
      .header("cache-control", "no-store")
      .send(Readable.from(["﻿" + cab.join(",") + "\r\n" + cuerpo.join("\r\n") + (cuerpo.length ? "\r\n" : "")]));
  });

  /* ---------------- Ajustes: fecha de corte del registro abierto (solo administrador) ---------------- */

  app.get("/admin/ajustes", { preHandler: app.soloRoles("admin") }, async () => {
    const corte = await leerCorte();
    const { rows: [c] } = await pool.query(
      `SELECT count(*) FILTER (WHERE u.registro_abierto)::int AS registro_abierto, count(*) FILTER (WHERE u.estado_cuenta = 'por_autorizar')::int AS por_autorizar FROM usuarios u WHERE u.rol = 'capturista'`,
    );
    return { corte: corte.toISOString(), corteMx: aHoraMexico(corte), zona: "America/Mexico_City", abierto: new Date() < corte, ...c };
  });

  // Solo afecta a los registros que lleguen después del cambio: las cuentas ya creadas no cambian
  app.put("/admin/ajustes/corte", { preHandler: app.soloRoles("admin"), config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const p = z.object({ corteMx: z.string() }).safeParse(req.body);
    const fecha = p.success ? corteDesdeHoraMexico(p.data.corteMx) : null;
    if (!fecha) return reply.code(400).send({ error: "Escribe la fecha y la hora (hora de México)" });
    await pool.query(
      `INSERT INTO configuracion(clave, valor, actualizado_por, actualizado_en) VALUES ($1,$2,$3,now())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()`,
      [CLAVE_CORTE, fecha.toISOString(), req.user.sub],
    );
    await auditar(req.user.sub, "cambiar_fecha_corte", "configuracion", `${aHoraMexico(fecha)} (hora de México)`);
    return { corte: fecha.toISOString(), corteMx: aHoraMexico(fecha), abierto: new Date() < fecha };
  });
}
