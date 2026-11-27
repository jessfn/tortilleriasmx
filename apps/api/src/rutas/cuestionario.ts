import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { z } from "zod";
import { APOYOS, CUESTIONARIO_VERSION, cuestionarioSchema, diccionarioCuestionario, HIGIENE_PUNTOS, MOTIVO_NO_ADHESION, type Respuestas } from "@tortillerias/shared";
import { auditar, pool } from "../db.js";
import { MAX_DIAS_ATRASO, TOLERANCIA_FUTURO_MS } from "./precios.js";
import { calcularRango, consultaSchema, rangoTodo } from "../reportes.js";
import { reporteCuestionarioPdf, reporteCuestionarioXlsx, reunirReporteCuestionario, textosCuestionario } from "../reporte-cuestionario.js";
import { inicioDeSiempre, reporteCompletoPdf, reporteCompletoXlsx, reunirReporteCompleto, textosCompleto } from "../reporte-completo.js";

/**
 * C21 · Cuestionario de supervisión de tortillerías.
 *  - El censador lo guarda (con historial: nunca se sobrescribe) y, al actualizar, recibe SOLO los bloques A y B para prellenar.
 *  - Las respuestas, los indicadores por respuesta y la descarga son de la vista "Cuestionarios": un permiso RESERVADO que nadie tiene
 *    por su rol (ni un administrador); solo la cuenta a la que se le marca a mano. Los administradores estatales nunca (C21.9).
 */

const uuid = z.string().uuid();
const LIMITE_ESCRITURA = { rateLimit: { max: 60, timeWindow: "1 minute" } };

/** Universo de los indicadores: tortillerías activas y visitadas (con al menos un precio que cuenta, o nuevas validadas) */
export const SQL_VISITADAS = `SELECT t.id FROM tortillerias t
  WHERE t.operacion = 'activa' AND t.estatus = 'validada'
    AND (t.origen = 'nueva' OR EXISTS (SELECT 1 FROM precios_que_cuentan p WHERE p.tortilleria_id = t.id))`;

/** Estatus del cuestionario de una tortillería para la app: aplicado si tiene uno vigente; si no, el del último intento (o null) */
export const SQL_ESTATUS = (t: string) => `CASE WHEN EXISTS (SELECT 1 FROM tortilleria_cuestionarios k WHERE k.tortilleria_id = ${t} AND k.estatus = 'aplicado') THEN 'aplicado'
  WHEN EXISTS (SELECT 1 FROM tortilleria_cuestionarios k WHERE k.tortilleria_id = ${t}) THEN 'no_aplicado' END`;

const COLS = `a1_ubicacion, a1_otro, b1_otro, b3_otro, b8_otro, a2_limpieza, a2_plagas, a2_insumos, a2_personal, a2_basura, b1_insumo, b2_volumen, b3_propiedad, b4_trabajadores,
  b5_conoce_acuerdo, b6_motivos, b6_otro, b7_interes, b8_apoyos, c1_licencia, c2_imss, c3_declaracion`;

/** Fila de la base → respuestas en el formato del esquema compartido. `conC = false` nunca incluye el bloque C. */
function respuestasDe(r: any, conC: boolean): Partial<Respuestas> {
  const x: Partial<Respuestas> = {
    a1: r.a1_ubicacion,
    ...(r.a1_otro ? { a1Otro: r.a1_otro } : {}),
    ...(r.b1_otro ? { b1Otro: r.b1_otro } : {}),
    ...(r.b3_otro ? { b3Otro: r.b3_otro } : {}),
    ...(r.b8_otro ? { b8Otro: r.b8_otro } : {}),
    a2: Object.fromEntries(HIGIENE_PUNTOS.map((h) => [h.clave, r[`a2_${h.col}`]])) as Respuestas["a2"],
    b1: r.b1_insumo, b2: r.b2_volumen, b3: r.b3_propiedad, b4: r.b4_trabajadores, b5: r.b5_conoce_acuerdo,
    b8: r.b8_apoyos ?? [],
  };
  if (r.b6_motivos?.length) x.b6 = r.b6_motivos;
  if (r.b6_otro) x.b6Otro = r.b6_otro;
  if (r.b7_interes !== null && r.b7_interes !== undefined) x.b7 = r.b7_interes;
  if (conC) Object.assign(x, { c1: r.c1_licencia, c2: r.c2_imss, c3: r.c3_declaracion });
  return x;
}

