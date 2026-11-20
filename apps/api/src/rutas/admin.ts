import type { FastifyInstance } from "fastify";
import { randomInt } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { z } from "zod";
import { Readable } from "node:stream";
import { censadorNuevoSchema, curpSchema, enmascararCurp, esPermiso, permisosEfectivos, personalNuevoSchema, type Permiso } from "@tortillerias/shared";
import { auditar, pool } from "../db.js";
import { cifrar, descifrar, hashBusqueda } from "../crypto.js";
import { alcanceDe, censadorVisible, enAlcanceSql, estadoPermitido, soloConEstado, tortilleriaVisible } from "../alcance.js";
import { ultimosPreciosSql } from "./admin-mapa.js";

const uuid = z.string().uuid();
/** Cada ruta pide al menos uno de estos permisos (un administrador los tiene todos) */
const con = (app: FastifyInstance, ...permisos: Permiso[]) => app.conPermiso(...permisos);

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
async function resolverCapturas(ids: string[], estatus: "validada" | "rechazada", usuarioId: string, alcance: string[] | null): Promise<number> {
  // solo lo que está dentro del alcance de quien revisa (un administrador estatal no toca precios de otro estado)
  const { rows } = await pool.query(
    `UPDATE capturas_precio SET estatus = $1, aprobacion = 'manual', revisado_por = $2, revisado_en = now()
      WHERE id = ANY($3::uuid[]) AND tortilleria_id IN (SELECT id FROM tortillerias WHERE ($4::text[] IS NULL OR estado_clave = ANY($4::text[]))) RETURNING id`,
    [estatus, usuarioId, ids, alcance],
  );
  if (!rows.length) return 0;
  const hechos = rows.map((r) => r.id as string);
  await pool.query("UPDATE alertas SET estatus = 'resuelta' WHERE captura_id = ANY($1::uuid[])", [hechos]);
  for (const id of hechos) await auditar(usuarioId, `captura_${estatus}`, "capturas_precio", id);
  return hechos.length;
}

