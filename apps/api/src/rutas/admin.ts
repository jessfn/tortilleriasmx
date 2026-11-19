import type { FastifyInstance } from "fastify";
import { randomInt } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { z } from "zod";
import { Readable } from "node:stream";
import { auditar, pool } from "../db.js";
import { ultimosPreciosSql } from "./admin-mapa.js";

const uuid = z.string().uuid();
const staff = (app: FastifyInstance) => app.soloRoles("supervisor", "admin");

/** Contraseña temporal legible: sin caracteres que se confunden (0/O, 1/l/I). Ejemplo: Kp7mQx4Tnw */
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export const passwordTemporal = (largo = 10) => Array.from({ length: largo }, () => ALFABETO[randomInt(ALFABETO.length)]).join("");

/** Paginación opcional: sin ?pagina= se devuelve todo (arreglo); con ?pagina= (y ?limite=) se devuelve { filas, total, pagina, paginas, limite } */
const paginaSchema = z.object({
  pagina: z.coerce.number().int().min(1).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});
const paginar = (q: unknown) => {
  const p = paginaSchema.safeParse(q);
  return p.success && p.data.pagina ? { pagina: p.data.pagina, limite: p.data.limite } : null;
};
const respuestaPaginada = <T>(filas: T[], total: number, pg: { pagina: number; limite: number }) => ({
  filas, total, pagina: pg.pagina, limite: pg.limite, paginas: Math.max(1, Math.ceil(total / pg.limite)),
});

/** Sin acentos ni mayúsculas, para buscar "jose" y encontrar "JOSÉ" */
const sinAcentos = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const SIN_ACENTOS_SQL = (col: string) => `translate(lower(${col}), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')`;

/** Aprobar o rechazar precios a mano: queda quién y cuándo lo revisó, y la alerta se da por resuelta */
async function resolverCapturas(ids: string[], estatus: "validada" | "rechazada", usuarioId: string): Promise<number> {
  const { rows } = await pool.query(
    `UPDATE capturas_precio SET estatus = $1, aprobacion = 'manual', revisado_por = $2, revisado_en = now() WHERE id = ANY($3::uuid[]) RETURNING id`,
    [estatus, usuarioId, ids],
  );
  if (!rows.length) return 0;
  const hechos = rows.map((r) => r.id as string);
  await pool.query("UPDATE alertas SET estatus = 'resuelta' WHERE captura_id = ANY($1::uuid[])", [hechos]);
  for (const id of hechos) await auditar(usuarioId, `captura_${estatus}`, "capturas_precio", id);
  return hechos.length;
}