/** Hora del teléfono: máximo 7 días atrás y solo se tolera el desajuste del reloj hacia el futuro */
function horaDeCaptura(valor?: string): Date | null | string {
  if (!valor) return null;
  const f = new Date(valor);
  const dif = Date.now() - f.getTime();
  if (dif < -TOLERANCIA_FUTURO_MS) return "La hora de captura está en el futuro. Revisa la hora de tu teléfono.";
  if (dif > MAX_DIAS_ATRASO * 24 * 3600 * 1000) return `La captura tiene más de ${MAX_DIAS_ATRASO} días y ya no se puede enviar`;
  return f;
}

/** Un texto que empiece con = + - @ lo tomaría Excel como fórmula: se le antepone un apóstrofo */
const celda = (v: unknown) => {
  if (v === null || v === undefined) return "";
  let t = typeof v === "boolean" ? (v ? "Sí" : "No") : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};

export function rutasCuestionario(app: FastifyInstance) {
  /** Vista "Cuestionarios": permiso reservado (se marca a mano); un administrador estatal nunca pasa (no está en sus roles) */
  const soloDgtic = app.conPermisoNacional("ver_cuestionarios");

  /* ------------------------------------------------------------------ censador */

  app.post<{ Params: { id: string } }>("/tortillerias/:id/cuestionario", { preHandler: app.autenticarCaptura, config: LIMITE_ESCRITURA }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const p = cuestionarioSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Revisa el cuestionario: falta responder o hay respuestas que no aplican", detalle: p.error.flatten() });
    const d = p.data;
    if (d.idCliente) {
      const ya = await pool.query("SELECT id FROM tortilleria_cuestionarios WHERE id_cliente = $1", [d.idCliente]);
      if (ya.rowCount) return reply.code(200).send({ id: ya.rows[0].id, existente: true });
    }
    const hora = horaDeCaptura(d.capturadoEn);
    if (typeof hora === "string") return reply.code(400).send({ error: hora });
    const t = await pool.query("SELECT operacion FROM tortillerias WHERE id = $1 AND estatus <> 'rechazada'", [req.params.id]);
    if (!t.rowCount) return reply.code(404).send({ error: "Tortillería no existe" });
    if (t.rows[0].operacion === "inactiva") return reply.code(409).send({ error: "Esta tortillería se dio de baja (ya no funciona): no lleva cuestionario" });

    const r = d.estatus === "aplicado" ? d.respuestas : null;
    const conGps = d.lat !== undefined && d.lng !== undefined;
    let id: string;
    try {
      const ins = await pool.query(
        `INSERT INTO tortilleria_cuestionarios(tortilleria_id, capturista_id, version, estatus, motivo_no_aplica, motivo_no_aplica_otro,
           a1_ubicacion, a2_limpieza, a2_plagas, a2_insumos, a2_personal, a2_basura, b1_insumo, b2_volumen, b3_propiedad, b4_trabajadores,
           b5_conoce_acuerdo, b6_motivos, b6_otro, b7_interes, b8_apoyos, c1_licencia, c2_imss, c3_declaracion,
           geom_captura, precision_gps, capturado_en, id_cliente, a1_otro, b8_otro, b1_otro, b3_otro)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
           CASE WHEN $25::float8 IS NULL OR $26::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($25,$26),4326) END, $27, $28, $29, $30, $31, $32, $33)
         RETURNING id`,
        [
          req.params.id, req.user.sub, CUESTIONARIO_VERSION, d.estatus,
          d.estatus === "no_aplicado" ? d.motivo : null, d.estatus === "no_aplicado" && d.motivo === "OTRO" ? d.motivoOtro : null,
          r?.a1 ?? null, r?.a2.H_LIMPIEZA ?? null, r?.a2.H_PLAGAS ?? null, r?.a2.H_INSUMOS ?? null, r?.a2.H_PERSONAL ?? null, r?.a2.H_BASURA ?? null,
          r?.b1 ?? null, r?.b2 ?? null, r?.b3 ?? null, r?.b4 ?? null, r?.b5 ?? null, r?.b6?.length ? r.b6 : null, r?.b6Otro ?? null,
          r?.b7 ?? null, r?.b8 ?? null, r?.c1 ?? null, r?.c2 ?? null, r?.c3 ?? null,
          conGps ? d.lng : null, conGps ? d.lat : null, d.precisionGps ?? null, hora ? hora.toISOString() : null, d.idCliente ?? null,
          r?.a1 === "OTRO" ? (r.a1Otro ?? null) : null, r?.b8.includes("OTRO") ? (r.b8Otro ?? null) : null,
          r?.b1 === "OTRO" ? (r.b1Otro ?? null) : null, r?.b3 === "OTRO" ? (r.b3Otro ?? null) : null,
        ],
      );
      id = ins.rows[0].id;
    } catch (e: any) {
      if (e?.code === "23505" && d.idCliente) {
        const ya = await pool.query("SELECT id FROM tortilleria_cuestionarios WHERE id_cliente = $1", [d.idCliente]);
        return reply.code(200).send({ id: ya.rows[0].id, existente: true });
      }
      throw e;
    }
    // el catálogo del teléfono cambia de versión para mostrar el nuevo estatus ("Falta cuestionario")
    await pool.query("UPDATE tortillerias SET actualizado_en = now() WHERE id = $1", [req.params.id]);
    await auditar(req.user.sub, "registrar_cuestionario", "tortilleria_cuestionarios", id);
    return reply.code(201).send({ id });
  });

  // Para prellenar al actualizar: el vigente (solo bloques A y B, NUNCA el C) y el último intento. Solo para quien captura.
  app.get<{ Params: { id: string } }>("/tortillerias/:id/cuestionario", { preHandler: app.soloRoles("capturista") }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const v = await pool.query(`SELECT ${COLS}, to_char(coalesce(capturado_en, creado_en) AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS fecha FROM cuestionario_vigente WHERE tortilleria_id = $1`, [req.params.id]);
    const u = await pool.query(
      `SELECT estatus, motivo_no_aplica, to_char(fecha AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS fecha FROM cuestionario_ultimo WHERE tortilleria_id = $1`,
      [req.params.id],
    );
    return {
      vigente: v.rows[0] ? { fecha: v.rows[0].fecha, respuestas: respuestasDe(v.rows[0], false) } : null,
      ultimo: u.rows[0] ? { estatus: u.rows[0].estatus, motivo: u.rows[0].motivo_no_aplica ?? null, fecha: u.rows[0].fecha } : null,
    };
  });

  /* ------------------------------------------------------------------ DGTIC (solo rol admin) */

  // Detalle de una tortillería: el vigente completo (A, B y C), el último intento y el historial
  app.get<{ Params: { id: string } }>("/admin/cuestionarios/tortilleria/:id", { preHandler: soloDgtic }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query(
      `SELECT k.id, k.estatus, k.version, k.motivo_no_aplica, k.motivo_no_aplica_otro, ${COLS.replace(/(\w+)/g, "k.$1")},
              coalesce(k.capturado_en, k.creado_en) AS fecha, u.nombre, u.apellidos, u.correo
         FROM tortilleria_cuestionarios k LEFT JOIN usuarios u ON u.id = k.capturista_id
        WHERE k.tortilleria_id = $1 ORDER BY coalesce(k.capturado_en, k.creado_en) DESC, k.creado_en DESC`,
      [req.params.id],
    );
    const fila = (r: any) => ({
      id: r.id, estatus: r.estatus, version: r.version, fecha: r.fecha, motivo: r.motivo_no_aplica, motivoOtro: r.motivo_no_aplica_otro,
      censador: [r.nombre, r.apellidos].filter(Boolean).join(" ").trim() || r.correo || null,
      respuestas: r.estatus === "aplicado" ? respuestasDe(r, true) : null,
    });
    const historial = rows.map(fila);
    await auditar(req.user.sub, "ver_cuestionario", "tortillerias", req.params.id);
    return { vigente: historial.find((h) => h.estatus === "aplicado") ?? null, ultimo: historial[0] ?? null, historial };
  });

  // Lista de la vista "Cuestionarios": una fila por tortillería visitada con su estatus (aplicado, no se pudo aplicar o falta), filtrable y por páginas
  app.get("/admin/cuestionarios", { preHandler: soloDgtic }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (q.estado && !/^\d{2}$/.test(q.estado)) return reply.code(400).send({ error: "Estado inválido" });
    const estatus = z.enum(["", "aplicado", "no_aplicado", "falta"]).safeParse(q.estatus ?? "");
    if (!estatus.success) return reply.code(400).send({ error: "Estatus inválido" });
    const texto = (q.q ?? "").trim().slice(0, 80);
    const pagina = Math.max(1, Number(q.pagina) || 1);
    const limite = Math.min(100, Math.max(10, Number(q.limite) || 25));
    const base = `WITH v AS (${SQL_VISITADAS}),
      x AS (SELECT t.id, t.nombre, t.domicilio, t.estado_clave, e.nombre AS estado, m.nombre AS municipio,
                   k.id AS k_id, coalesce(k.capturado_en, k.creado_en) AS k_fecha, k.capturista_id AS k_cens,
                   u.estatus AS u_estatus, u.motivo_no_aplica AS u_motivo, u.fecha AS u_fecha, u.capturista_id AS u_cens,
                   CASE WHEN k.id IS NOT NULL THEN 'aplicado' WHEN u.estatus = 'no_aplicado' THEN 'no_aplicado' ELSE 'falta' END AS situacion
              FROM tortillerias t JOIN v ON v.id = t.id
              LEFT JOIN estados e ON e.clave = t.estado_clave
              LEFT JOIN municipios m ON m.clave = t.municipio_clave
              LEFT JOIN cuestionario_vigente k ON k.tortilleria_id = t.id
              LEFT JOIN cuestionario_ultimo u ON u.tortilleria_id = t.id)
      SELECT * FROM x WHERE ($1::text IS NULL OR x.estado_clave = $1) AND ($2::text = '' OR x.situacion = $2)
        AND ($3::text = '' OR translate(lower(x.nombre || ' ' || coalesce(x.municipio,'') || ' ' || coalesce(x.domicilio,'')), 'áéíóúüñ', 'aeiouun') LIKE '%' || translate(lower($3), 'áéíóúüñ', 'aeiouun') || '%')`;
    const params = [q.estado ?? null, estatus.data, texto];
    const { rows: [{ total }] } = await pool.query(`SELECT count(*)::int AS total FROM (${base}) z`, params);
    const { rows } = await pool.query(
      `SELECT z.*, uc.nombre AS c_nombre, uc.apellidos AS c_apellidos, uc.correo AS c_correo FROM (${base}) z
         LEFT JOIN usuarios uc ON uc.id = coalesce(z.k_cens, z.u_cens)
        ORDER BY coalesce(z.k_fecha, z.u_fecha) DESC NULLS LAST, z.nombre, z.id LIMIT $4 OFFSET $5`,
      [...params, limite, (pagina - 1) * limite],
    );
    return {
      total, pagina, limite, paginas: Math.max(1, Math.ceil(total / limite)),
      filas: rows.map((r: any) => ({
        id: r.id, nombre: r.nombre, domicilio: r.domicilio, estado: r.estado, municipio: r.municipio, situacion: r.situacion,
        fecha: r.k_fecha ?? r.u_fecha ?? null, motivo: r.situacion === "no_aplicado" ? r.u_motivo : null,
        censador: [r.c_nombre, r.c_apellidos].filter(Boolean).join(" ").trim() || r.c_correo || null,
      })),
    };
  });

  // Indicadores: % de visitadas con cuestionario aplicado (nacional, por estado y, con ?estado=, por municipio) y "no se pudo aplicar" por motivo
  app.get("/admin/cuestionarios/indicadores", { preHandler: soloDgtic }, async (req, reply) => {
    const q = req.query as { estado?: string };
    if (q.estado && !/^\d{2}$/.test(q.estado)) return reply.code(400).send({ error: "Estado inválido" });
    const base = `WITH v AS (${SQL_VISITADAS}),
      x AS (SELECT t.id, t.estado_clave, t.municipio_clave,
                   EXISTS (SELECT 1 FROM cuestionario_vigente k WHERE k.tortilleria_id = t.id) AS aplicado,
                   (SELECT u.estatus = 'no_aplicado' FROM cuestionario_ultimo u WHERE u.tortilleria_id = t.id) AS ultimo_no
              FROM tortillerias t JOIN v ON v.id = t.id)`;
    const nac = await pool.query(`${base} SELECT count(*)::int AS visitadas, count(*) FILTER (WHERE aplicado)::int AS aplicados, count(*) FILTER (WHERE NOT aplicado AND ultimo_no)::int AS no_aplicados FROM x`);
    const est = await pool.query(
      `${base} SELECT x.estado_clave AS clave, e.nombre, count(*)::int AS visitadas, count(*) FILTER (WHERE aplicado)::int AS aplicados
         FROM x LEFT JOIN estados e ON e.clave = x.estado_clave GROUP BY x.estado_clave, e.nombre ORDER BY e.nombre`,
    );
    const mun = q.estado
      ? await pool.query(
          `${base} SELECT x.municipio_clave AS clave, m.nombre, count(*)::int AS visitadas, count(*) FILTER (WHERE aplicado)::int AS aplicados
             FROM x LEFT JOIN municipios m ON m.clave = x.municipio_clave WHERE x.estado_clave = $1 GROUP BY x.municipio_clave, m.nombre ORDER BY m.nombre`,
          [q.estado],
        )
      : null;
    // motivos del último intento de las que siguen sin cuestionario aplicado
    const mot = await pool.query(
      `WITH v AS (${SQL_VISITADAS})
       SELECT u.motivo_no_aplica AS motivo, count(*)::int AS n FROM cuestionario_ultimo u JOIN v ON v.id = u.tortilleria_id JOIN tortillerias t ON t.id = u.tortilleria_id
        WHERE u.estatus = 'no_aplicado' AND NOT EXISTS (SELECT 1 FROM cuestionario_vigente k WHERE k.tortilleria_id = u.tortilleria_id)
          AND ($1::text IS NULL OR t.estado_clave = $1)
        GROUP BY 1 ORDER BY 2 DESC`,
      [q.estado ?? null],
    );
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    const conPct = (r: any) => ({ ...r, porcentaje: pct(r.aplicados, r.visitadas) });
    return { nacional: conPct(nac.rows[0]), estados: est.rows.map(conPct), municipios: mun ? mun.rows.map(conPct) : null, motivos: mot.rows };
  });

  // Descarga: una fila por tortillería visitada con su cuestionario vigente (también las que no tienen, con las respuestas vacías)
  const limiteDescarga = { rateLimit: { max: process.env.NODE_ENV === "test" ? 1000 : 10, timeWindow: "1 minute" } };
  app.get("/admin/exportar/cuestionarios", { preHandler: soloDgtic, config: limiteDescarga }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const fechaOk = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const estado = q.estado && /^\d{2}$/.test(q.estado) ? q.estado : null;
    if ((q.estado && !estado) || (q.desde && !fechaOk(q.desde)) || (q.hasta && !fechaOk(q.hasta))) return reply.code(400).send({ error: "Filtros inválidos" });
    const filtros = { estado, desde: fechaOk(q.desde), hasta: fechaOk(q.hasta) };
    // las fechas filtran por la fecha del cuestionario vigente (en hora de México); sin fechas van todas las visitadas
    const conFechas = !!(filtros.desde || filtros.hasta);
    const sql = `WITH v AS (${SQL_VISITADAS})
      SELECT t.id, t.id_denue, t.origen, e.nombre AS estado, m.nombre AS municipio, ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng, t.elaboracion,
             pm.precio_kg::float8 AS p_maiz, to_char(pm.fecha, 'YYYY-MM-DD') AS f_maiz, pa.precio_kg::float8 AS p_masa, to_char(pa.fecha, 'YYYY-MM-DD') AS f_masa,
             coalesce(k.estatus, u.estatus) AS estatus, CASE WHEN k.id IS NULL THEN u.motivo_no_aplica END AS motivo,
             to_char(coalesce(k.capturado_en, k.creado_en, u.fecha) AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS fecha_cuestionario,
             coalesce(k.capturista_id, u.capturista_id) AS censador, k.version, ${COLS.replace(/(\w+)/g, "k.$1")}
        FROM tortillerias t JOIN v ON v.id = t.id
        LEFT JOIN estados e ON e.clave = t.estado_clave
        LEFT JOIN municipios m ON m.clave = t.municipio_clave
        LEFT JOIN cuestionario_vigente k ON k.tortilleria_id = t.id
        LEFT JOIN cuestionario_ultimo u ON u.tortilleria_id = t.id
        LEFT JOIN LATERAL (SELECT p.precio_kg, p.fecha FROM precios_que_cuentan p WHERE p.tortilleria_id = t.id AND p.producto = 'maiz' ORDER BY p.fecha DESC, p.creado_en DESC LIMIT 1) pm ON true
        LEFT JOIN LATERAL (SELECT p.precio_kg, p.fecha FROM precios_que_cuentan p WHERE p.tortilleria_id = t.id AND p.producto = 'masa' ORDER BY p.fecha DESC, p.creado_en DESC LIMIT 1) pa ON true
       WHERE ($1::text IS NULL OR t.estado_clave = $1)
         AND (NOT $4::boolean OR ((coalesce(k.capturado_en, k.creado_en, u.fecha) AT TIME ZONE 'America/Mexico_City')::date BETWEEN coalesce($2::date, '-infinity'::date) AND coalesce($3::date, 'infinity'::date)))`;
    const params: unknown[] = [estado, filtros.desde, filtros.hasta, conFechas];
    const COLUMNAS = [
      "id_tortilleria", "id_denue", "origen", "estado", "municipio", "latitud", "longitud",
      "ultimo_precio_tortilla", "fecha_precio_tortilla", "ultimo_precio_masa", "fecha_precio_masa", "elaboracion",
      "estatus", "motivo_no_aplica", "fecha_cuestionario", "id_censador", "version",
      "a1_ubicacion", "a1_otro_texto", ...HIGIENE_PUNTOS.map((h) => `a2_h_${h.col}`), "b1_insumo", "b1_otro_texto", "b2_volumen", "b3_propiedad", "b3_otro_texto", "b4_trabajadores", "b5_conoce_acuerdo",
      ...MOTIVO_NO_ADHESION.map((m) => m.col), "b6_otro_texto", "b7_interes", ...APOYOS.map((a) => a.col), "b8_otro_texto", "c1_licencia", "c2_imss", "c3_declaracion",
    ];
    const marca = (lista: string[] | null, clave: string, aplicado: boolean) => (!aplicado ? null : lista?.includes(clave) ?? false);
    const filaCsv = (r: any) => {
      const ap = r.estatus === "aplicado";
      const b6Aplica = ap && r.b5_conoce_acuerdo === "CONOCE_NO_ADHERIDA";
      return [
        r.id, r.id_denue, r.origen === "nueva" ? "nueva" : "DENUE", r.estado, r.municipio, r.lat, r.lng,
        r.p_maiz, r.f_maiz, r.p_masa, r.f_masa, r.elaboracion,
        r.estatus, r.motivo, r.fecha_cuestionario, r.censador, r.version,
        r.a1_ubicacion, r.a1_otro, ...HIGIENE_PUNTOS.map((h) => r[`a2_${h.col}`]), r.b1_insumo, r.b1_otro, r.b2_volumen, r.b3_propiedad, r.b3_otro, r.b4_trabajadores, r.b5_conoce_acuerdo,
        ...MOTIVO_NO_ADHESION.map((m) => marca(r.b6_motivos, m.clave, b6Aplica)), r.b6_otro, r.b7_interes, ...APOYOS.map((a) => marca(r.b8_apoyos, a.clave, ap)), r.b8_otro,
        r.c1_licencia, r.c2_imss, r.c3_declaracion,
      ].map(celda).join(",");
    };
    async function* generar() {
      yield "﻿" + COLUMNAS.join(",") + "\r\n";
      let ultimo: string | null = null;
      for (;;) {
        const res: { rows: any[] } = await pool.query(`${sql} AND ($5::uuid IS NULL OR t.id > $5::uuid) ORDER BY t.id LIMIT 2000`, [...params, ultimo]);
        if (!res.rows.length) return;
        yield res.rows.map(filaCsv).join("\r\n") + "\r\n";
        ultimo = res.rows[res.rows.length - 1].id;
        if (res.rows.length < 2000) return;
      }
    }
    await auditar(req.user.sub, "exportar_cuestionarios", "tortilleria_cuestionarios", JSON.stringify(filtros));
    const hoy = new Date().toISOString().slice(0, 10);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="cuestionarios-${hoy}.csv"`)
      .header("cache-control", "no-store")
      .send(Readable.from(generar()));
  });

  /* ---------------- Reporte del cuestionario por periodo (PDF o Excel), igual que Extras ---------------- */
  const leerReporte = (query: unknown, reply: FastifyReply) => {
    const q = consultaSchema.extend({ estado: z.string().regex(/^\d{2}$/).optional() }).safeParse(query);
    if (!q.success) return void reply.code(400).send({ error: q.error.issues[0]?.message ?? "Datos inválidos" });
    const rango = calcularRango(q.data.periodo, q.data.fecha, q.data.hasta);
    if (typeof rango === "string") return void reply.code(400).send({ error: rango });
    return { rango, formato: q.data.formato, estado: q.data.estado ?? null };
  };
  app.get("/admin/cuestionarios/reporte/vista-previa", { preHandler: soloDgtic, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const p = leerReporte(req.query, reply);
    if (!p) return;
    const r = await reunirReporteCuestionario(p.rango, p.estado);
    const t = textosCuestionario(r);
    return { titulo: t.titulo, tipo: t.tipo, horario: t.horario, anterior: t.anterior, ambito: t.ambito, granularidad: p.rango.granularidad, totales: r.totales, anteriorTotales: r.anterior, avance: r.avance };
  });
  app.get("/admin/cuestionarios/reporte/descargar", { preHandler: soloDgtic, config: limiteDescarga }, async (req, reply) => {
    const p = leerReporte(req.query, reply);
    if (!p) return;
    const r = await reunirReporteCuestionario(p.rango, p.estado);
    const t = textosCuestionario(r);
    const cuerpo = p.formato === "pdf" ? await reporteCuestionarioPdf(r) : await reporteCuestionarioXlsx(r);
    await auditar(req.user.sub, "descargar_reporte_cuestionario", "reporte", `${p.rango.periodo}:${p.rango.desde}..${p.rango.hasta}:${p.formato}:${p.estado ?? "nacional"}`);
    return reply
      .header("content-type", p.formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="${t.nombreArchivo}.${p.formato}"`)
      .header("cache-control", "no-store")
      .send(cuerpo);
  });

  /* ---------- Reporte COMPLETO: precios (Extras) + cuestionario, solo tortillerías de máquina, con portada. Incluye "de siempre". ---------- */
  const leerCompleto = async (query: unknown, reply: FastifyReply) => {
    const q = consultaSchema.extend({ periodo: z.enum(["dia", "semana", "mes", "anio", "rango", "todo"]), fecha: consultaSchema.shape.fecha.optional() }).safeParse(query);
    if (!q.success) return void reply.code(400).send({ error: q.error.issues[0]?.message ?? "Datos inválidos" });
    if (q.data.periodo === "todo") return { rango: rangoTodo(await inicioDeSiempre()), formato: q.data.formato };
    if (!q.data.fecha) return void reply.code(400).send({ error: "Elige la fecha" });
    const rango = calcularRango(q.data.periodo, q.data.fecha, q.data.hasta);
    if (typeof rango === "string") return void reply.code(400).send({ error: rango });
    return { rango, formato: q.data.formato };
  };
  app.get("/admin/cuestionarios/reporte-completo/vista-previa", { preHandler: soloDgtic, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const p = await leerCompleto(req.query, reply);
    if (!p) return;
    const r = await reunirReporteCompleto(p.rango);
    const t = textosCompleto(r);
    return {
      titulo: t.titulo, tipo: t.tipo, horario: t.horario, anterior: t.anterior, granularidad: p.rango.granularidad, desde: p.rango.desde, hasta: p.rango.hasta,
      precios: r.precios.totales, preciosAnterior: r.precios.anterior, cuestionario: r.cuestionario.totales, cuestionarioAnterior: r.cuestionario.anterior,
      avance: r.cuestionario.avance, universo: r.universo,
    };
  });
  app.get("/admin/cuestionarios/reporte-completo/descargar", { preHandler: soloDgtic, config: limiteDescarga }, async (req, reply) => {
    const p = await leerCompleto(req.query, reply);
    if (!p) return;
    const r = await reunirReporteCompleto(p.rango);
    const t = textosCompleto(r);
    const cuerpo = p.formato === "pdf" ? await reporteCompletoPdf(r) : await reporteCompletoXlsx(r);
    await auditar(req.user.sub, "descargar_reporte_completo", "reporte", `${p.rango.periodo}:${p.rango.desde}..${p.rango.hasta}:${p.formato}:maquina`);
    return reply
      .header("content-type", p.formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="${t.nombreArchivo}.${p.formato}"`)
      .header("cache-control", "no-store")
      .send(cuerpo);
  });

  // Diccionario de datos: código → texto de cada pregunta y respuesta
  app.get("/admin/exportar/cuestionarios/diccionario", { preHandler: soloDgtic, config: limiteDescarga }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const filas = diccionarioCuestionario();
    const csv = "﻿" + ["columna,pregunta,codigo,texto", ...filas.map((f) => [f.columna, f.pregunta, f.codigo, f.texto].map(celda).join(","))].join("\r\n") + "\r\n";
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="cuestionarios-diccionario-${CUESTIONARIO_VERSION}.csv"`)
      .header("cache-control", "no-store")
      .send(csv);
  });
}