export function rutasAdmin(app: FastifyInstance) {
  app.get("/admin/resumen", { preHandler: con(app, "ver_resumen") }, async () => {
    const HOY = "(now() AT TIME ZONE 'America/Mexico_City')::date";
    // Los promedios usan el último precio que CUENTA de cada tortillería en los últimos 30 días (una tortillería = un valor)
    const { rows } = await pool.query(
      `WITH ${ultimosPreciosSql("30")}
       SELECT
         (SELECT count(*)::int FROM usuarios WHERE rol = 'capturista') AS usuarios,
         (SELECT count(DISTINCT p.tortilleria_id)::int FROM precios_que_cuentan p WHERE p.origen_tortilleria = 'denue' AND p.operacion_tortilleria = 'activa') AS denue_visitadas,
         (SELECT count(*)::int FROM tortillerias WHERE origen = 'denue' AND operacion = 'activa') AS denue_total,
         (SELECT count(*)::int FROM tortillerias WHERE operacion = 'inactiva') AS dadas_de_baja,
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

  app.get("/admin/tortillerias", { preHandler: con(app, "ver_revision") }, async (req) => {
    const estatus = z.enum(["pendiente", "validada", "rechazada"]).optional().safeParse((req.query as any).estatus);
    const pg = paginar(req.query);
    const filtro = estatus.success ? estatus.data ?? null : null;
    // ?origen=nueva → solo las que dieron de alta los censadores; ?origen=denue → las del catálogo que ya tienen precio. Sin él, las dos (como antes).
    const origenQ = z.enum(["denue", "nueva"]).safeParse((req.query as any).origen);
    const origen = origenQ.success ? origenQ.data : null;
    // Buscar (nombre, municipio, estado o quien la dio de alta), con/sin foto y orden. Todo se valida contra una lista: nada del texto va al SQL.
    const qt = req.query as Record<string, string | undefined>;
    const texto = sinAcentos((typeof qt.q === "string" ? qt.q : "").trim().slice(0, 80));
    const foto = qt.foto === "con" || qt.foto === "sin" ? qt.foto : null;
    const ORDEN_T: Record<string, string> = {
      recientes: "t.creado_en DESC",
      antiguas: "t.creado_en ASC",
      nombre: `${SIN_ACENTOS_SQL("t.nombre")} ASC`, // sin acentos: "Álamo" va con la A y "Ñandú" con la N, no al final
      fotos: "(SELECT count(*) FROM fotos f WHERE f.tortilleria_id = t.id) DESC, t.creado_en DESC",
    };
    const orden = ORDEN_T[qt.orden ?? ""] ?? ORDEN_T.recientes;
    const UNIONES_T = `LEFT JOIN municipios m ON m.clave = t.municipio_clave LEFT JOIN estados e ON e.clave = t.estado_clave LEFT JOIN usuarios u ON u.id = t.creado_por`;
    const DONDE = `($1::text IS NULL OR t.estatus = $1)
          AND ($2::text IS NULL OR t.origen = $2)
          AND (t.origen <> 'denue' OR EXISTS (SELECT 1 FROM capturas_precio c WHERE c.tortilleria_id = t.id))
          AND ($3::text = '' OR ${SIN_ACENTOS_SQL("coalesce(t.nombre,'') || ' ' || coalesce(m.nombre,'') || ' ' || coalesce(e.nombre,'') || ' ' || coalesce(u.correo,'')")} LIKE '%' || $3 || '%')
          AND ($4::text IS NULL OR ($4 = 'con' AND EXISTS (SELECT 1 FROM fotos f WHERE f.tortilleria_id = t.id)) OR ($4 = 'sin' AND NOT EXISTS (SELECT 1 FROM fotos f WHERE f.tortilleria_id = t.id)))
          AND ${enAlcanceSql("t.estado_clave", 5)}`;
    const { rows } = await pool.query(
      `SELECT t.id, t.nombre, t.domicilio, t.estatus, t.origen, t.creado_en,
              ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng,
              m.nombre AS municipio, e.nombre AS estado, u.correo AS creador, (u.estado_cuenta = 'rechazado') AS creador_rechazado,
              t.localidad, t.tipo_vial, t.calle, t.numero_ext, t.numero_int, t.colonia, t.codigo_postal, t.telefono, t.correo,
              t.personal_ocupado, t.codigo_scian, t.fecha_alta,
              (SELECT count(*)::int FROM fotos f WHERE f.tortilleria_id = t.id) AS n_fotos,
              (EXISTS (SELECT 1 FROM tortilleria_fiscal x WHERE x.tortilleria_id = t.id)
               OR EXISTS (SELECT 1 FROM responsables r WHERE r.tortilleria_id = t.id)) AS tiene_fiscal
         FROM tortillerias t
         ${UNIONES_T}
        WHERE ${DONDE}
        ORDER BY ${orden}, t.id${pg ? " LIMIT $6 OFFSET $7" : ""}`,
      pg ? [filtro, origen, texto, foto, alcanceDe(req), pg.limite, (pg.pagina - 1) * pg.limite] : [filtro, origen, texto, foto, alcanceDe(req)],
    );
    if (!pg) return rows;
    const { rows: [c] } = await pool.query(`SELECT count(*)::int AS n FROM tortillerias t ${UNIONES_T} WHERE ${DONDE}`, [filtro, origen, texto, foto, alcanceDe(req)]);
    return respuestaPaginada(rows, c.n, pg);
  });

  app.get<{ Params: { id: string } }>("/admin/tortillerias/:id/fotos", { preHandler: con(app, "ver_revision", "ver_mapa") }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    if (!(await tortilleriaVisible(req, req.params.id))) return reply.code(404).send({ error: "No existe" });
    const { rows } = await pool.query("SELECT id FROM fotos WHERE tortilleria_id = $1 ORDER BY fecha DESC", [req.params.id]);
    return rows;
  });

  app.get("/admin/capturas", { preHandler: con(app, "ver_revision", "ver_mapa") }, async (req, reply) => {
    const q = req.query as { estatus?: string; alertas?: string; tortilleria?: string; producto?: string; q?: string; orden?: string };
    const estatus = z.enum(["pendiente", "validada", "rechazada"]).safeParse(q.estatus);
    const tortilleria = q.tortilleria ? uuid.safeParse(q.tortilleria) : null;
    if (tortilleria && !tortilleria.success) return reply.code(400).send({ error: "Id inválido" });
    const pg = paginar(req.query);
    const producto = q.producto === "maiz" || q.producto === "masa" ? q.producto : null;
    const texto = sinAcentos((typeof q.q === "string" ? q.q : "").trim().slice(0, 80));
    const params = [estatus.success ? estatus.data : null, q.alertas === "1", tortilleria?.success ? tortilleria.data : null, producto, texto, alcanceDe(req)];
    const ORDEN_C: Record<string, string> = {
      recientes: "c.creado_en DESC",
      antiguas: "c.creado_en ASC",
      // qué tan lejos de la mediana del municipio (en %): primero los más raros
      diferencia: "abs(c.precio_kg - c.mediana_ref) / nullif(c.mediana_ref, 0) DESC NULLS LAST, c.creado_en DESC",
      precio_alto: "c.precio_kg DESC, c.creado_en DESC",
      precio_bajo: "c.precio_kg ASC, c.creado_en DESC",
    };
    const orden = tortilleria ? "c.creado_en DESC" : ORDEN_C[q.orden ?? ""] ?? "c.alerta DESC, c.creado_en DESC";
    const UNIONES_C = `JOIN tortillerias t ON t.id = c.tortilleria_id
         LEFT JOIN municipios m ON m.clave = t.municipio_clave
         LEFT JOIN estados e ON e.clave = t.estado_clave
         LEFT JOIN usuarios u ON u.id = c.capturista_id`;
    const DONDE = `($1::text IS NULL OR c.estatus = $1) AND ($2::boolean IS NOT TRUE OR c.alerta)
          AND ($3::uuid IS NULL OR c.tortilleria_id = $3) AND ($4::text IS NULL OR c.producto = $4)
          AND ($5::text = '' OR ${SIN_ACENTOS_SQL("coalesce(t.nombre,'') || ' ' || coalesce(m.nombre,'') || ' ' || coalesce(e.nombre,'') || ' ' || coalesce(u.correo,'')")} LIKE '%' || $5 || '%')
          AND ${enAlcanceSql("t.estado_clave", 6)}`;
    const { rows } = await pool.query(
      `SELECT c.id, c.producto, c.precio_kg, c.fecha, c.estatus, c.alerta, c.tortilleria_id,
              c.mediana_ref::float8 AS mediana_ref, c.n_ref, c.ref_elaboracion, c.aprobacion,
              c.precision_gps, ST_Y(c.geom_captura) AS captura_lat, ST_X(c.geom_captura) AS captura_lng,
              coalesce(c.capturado_en, c.creado_en) AS capturado_en,
              t.nombre, m.nombre AS municipio, e.nombre AS estado, u.correo AS capturista
         FROM capturas_precio c
         ${UNIONES_C}
        WHERE ${DONDE}
        ORDER BY ${orden}, c.id${pg ? " LIMIT $7 OFFSET $8" : tortilleria ? " LIMIT 100" : ""}`,
      pg ? [...params, pg.limite, (pg.pagina - 1) * pg.limite] : params,
    );
    if (!pg) return rows;
    const { rows: [c] } = await pool.query(`SELECT count(*)::int AS n FROM capturas_precio c ${UNIONES_C} WHERE ${DONDE}`, params);
    return respuestaPaginada(rows, c.n, pg);
  });

  app.patch<{ Params: { id: string } }>("/admin/capturas/:id", { preHandler: con(app, "revisar_precios") }, async (req, reply) => {
    const p = z.object({ estatus: z.enum(["validada", "rechazada"]) }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Datos inválidos" });
    const hechas = await resolverCapturas([req.params.id], p.data.estatus, req.user.sub, alcanceDe(req));
    if (!hechas) return reply.code(404).send({ error: "No existe" });
    return { ok: true };
  });

  // Aprobar o rechazar varios precios a la vez (máximo 200), con la misma lógica y auditoría que el individual
  app.patch("/admin/capturas", { preHandler: con(app, "revisar_precios") }, async (req, reply) => {
    const p = z.object({ ids: z.array(z.string().uuid()).min(1).max(200), estatus: z.enum(["validada", "rechazada"]) }).safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos (de 1 a 200 precios)" });
    const ids = [...new Set(p.data.ids)];
    const hechas = await resolverCapturas(ids, p.data.estatus, req.user.sub, alcanceDe(req));
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
  app.get("/admin/exportar/capturas", { preHandler: con(app, "exportar_capturas"), config: { rateLimit: { max: process.env.NODE_ENV === "test" ? 1000 : 10, timeWindow: "1 minute" } } }, async (req, reply) => {
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
              c.producto, c.precio_kg::float8 AS precio_kg, c.estatus, c.alerta AS atipico, c.mediana_ref::float8 AS mediana_ref, c.ref_elaboracion, c.aprobacion,
              t.elaboracion, t.operacion,
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
      "id_captura", "fecha", "hora_captura", "producto", "precio_kg", "estatus", "atipico", "mediana_ref", "ref_elaboracion", "aprobacion", "id_tortilleria", "id_denue", "origen",
      "estatus_tortilleria", "nombre_tortilleria", "domicilio", "estado", "municipio", "lat", "lng", "tiene_datos_fiscales", "ultimo_motivo_sin_fiscal",
      "censador_correo", "gps_lat", "gps_lng", "precision_gps", "elaboracion", "operacion",
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
            [r.id, r.fecha, r.hora, r.producto, r.precio_kg, r.estatus, r.atipico, r.mediana_ref, r.ref_elaboracion, r.aprobacion, r.id_tortilleria, r.id_denue, r.origen, r.estatus_tortilleria,
              r.nombre, r.domicilio, r.estado, r.municipio, r.lat, r.lng, r.tiene_fiscal, r.ultimo_motivo, r.censador, r.gps_lat, r.gps_lng, r.precision_gps, r.elaboracion, r.operacion].map(celda).join(","),
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
  // ?tipo=app → los de la app (capturistas; los ve quien tenga "Usuarios de la app"); ?tipo=personal → las cuentas del administrador (solo un administrador).
  app.get("/admin/usuarios", { preHandler: con(app, "ver_usuarios_app") }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const tipo = q.tipo === "app" || q.tipo === "personal" ? q.tipo : null;
    if (tipo !== "app" && req.user.rol !== "admin") return reply.code(403).send({ error: "Sin permiso" });
    const pg = paginar(req.query);
    const rol = z.enum(["capturista", "supervisor", "admin", "estatal"]).safeParse(q.rol);
    const activo = q.activo === "1" || q.activo === "true" ? true : q.activo === "0" || q.activo === "false" ? false : null;
    const texto = sinAcentos((typeof q.q === "string" ? q.q : "").trim().slice(0, 80));
    // Pestañas de las solicitudes (todo contra una lista): estado de la cuenta y "registro abierto" por confirmar
    const cuenta = q.cuenta === "por_autorizar" || q.cuenta === "autorizado" || q.cuenta === "rechazado" ? q.cuenta : null;
    const abierto = q.registro_abierto === "1";
    const estadoQ = q.estado && /^\d{2}$/.test(q.estado) ? q.estado : null; // filtro de estado (dentro del alcance)
    // Buscar por CURP: es exacta (se guarda cifrada); si lo escrito es una CURP completa se compara su huella
    const curpBuscada = curpSchema.safeParse(q.q ?? "");
    const curpHash = curpBuscada.success ? hashBusqueda(curpBuscada.data) : null;
    // Orden y actividad (de la app): solo valores de una lista, nada del texto va al SQL
    const ULTIMA = "(SELECT max(coalesce(c.capturado_en, c.creado_en)) FROM capturas_precio c WHERE c.capturista_id = u.id)";
    const ORDEN_U: Record<string, string> = {
      recientes: "u.creado_en DESC",
      antiguos: "u.creado_en ASC",
      nombre: `${SIN_ACENTOS_SQL("coalesce(nullif(u.nombre,''), u.correo, u.usuario)")} ASC, ${SIN_ACENTOS_SQL("u.apellidos")} ASC`,
      capturas: "(SELECT count(*) FROM capturas_precio c WHERE c.capturista_id = u.id) DESC, u.creado_en DESC",
      ultima: `${ULTIMA} DESC NULLS LAST, u.creado_en DESC`,
    };
    const orden = ORDEN_U[q.orden ?? ""] ?? ORDEN_U.recientes;
    const HOY7 = "(now() AT TIME ZONE 'America/Mexico_City')::date - 6";
    const ACTIVIDAD: Record<string, string> = {
      activos7: `EXISTS (SELECT 1 FROM capturas_precio c WHERE c.capturista_id = u.id AND c.fecha >= ${HOY7})`,
      sin7: `EXISTS (SELECT 1 FROM capturas_precio c WHERE c.capturista_id = u.id) AND NOT EXISTS (SELECT 1 FROM capturas_precio c WHERE c.capturista_id = u.id AND c.fecha >= ${HOY7})`,
      nunca: "NOT EXISTS (SELECT 1 FROM capturas_precio c WHERE c.capturista_id = u.id)",
    };
    const actividad = ACTIVIDAD[q.actividad ?? ""] ?? "true";
    // El administrador estatal solo ve a los censadores de SU estado (el estado del censador); sin estado, solo los ve quien no tiene límite
    const DONDE = `($1::text IS NULL OR u.rol = $1) AND ($2::boolean IS NULL OR u.activo = $2) AND (${actividad})
          AND (${tipo === "app" ? "u.rol = 'capturista'" : tipo === "personal" ? "u.rol IN ('supervisor','admin','estatal')" : "true"})
          AND ($3::text = '' OR ${SIN_ACENTOS_SQL("coalesce(u.correo,'') || ' ' || coalesce(u.usuario,'') || ' ' || coalesce(u.nombre,'') || ' ' || coalesce(u.apellidos,'')")} LIKE '%' || $3 || '%'
               OR ($4::text IS NOT NULL AND u.curp_hash = $4))
          AND ($5::text IS NULL OR u.estado_cuenta = $5) AND ($6::boolean IS NOT TRUE OR u.registro_abierto)
          AND ${enAlcanceSql("u.estado_clave", 7)} AND ($8::text IS NULL OR u.estado_clave = $8) AND ($9::boolean IS NOT TRUE OR u.estado_clave IS NOT NULL)`;
    const params = [rol.success ? rol.data : null, activo, texto, curpHash, cuenta, abierto, alcanceDe(req), estadoQ, soloConEstado(req)];
    const { rows } = await pool.query(
      `SELECT u.id, u.correo, u.usuario, u.nombre, u.apellidos, u.rol, u.activo, u.creado_en, u.debe_cambiar_password, u.permisos,
              u.estado_cuenta, u.registro_abierto, u.datos_completos, u.estado_clave, u.estado_sugerido, es.nombre AS estado, u.curp_cifrado,
              u.estados_alcance, u.alcance_nacional, u.programa,
              (SELECT count(*)::int FROM capturas_precio c WHERE c.capturista_id = u.id) AS capturas,
              (SELECT to_char(max(coalesce(c.capturado_en, c.creado_en)) AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') FROM capturas_precio c WHERE c.capturista_id = u.id) AS ultima_captura,
              (SELECT count(*)::int FROM capturas_precio c WHERE c.capturista_id = u.id AND c.fecha >= (now() AT TIME ZONE 'America/Mexico_City')::date - 6) AS capturas_7d
         FROM usuarios u LEFT JOIN estados es ON es.clave = u.estado_clave WHERE ${DONDE}
        ORDER BY ${orden}, u.id${pg ? " LIMIT $10 OFFSET $11" : ""}`,
      pg ? [...params, pg.limite, (pg.pagina - 1) * pg.limite] : params,
    );
    // permisos = los marcados (NULL = los de por omisión); permisos_efectivos = con los que de verdad cuenta la cuenta. La CURP sale enmascarada, nunca completa.
    const filas = rows.map(({ curp_cifrado, ...r }: any) => {
      let curp = "";
      try { curp = curp_cifrado ? enmascararCurp(descifrar(curp_cifrado)) : ""; } catch { curp = ""; }
      return { ...r, curp, permisos_efectivos: permisosEfectivos(r.rol, r.permisos, r.alcance_nacional === true) };
    });
    if (!pg) return filas;
    const { rows: [c] } = await pool.query(`SELECT count(*)::int AS n FROM usuarios u WHERE ${DONDE}`, params);
    return respuestaPaginada(filas, c.n, pg);
  });

  // Cuántos hay en cada pestaña de Usuarios (dentro del alcance), para los números de las pestañas
  app.get("/admin/usuarios/conteo", { preHandler: con(app, "ver_usuarios_app") }, async (req) => {
    const { rows: [c] } = await pool.query(
      `SELECT count(*) FILTER (WHERE u.estado_cuenta = 'por_autorizar' AND u.activo)::int AS por_autorizar,
              count(*) FILTER (WHERE u.registro_abierto AND u.estado_cuenta = 'autorizado' AND u.activo)::int AS registro_abierto,
              count(*) FILTER (WHERE u.estado_cuenta = 'autorizado' AND u.activo)::int AS autorizados,
              count(*) FILTER (WHERE u.estado_cuenta = 'rechazado')::int AS rechazados,
              count(*) FILTER (WHERE NOT u.activo)::int AS desactivados
         FROM usuarios u WHERE u.rol = 'capturista' AND ${enAlcanceSql("u.estado_clave", 1)} AND ($2::boolean IS NOT TRUE OR u.estado_clave IS NOT NULL)`,
      [alcanceDe(req), soloConEstado(req)],
    );
    return c;
  });

  // La CURP completa solo se ve en el detalle, solo por un administrador, y queda en la bitácora
  app.get<{ Params: { id: string } }>("/admin/usuarios/:id/curp", { preHandler: app.soloRoles("admin") }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows: [u] } = await pool.query("SELECT curp_cifrado FROM usuarios WHERE id = $1", [req.params.id]);
    if (!u) return reply.code(404).send({ error: "No existe" });
    await auditar(req.user.sub, "ver_curp", "usuarios", req.params.id);
    return { curp: u.curp_cifrado ? descifrar(u.curp_cifrado) : null };
  });

  // Alta de un censador por un administrador estatal (o por DGTIC): queda autorizado y con los datos completos; la contraseña temporal se muestra UNA vez
  app.post("/admin/usuarios-app", { preHandler: con(app, "gestionar_usuarios_app"), config: { rateLimit: { max: 60, timeWindow: "1 hour" } } }, async (req, reply) => {
    const p = censadorNuevoSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message, detalle: p.error.flatten() });
    const d = p.data;
    if (!estadoPermitido(req, d.estadoClave)) return reply.code(403).send({ error: "Ese estado está fuera de tu alcance" });
    if (!(await pool.query("SELECT 1 FROM estados WHERE clave = $1", [d.estadoClave])).rowCount) return reply.code(400).send({ error: "Elige el estado" });
    if ((await pool.query("SELECT 1 FROM usuarios WHERE lower(correo) = $1 OR lower(usuario) = $1", [d.correo])).rowCount) return reply.code(409).send({ error: "Ya existe una cuenta con ese correo" });
    const curpHash = hashBusqueda(d.curp);
    if ((await pool.query("SELECT 1 FROM usuarios WHERE curp_hash = $1", [curpHash])).rowCount) return reply.code(409).send({ error: "Ya hay una cuenta con esta CURP" });
    const temporal = passwordTemporal();
    try {
      const { rows } = await pool.query(
        `INSERT INTO usuarios(usuario, correo, nombre, apellidos, apellido_paterno, apellido_materno, password_hash, rol, debe_cambiar_password, curp_cifrado, curp_hash, estado_clave,
                              estado_cuenta, datos_completos, autorizado_por, autorizado_en, creado_por)
         VALUES ($1,$1,$2,$3,$4,$5,$6,'capturista',true,$7,$8,$9,'autorizado',true,$10,now(),$10) RETURNING id`,
        [d.correo, d.nombre, `${d.apellidoPaterno} ${d.apellidoMaterno}`, d.apellidoPaterno, d.apellidoMaterno, await hash(temporal), cifrar(d.curp), curpHash, d.estadoClave, req.user.sub],
      );
      await auditar(req.user.sub, "crear_censador", "usuarios", rows[0].id);
      return reply.code(201).send({ id: rows[0].id, correo: d.correo, password: temporal });
    } catch (e: any) {
      if (e.code === "23505") return reply.code(409).send({ error: /curp/i.test(e.constraint ?? e.detail ?? "") ? "Ya hay una cuenta con esta CURP" : "Ya existe una cuenta con ese correo" });
      throw e;
    }
  });

  // Editar una cuenta. Los usuarios de la app (capturistas) solo se activan o desactivan; sus cuentas NO pasan al administrador.
  // Las cuentas del administrador (personal) las edita solo un administrador: rol, permisos y activo.
  app.patch<{ Params: { id: string } }>("/admin/usuarios/:id", { preHandler: con(app, "gestionar_usuarios_app") }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const p = z
      .object({
        rol: z.enum(["supervisor", "admin"]).optional(),
        activo: z.boolean().optional(),
        permisos: z.array(z.string()).max(40).nullable().optional(),
        // Solicitudes de censadores: autorizar, rechazar (sus capturas dejan de contar) o confirmar el "registro abierto"
        accion: z.enum(["autorizar", "rechazar", "confirmar"]).optional(),
        estadoClave: z.string().regex(/^(0[1-9]|[12]\d|3[0-2])$/).optional(),
        // Solo un administrador y solo en cuentas de administrador estatal
        estadosAlcance: z.array(z.string().regex(/^(0[1-9]|[12]\d|3[0-2])$/)).max(32).optional(),
        alcanceNacional: z.boolean().optional(),
        programa: z.enum(["oref", "fertilizantes"]).nullable().optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!p.success || Object.values(p.data).every((v) => v === undefined)) return reply.code(400).send({ error: "Datos inválidos" });
    const { rows: [u] } = await pool.query("SELECT id, rol, activo, estado_clave, estado_cuenta FROM usuarios WHERE id = $1", [req.params.id]);
    if (!u) return reply.code(404).send({ error: "No existe" });

    if (u.rol === "capturista") {
      // Un administrador estatal solo toca a los censadores de su estado; lo demás responde 404 (no se revela que existe)
      if (!(await censadorVisible(req, req.params.id))) return reply.code(404).send({ error: "No existe" });
      if (p.data.rol !== undefined || p.data.permisos !== undefined || p.data.estadosAlcance !== undefined || p.data.alcanceNacional !== undefined || p.data.programa !== undefined)
        return reply.code(400).send({ error: "Los usuarios de la app no cambian de rol ni de permisos. Para dar acceso al administrador crea una cuenta del administrador." });
      if (p.data.estadoClave !== undefined) {
        if (!estadoPermitido(req, p.data.estadoClave)) return reply.code(403).send({ error: "Ese estado está fuera de tu alcance" });
        if (!(await pool.query("SELECT 1 FROM estados WHERE clave = $1", [p.data.estadoClave])).rowCount) return reply.code(400).send({ error: "Elige el estado" });
      }
      if (p.data.accion === "confirmar" && u.estado_cuenta === "rechazado") return reply.code(400).send({ error: "Primero autoriza la cuenta" });
      const nuevoCuenta = p.data.accion === "autorizar" ? "autorizado" : p.data.accion === "rechazar" ? "rechazado" : null;
      await pool.query(
        `UPDATE usuarios SET activo = COALESCE($1, activo),
                estado_cuenta = COALESCE($2, estado_cuenta),
                autorizado_por = CASE WHEN $2::text IS NOT NULL THEN $4::uuid ELSE autorizado_por END,
                autorizado_en = CASE WHEN $2::text IS NOT NULL THEN now() ELSE autorizado_en END,
                registro_abierto = CASE WHEN $3::boolean THEN false ELSE registro_abierto END,
                estado_clave = COALESCE($5, estado_clave),
                estado_sugerido = CASE WHEN $5::text IS NOT NULL THEN false ELSE estado_sugerido END
          WHERE id = $6`,
        [p.data.activo ?? null, nuevoCuenta, p.data.accion === "confirmar" || p.data.accion === "autorizar", req.user.sub, p.data.estadoClave ?? null, req.params.id],
      );
      // "confirmar" y "autorizar" cierran el registro abierto; "rechazar" no lo toca
      const hechos: string[] = [];
      if (p.data.activo !== undefined) hechos.push(p.data.activo ? "activar_usuario_app" : "desactivar_usuario_app");
      if (p.data.accion) hechos.push({ autorizar: "autorizar_usuario", rechazar: "rechazar_usuario", confirmar: "confirmar_registro_abierto" }[p.data.accion]);
      if (p.data.estadoClave !== undefined) hechos.push("cambiar_estado_usuario");
      for (const h of hechos) await auditar(req.user.sub, h, "usuarios", req.params.id);
      return { ok: true };
    }

    // cuenta del administrador (incluye a los administradores estatales): solo un administrador, y nunca la propia
    if (req.user.rol !== "admin") return reply.code(403).send({ error: "Solo un administrador edita las cuentas del administrador" });
    if (req.params.id === req.user.sub) return reply.code(400).send({ error: "No puedes cambiar tu propio rol, tus permisos ni desactivarte" });
    if (p.data.accion !== undefined || p.data.estadoClave !== undefined) return reply.code(400).send({ error: "Datos inválidos" });
    if (u.rol === "estatal") {
      // sus permisos son fijos: solo se cambian su alcance, su programa y si está activa
      if (p.data.rol !== undefined || p.data.permisos !== undefined) return reply.code(400).send({ error: "Los permisos de un administrador estatal son fijos" });
      if (p.data.estadosAlcance) {
        const { rows: ok } = await pool.query("SELECT clave FROM estados WHERE clave = ANY($1::text[])", [p.data.estadosAlcance]);
        if (ok.length !== new Set(p.data.estadosAlcance).size) return reply.code(400).send({ error: "Hay un estado que no existe" });
      }
      await pool.query(
        `UPDATE usuarios SET activo = COALESCE($1, activo), estados_alcance = COALESCE($2::text[], estados_alcance), alcance_nacional = COALESCE($3, alcance_nacional),
                programa = CASE WHEN $5::boolean THEN $4 ELSE programa END WHERE id = $6`,
        [p.data.activo ?? null, p.data.estadosAlcance ? [...new Set(p.data.estadosAlcance)] : null, p.data.alcanceNacional ?? null, p.data.programa ?? null, p.data.programa !== undefined, req.params.id],
      );
      await auditar(req.user.sub, "editar_estatal", "usuarios", req.params.id);
      return { ok: true };
    }
    if (p.data.estadosAlcance !== undefined || p.data.alcanceNacional !== undefined || p.data.programa !== undefined) return reply.code(400).send({ error: "Datos inválidos" });
    const nuevoRol: "supervisor" | "admin" = p.data.rol ?? u.rol;
    let permisos: string[] | null | undefined = p.data.permisos;
    if (permisos) {
      const invalidos = permisos.filter((c) => !esPermiso(c));
      if (invalidos.length) return reply.code(400).send({ error: `Permiso desconocido: ${invalidos[0]}` });
      permisos = [...new Set(permisos)];
      if (nuevoRol === "supervisor" && !permisos.some((c) => c.startsWith("ver_"))) return reply.code(400).send({ error: "Elige al menos una vista para que pueda entrar" });
    }
    // siempre debe quedar al menos un administrador activo
    const quitaAdmin = u.rol === "admin" && u.activo && (nuevoRol !== "admin" || p.data.activo === false);
    if (quitaAdmin) {
      const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin' AND activo AND id <> $1", [req.params.id]);
      if (!n) return reply.code(400).send({ error: "Debe quedar al menos un administrador activo" });
    }
    await pool.query(
      `UPDATE usuarios SET rol = $1, activo = COALESCE($2, activo),
              permisos = CASE WHEN $1 = 'admin' THEN NULL WHEN $4::boolean THEN $3::text[] ELSE permisos END
        WHERE id = $5`,
      [nuevoRol, p.data.activo ?? null, permisos ?? null, permisos !== undefined, req.params.id],
    );
    await auditar(req.user.sub, "editar_personal", "usuarios", req.params.id);
    return { ok: true };
  });

  // Alta de una cuenta del administrador (supervisor con permisos, o administrador). Solo un administrador.
  // La contraseña temporal la genera el sistema y se muestra UNA vez; la persona debe cambiarla al entrar.
  app.post("/admin/personal", { preHandler: app.soloRoles("admin"), config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply) => {
    const p = personalNuevoSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message, detalle: p.error.flatten() });
    const d = p.data;
    const invalidos = d.permisos.filter((c) => !esPermiso(c));
    if (invalidos.length) return reply.code(400).send({ error: `Permiso desconocido: ${invalidos[0]}` });
    const permisos = d.rol === "admin" ? null : [...new Set(d.permisos)];
    if (permisos && !permisos.some((c) => c.startsWith("ver_"))) return reply.code(400).send({ error: "Elige al menos una vista para que pueda entrar" });
    const existe = await pool.query("SELECT 1 FROM usuarios WHERE lower(correo) = $1 OR lower(usuario) = $1", [d.correo]);
    if (existe.rowCount) return reply.code(409).send({ error: "Ya existe una cuenta con ese correo" });
    const temporal = passwordTemporal();
    try {
      const { rows } = await pool.query(
        `INSERT INTO usuarios(usuario, correo, nombre, apellidos, password_hash, rol, debe_cambiar_password, permisos, creado_por)
         VALUES ($1,$1,$2,$3,$4,$5,true,$6::text[],$7) RETURNING id`,
        [d.correo, d.nombre, d.apellidos, await hash(temporal), d.rol, permisos, req.user.sub],
      );
      await auditar(req.user.sub, "crear_personal", "usuarios", rows[0].id);
      return reply.code(201).send({ id: rows[0].id, correo: d.correo, password: temporal, permisos_efectivos: permisosEfectivos(d.rol, permisos) });
    } catch (e: any) {
      if (e.code === "23505") return reply.code(409).send({ error: "Ya existe una cuenta con ese correo" });
      throw e;
    }
  });

  // Recuperar contraseña (sin correo): la administración genera una temporal que se muestra UNA vez; la persona debe cambiarla al entrar
  app.post<{ Params: { id: string } }>("/admin/usuarios/:id/restablecer-password", { preHandler: con(app, "gestionar_usuarios_app"), config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    if (req.params.id === req.user.sub) return reply.code(400).send({ error: "Para cambiar tu contraseña usa tu perfil" });
    const { rows: [objetivo] } = await pool.query("SELECT rol FROM usuarios WHERE id = $1", [req.params.id]);
    // un administrador estatal solo restablece la contraseña de los censadores de su estado (fuera de su alcance: 404)
    if (objetivo?.rol === "capturista" && !(await censadorVisible(req, req.params.id))) return reply.code(404).send({ error: "No existe" });
    if (objetivo && objetivo.rol !== "capturista" && req.user.rol !== "admin") return reply.code(403).send({ error: "Solo un administrador restablece la contraseña del personal" });
    const temporal = passwordTemporal();
    const r = await pool.query("UPDATE usuarios SET password_hash = $1, debe_cambiar_password = true WHERE id = $2", [await hash(temporal), req.params.id]);
    if (!r.rowCount) return reply.code(404).send({ error: "No existe" });
    await auditar(req.user.sub, "restablecer_password", "usuarios", req.params.id);
    return { password: temporal };
  });
}