export function rutasAdmin(app: FastifyInstance) {
  app.get("/admin/resumen", { preHandler: staff(app) }, async () => {
    const HOY = "(now() AT TIME ZONE 'America/Mexico_City')::date";
    // Los promedios usan el último precio que CUENTA de cada tortillería en los últimos 30 días (una tortillería = un valor)
    const { rows } = await pool.query(
      `WITH ${ultimosPreciosSql("30")}
       SELECT
         (SELECT count(*)::int FROM usuarios WHERE rol = 'capturista') AS usuarios,
         (SELECT count(DISTINCT p.tortilleria_id)::int FROM precios_que_cuentan p WHERE p.origen_tortilleria = 'denue') AS denue_visitadas,
         (SELECT count(*)::int FROM tortillerias WHERE origen = 'denue') AS denue_total,
         (SELECT count(*)::int FROM tortillerias WHERE origen = 'nueva') AS nuevas_total,
         (SELECT count(*)::int FROM tortillerias WHERE origen = 'nueva' AND estatus = 'validada') AS nuevas_validadas,
         (SELECT count(*)::int FROM tortillerias WHERE origen = 'nueva' AND estatus = 'pendiente') AS nuevas_pendientes,
         (SELECT count(*)::int FROM tortillerias WHERE origen = 'nueva' AND estatus = 'rechazada') AS nuevas_rechazadas,
         (SELECT count(*)::int FROM denue_catalogo) AS catalogo,
         (SELECT count(*)::int FROM tortillerias WHERE estatus = 'pendiente') AS tortillerias_pendientes,
         (SELECT count(*)::int FROM capturas_precio) AS capturas,
         (SELECT count(*)::int FROM capturas_precio WHERE estatus = 'pendiente') AS capturas_pendientes,
         (SELECT count(*)::int FROM capturas_precio WHERE alerta AND estatus = 'pendiente') AS alertas,
         (SELECT round(avg(precio)::numeric, 2) FROM ultimos WHERE producto = 'maiz') AS promedio_maiz,
         (SELECT round(avg(precio)::numeric, 2) FROM ultimos WHERE producto = 'masa') AS promedio_masa,
         (SELECT count(*)::int FROM capturas_precio WHERE fecha = ${HOY}) AS capturas_hoy,
         (SELECT count(DISTINCT capturista_id)::int FROM capturas_precio WHERE fecha = ${HOY}) AS censadores_hoy`,
    );
    // Por estado, con el mismo periodo (30 días) y la misma regla; "n" = capturas que cuentan, "tortillerias" = con las que se promedió
    const por = await pool.query(
      `WITH ${ultimosPreciosSql("30")}
       SELECT e.nombre AS estado, round(avg(u.precio)::numeric, 2) AS promedio, count(*)::int AS tortillerias,
              (SELECT count(*)::int FROM precios_que_cuentan p
                WHERE p.estado_clave = u.estado_clave AND p.producto = 'maiz' AND p.fecha >= ${HOY} - 30) AS n
         FROM ultimos u JOIN estados e ON e.clave = u.estado_clave
        WHERE u.producto = 'maiz'
        GROUP BY e.nombre, u.estado_clave ORDER BY n DESC LIMIT 10`,
    );
    const r = rows[0] ?? {};
    return {
      ...r,
      // "Tortillerías del DENUE visitadas" y "Tortillerías nuevas" (con su desglose) ya no se mezclan en un solo número
      avance_censo: r.denue_total ? Math.round((r.denue_visitadas / r.denue_total) * 10000) / 100 : 0,
      nuevas: { total: r.nuevas_total, validadas: r.nuevas_validadas, pendientes: r.nuevas_pendientes, rechazadas: r.nuevas_rechazadas },
      porEstado: por.rows,
    };
  });

  app.get("/admin/tortillerias", { preHandler: staff(app) }, async (req) => {
    const estatus = z.enum(["pendiente", "validada", "rechazada"]).optional().safeParse((req.query as any).estatus);
    const pg = paginar(req.query);
    const filtro = estatus.success ? estatus.data ?? null : null;
    // ?origen=nueva → solo las que dieron de alta los censadores; ?origen=denue → las del catálogo que ya tienen precio. Sin él, las dos (como antes).
    const origenQ = z.enum(["denue", "nueva"]).safeParse((req.query as any).origen);
    const origen = origenQ.success ? origenQ.data : null;
    const DONDE = `($1::text IS NULL OR t.estatus = $1)
          AND ($2::text IS NULL OR t.origen = $2)
          AND (t.origen <> 'denue' OR EXISTS (SELECT 1 FROM capturas_precio c WHERE c.tortilleria_id = t.id))`;
    const { rows } = await pool.query(
      `SELECT t.id, t.nombre, t.domicilio, t.estatus, t.origen, t.creado_en,
              ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng,
              m.nombre AS municipio, e.nombre AS estado, u.correo AS creador,
              t.localidad, t.tipo_vial, t.calle, t.numero_ext, t.numero_int, t.colonia, t.codigo_postal, t.telefono, t.correo,
              t.personal_ocupado, t.codigo_scian, t.fecha_alta,
              (SELECT count(*)::int FROM fotos f WHERE f.tortilleria_id = t.id) AS n_fotos,
              (EXISTS (SELECT 1 FROM tortilleria_fiscal x WHERE x.tortilleria_id = t.id)
               OR EXISTS (SELECT 1 FROM responsables r WHERE r.tortilleria_id = t.id)) AS tiene_fiscal
         FROM tortillerias t
         LEFT JOIN municipios m ON m.clave = t.municipio_clave
         LEFT JOIN estados e ON e.clave = t.estado_clave
         LEFT JOIN usuarios u ON u.id = t.creado_por
        WHERE ${DONDE}
        ORDER BY t.creado_en DESC, t.id${pg ? " LIMIT $3 OFFSET $4" : ""}`,
      pg ? [filtro, origen, pg.limite, (pg.pagina - 1) * pg.limite] : [filtro, origen],
    );
    if (!pg) return rows;
    const { rows: [c] } = await pool.query(`SELECT count(*)::int AS n FROM tortillerias t WHERE ${DONDE}`, [filtro, origen]);
    return respuestaPaginada(rows, c.n, pg);
  });

  app.get<{ Params: { id: string } }>("/admin/tortillerias/:id/fotos", { preHandler: staff(app) }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query("SELECT id FROM fotos WHERE tortilleria_id = $1 ORDER BY fecha DESC", [req.params.id]);
    return rows;
  });

  app.get("/admin/capturas", { preHandler: staff(app) }, async (req, reply) => {
    const q = req.query as { estatus?: string; alertas?: string; tortilleria?: string };
    const estatus = z.enum(["pendiente", "validada", "rechazada"]).safeParse(q.estatus);
    const tortilleria = q.tortilleria ? uuid.safeParse(q.tortilleria) : null;
    if (tortilleria && !tortilleria.success) return reply.code(400).send({ error: "Id inválido" });
    const pg = paginar(req.query);
    const params = [estatus.success ? estatus.data : null, q.alertas === "1", tortilleria?.success ? tortilleria.data : null];
    const DONDE = `($1::text IS NULL OR c.estatus = $1) AND ($2::boolean IS NOT TRUE OR c.alerta)
          AND ($3::uuid IS NULL OR c.tortilleria_id = $3)`;
    const { rows } = await pool.query(
      `SELECT c.id, c.producto, c.precio_kg, c.fecha, c.estatus, c.alerta, c.tortilleria_id,
              c.mediana_ref::float8 AS mediana_ref, c.n_ref, c.aprobacion,
              c.precision_gps, ST_Y(c.geom_captura) AS captura_lat, ST_X(c.geom_captura) AS captura_lng,
              coalesce(c.capturado_en, c.creado_en) AS capturado_en,
              t.nombre, m.nombre AS municipio, e.nombre AS estado, u.correo AS capturista
         FROM capturas_precio c
         JOIN tortillerias t ON t.id = c.tortilleria_id
         LEFT JOIN municipios m ON m.clave = t.municipio_clave
         LEFT JOIN estados e ON e.clave = t.estado_clave
         LEFT JOIN usuarios u ON u.id = c.capturista_id
        WHERE ${DONDE}
        ORDER BY ${tortilleria ? "c.creado_en DESC" : "c.alerta DESC, c.creado_en DESC"}, c.id${pg ? " LIMIT $4 OFFSET $5" : tortilleria ? " LIMIT 100" : ""}`,
      pg ? [...params, pg.limite, (pg.pagina - 1) * pg.limite] : params,
    );
    if (!pg) return rows;
    const { rows: [c] } = await pool.query(`SELECT count(*)::int AS n FROM capturas_precio c WHERE ${DONDE}`, params);
    return respuestaPaginada(rows, c.n, pg);
  });

  app.patch<{ Params: { id: string } }>("/admin/capturas/:id", { preHandler: staff(app) }, async (req, reply) => {
    const p = z.object({ estatus: z.enum(["validada", "rechazada"]) }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Datos inválidos" });
    const hechas = await resolverCapturas([req.params.id], p.data.estatus, req.user.sub);
    if (!hechas) return reply.code(404).send({ error: "No existe" });
    return { ok: true };
  });

  // Aprobar o rechazar varios precios a la vez (máximo 200), con la misma lógica y auditoría que el individual
  app.patch("/admin/capturas", { preHandler: staff(app) }, async (req, reply) => {
    const p = z.object({ ids: z.array(z.string().uuid()).min(1).max(200), estatus: z.enum(["validada", "rechazada"]) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos (de 1 a 200 precios)" });
    const ids = [...new Set(p.data.ids)];
    const hechas = await resolverCapturas(ids, p.data.estatus, req.user.sub);
    return { ok: true, actualizadas: hechas };
  });

  // Bitácora de auditoría (solo administrador, solo lectura): "¿quién vio este RFC?", "¿quién aprobó este precio?"
  app.get("/admin/auditoria", { preHandler: app.soloRoles("admin") }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const pg = paginar(req.query) ?? { pagina: 1, limite: 50 };
    const fechaOk = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const params = [sinAcentos((q.usuario ?? "").trim().slice(0, 80)), (q.accion ?? "").trim().slice(0, 60), fechaOk(q.desde), fechaOk(q.hasta)];
    const DONDE = `($1::text = '' OR ${SIN_ACENTOS_SQL("coalesce(u.correo,'') || ' ' || coalesce(u.usuario,'')")} LIKE '%' || $1 || '%')
          AND ($2::text = '' OR a.accion ILIKE '%' || $2 || '%')
          AND ($3::date IS NULL OR (a.fecha AT TIME ZONE 'America/Mexico_City')::date >= $3::date)
          AND ($4::date IS NULL OR (a.fecha AT TIME ZONE 'America/Mexico_City')::date <= $4::date)`;
    const { rows } = await pool.query(
      `SELECT a.id, a.fecha, u.correo AS usuario, a.accion, a.entidad, a.entidad_id
         FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
        WHERE ${DONDE} ORDER BY a.fecha DESC, a.id DESC LIMIT $5 OFFSET $6`,
      [...params, pg.limite, (pg.pagina - 1) * pg.limite],
    );
    const { rows: [c] } = await pool.query(`SELECT count(*)::int AS n FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id WHERE ${DONDE}`, params);
    return respuestaPaginada(rows, c.n, pg);
  });

  // Descarga de la base de capturas: CSV en UTF-8 con BOM (Excel muestra bien los acentos), por trozos (no se carga todo en memoria).
  // Sin RFC, razón social, celular ni ningún dato personal de la tortillería.
  app.get("/admin/exportar/capturas", { preHandler: staff(app), config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const fechaOk = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const estado = q.estado && /^\d{2}$/.test(q.estado) ? q.estado : null;
    const municipio = q.municipio && /^\d{5}$/.test(q.municipio) ? q.municipio : null;
    if ((q.estado && !estado) || (q.municipio && !municipio) || (q.desde && !fechaOk(q.desde)) || (q.hasta && !fechaOk(q.hasta)))
      return reply.code(400).send({ error: "Filtros inválidos" });
    const estatusQ = z.enum(["cuentan", "todos", "pendiente", "validada", "rechazada"]).safeParse(q.estatus ?? "cuentan");
    if (!estatusQ.success) return reply.code(400).send({ error: "estatus inválido" });
    const estatus = estatusQ.data;
    const filtros = { desde: fechaOk(q.desde), hasta: fechaOk(q.hasta), estado, municipio, estatus };
    // Por omisión solo lo que cuenta en las estadísticas (captura validada de una tortillería validada, tortilla o masa)
    const regla =
      estatus === "cuentan" ? "c.estatus = 'validada' AND t.estatus = 'validada' AND c.producto IN ('maiz','masa')" : estatus === "todos" ? "true" : "c.estatus = $5";
    const params: unknown[] = [filtros.desde, filtros.hasta, estado, municipio];
    if (estatus !== "cuentan" && estatus !== "todos") params.push(estatus);
    const sql = `SELECT c.id, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, to_char(coalesce(c.capturado_en, c.creado_en) AT TIME ZONE 'America/Mexico_City', 'HH24:MI') AS hora,
              c.producto, c.precio_kg::float8 AS precio_kg, c.estatus, c.alerta AS atipico, c.mediana_ref::float8 AS mediana_ref, c.aprobacion,
              t.id AS id_tortilleria, t.id_denue, t.origen, t.estatus AS estatus_tortilleria, t.nombre, t.domicilio, e.nombre AS estado, m.nombre AS municipio,
              ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng,
              (EXISTS (SELECT 1 FROM tortilleria_fiscal x WHERE x.tortilleria_id = t.id) OR EXISTS (SELECT 1 FROM responsables r WHERE r.tortilleria_id = t.id)) AS tiene_fiscal,
              (SELECT n.motivo FROM fiscal_negativas n WHERE n.tortilleria_id = t.id ORDER BY n.creado_en DESC LIMIT 1) AS ultimo_motivo,
              u.correo AS censador, ST_Y(c.geom_captura) AS gps_lat, ST_X(c.geom_captura) AS gps_lng, c.precision_gps::float8 AS precision_gps
         FROM capturas_precio c
         JOIN tortillerias t ON t.id = c.tortilleria_id
         LEFT JOIN municipios m ON m.clave = t.municipio_clave
         LEFT JOIN estados e ON e.clave = t.estado_clave
         LEFT JOIN usuarios u ON u.id = c.capturista_id
        WHERE ${regla} AND ($1::date IS NULL OR c.fecha >= $1::date) AND ($2::date IS NULL OR c.fecha <= $2::date)
          AND ($3::text IS NULL OR t.estado_clave = $3) AND ($4::text IS NULL OR t.municipio_clave = $4)`;
    const COLUMNAS = [
      "id_captura", "fecha", "hora_captura", "producto", "precio_kg", "estatus", "atipico", "mediana_ref", "aprobacion", "id_tortilleria", "id_denue", "origen",
      "estatus_tortilleria", "nombre_tortilleria", "domicilio", "estado", "municipio", "lat", "lng", "tiene_datos_fiscales", "ultimo_motivo_sin_fiscal",
      "censador_correo", "gps_lat", "gps_lng", "precision_gps",
    ];
    // Un texto que empiece con = + - @ lo tomaría Excel como fórmula: se le antepone un apóstrofo
    const celda = (v: unknown) => {
      if (v === null || v === undefined) return "";
      let t = typeof v === "boolean" ? (v ? "si" : "no") : String(v);
      if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = "'" + t;
      return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    async function* generar() {
      yield "\uFEFF" + COLUMNAS.join(",") + "\r\n";
      let ultimo: string | null = null;
      for (;;) {
        // por trozos de 2000 ordenados por id: no se carga todo en memoria
        const res: { rows: any[] } = await pool.query(`${sql} AND ($${params.length + 1}::uuid IS NULL OR c.id > $${params.length + 1}::uuid) ORDER BY c.id LIMIT 2000`, [...params, ultimo]);
        const rows = res.rows;
        if (!rows.length) return;
        yield rows
          .map((r) =>
            [r.id, r.fecha, r.hora, r.producto, r.precio_kg, r.estatus, r.atipico, r.mediana_ref, r.aprobacion, r.id_tortilleria, r.id_denue, r.origen, r.estatus_tortilleria,
              r.nombre, r.domicilio, r.estado, r.municipio, r.lat, r.lng, r.tiene_fiscal, r.ultimo_motivo, r.censador, r.gps_lat, r.gps_lng, r.precision_gps].map(celda).join(","),
          )
          .join("\r\n") + "\r\n";
        ultimo = rows[rows.length - 1].id;
        if (rows.length < 2000) return;
      }
    }
    await auditar(req.user.sub, "exportar_capturas", "capturas_precio", JSON.stringify(filtros));
    const hoy = new Date().toISOString().slice(0, 10);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="capturas-${hoy}.csv"`)
      .header("cache-control", "no-store")
      .send(Readable.from(generar()));
  });

  // Gestión de usuarios: solo administradores
  // Usuarios con buscador (correo, usuario, nombre y apellidos, sin importar acentos ni mayúsculas), filtros y páginas (?pagina=&limite=).
  // Sin ?pagina se devuelven todos. Cada fila trae su última captura y cuántas hizo en los últimos 7 días, para ver quién está trabajando.
  app.get("/admin/usuarios", { preHandler: app.soloRoles("admin") }, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const pg = paginar(req.query);
    const rol = z.enum(["capturista", "supervisor", "admin"]).safeParse(q.rol);
    const activo = q.activo === "1" || q.activo === "true" ? true : q.activo === "0" || q.activo === "false" ? false : null;
    const texto = sinAcentos((q.q ?? "").trim().slice(0, 80));
    const DONDE = `($1::text IS NULL OR u.rol = $1) AND ($2::boolean IS NULL OR u.activo = $2)
          AND ($3::text = '' OR ${SIN_ACENTOS_SQL("coalesce(u.correo,'') || ' ' || coalesce(u.usuario,'') || ' ' || coalesce(u.nombre,'') || ' ' || coalesce(u.apellidos,'')")} LIKE '%' || $3 || '%')`;
    const params = [rol.success ? rol.data : null, activo, texto];
    const { rows } = await pool.query(
      `SELECT u.id, u.correo, u.usuario, u.nombre, u.apellidos, u.rol, u.activo, u.creado_en, u.debe_cambiar_password,
              (SELECT count(*)::int FROM capturas_precio c WHERE c.capturista_id = u.id) AS capturas,
              (SELECT to_char(max(coalesce(c.capturado_en, c.creado_en)) AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') FROM capturas_precio c WHERE c.capturista_id = u.id) AS ultima_captura,
              (SELECT count(*)::int FROM capturas_precio c WHERE c.capturista_id = u.id AND c.fecha >= (now() AT TIME ZONE 'America/Mexico_City')::date - 6) AS capturas_7d
         FROM usuarios u WHERE ${DONDE}
        ORDER BY u.creado_en DESC, u.id${pg ? " LIMIT $4 OFFSET $5" : ""}`,
      pg ? [...params, pg.limite, (pg.pagina - 1) * pg.limite] : params,
    );
    if (!pg) return rows;
    const { rows: [c] } = await pool.query(`SELECT count(*)::int AS n FROM usuarios u WHERE ${DONDE}`, params);
    return respuestaPaginada(rows, c.n, pg);
  });

  app.patch<{ Params: { id: string } }>("/admin/usuarios/:id", { preHandler: app.soloRoles("admin") }, async (req, reply) => {
    const p = z.object({ rol: z.enum(["capturista", "supervisor", "admin"]).optional(), activo: z.boolean().optional() }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success || (p.data.rol === undefined && p.data.activo === undefined))
      return reply.code(400).send({ error: "Datos inválidos" });
    if (req.params.id === req.user.sub) return reply.code(400).send({ error: "No puedes cambiar tu propio rol ni desactivarte" });
    const r = await pool.query(
      "UPDATE usuarios SET rol = COALESCE($1, rol), activo = COALESCE($2, activo) WHERE id = $3",
      [p.data.rol ?? null, p.data.activo ?? null, req.params.id],
    );
    if (!r.rowCount) return reply.code(404).send({ error: "No existe" });
    await auditar(req.user.sub, "editar_usuario", "usuarios", req.params.id);
    return { ok: true };
  });

  // Recuperar contraseña (sin correo): la administración genera una temporal que se muestra UNA vez; la persona debe cambiarla al entrar
  app.post<{ Params: { id: string } }>("/admin/usuarios/:id/restablecer-password", { preHandler: app.soloRoles("admin"), config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    if (req.params.id === req.user.sub) return reply.code(400).send({ error: "Para cambiar tu contraseña usa tu perfil" });
    const temporal = passwordTemporal();
    const r = await pool.query("UPDATE usuarios SET password_hash = $1, debe_cambiar_password = true WHERE id = $2", [await hash(temporal), req.params.id]);
    if (!r.rowCount) return reply.code(404).send({ error: "No existe" });
    await auditar(req.user.sub, "restablecer_password", "usuarios", req.params.id);
    return { password: temporal };
  });
}
