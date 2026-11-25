import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bajaSchema, elaboracionSchema, fiscalSchema, nuevaTortilleriaSchema, sinFiscalSchema, sinFotoSchema } from "@tortillerias/shared";
import { auditar, pool } from "../db.js";
import { cifrar, descifrar, enmascarar, hashBusqueda } from "../crypto.js";
import { domicilioDe, type Fila } from "../denue.js";
import { MAX_CELDAS, tamanoCelda, zoomSchema } from "../celdas.js";
import { MAX_DIAS_ATRASO, TOLERANCIA_FUTURO_MS } from "./precios.js";
import { alcanceDe, tortilleriaVisible } from "../alcance.js";

const busquedaSchema = z.object({
  municipio: z.string().optional(),
  estado: z.string().optional(),
  q: z.string().trim().max(80).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  km: z.coerce.number().min(0.1).max(50).optional(),
  limite: z.coerce.number().int().min(1).max(10000).optional(),
});

/** bbox = "minLng,minLat,maxLng,maxLat" (lo visible en el mapa) */
const bboxSchema = z
  .string()
  .transform((s) => s.split(",").map(Number))
  .pipe(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .refine(([x1, y1, x2, y2]) => x1 < x2 && y1 < y2, "bbox inválido");

export const MAX_PUNTOS_MAPA = 5000;

/** Hora del teléfono: máximo 7 días atrás y solo se tolera el desajuste del reloj hacia el futuro. Devuelve la fecha, null (no vino) o el texto del error. */
function horaDeCaptura(valor?: string): Date | null | string {
  if (!valor) return null;
  const f = new Date(valor);
  const dif = Date.now() - f.getTime();
  if (dif < -TOLERANCIA_FUTURO_MS) return "La hora de captura está en el futuro. Revisa la hora de tu teléfono.";
  if (dif > MAX_DIAS_ATRASO * 24 * 3600 * 1000) return `La captura tiene más de ${MAX_DIAS_ATRASO} días y ya no se puede enviar`;
  return f;
}


const uuid = z.string().uuid();
const LIMITE_ESCRITURA = { rateLimit: { max: 60, timeWindow: "1 minute" } };

export function rutasTortillerias(app: FastifyInstance) {
  // Búsqueda pública por municipio, nombre o calle y cercanía (solo datos no personales). Con km devuelve TODAS las del radio.
  app.get("/tortillerias", async (req, reply) => {
    const p = busquedaSchema.safeParse(req.query);
    if (!p.success) return reply.code(400).send({ error: "Parámetros inválidos" });
    const { municipio, estado, q, lat, lng, km, limite } = p.data;
    const cercania = lat !== undefined && lng !== undefined;
    const radio = cercania && km ? km * 1000 : null;
    if (!radio && !municipio && !estado && (q?.length ?? 0) < 3) return [];
    // El rectángulo (&&) usa el índice espacial; ST_DWithin afina el círculo exacto. 1° de latitud ≈ 111 km.
    const grados = radio ? radio / 111000 / Math.cos(((lat ?? 0) * Math.PI) / 180) + 0.001 : null;
    const { rows } = await pool.query(
      `SELECT t.id, t.nombre, t.domicilio, t.estatus, t.elaboracion,
              ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng, d.razon_social,
              CASE WHEN $4::float8 IS NULL THEN NULL
                   ELSE ST_Distance(t.geom::geography, ST_SetSRID(ST_MakePoint($5,$4),4326)::geography) END AS distancia_m
         FROM tortillerias t
         LEFT JOIN denue_catalogo d ON d.id_denue = t.id_denue
        WHERE ($6::float8 IS NOT NULL OR $1::text IS NULL OR t.municipio_clave = $1)
          AND ($6::float8 IS NOT NULL OR $2::text IS NULL OR t.estado_clave = $2)
          AND ($6::float8 IS NULL OR (
                t.geom && ST_Expand(ST_SetSRID(ST_MakePoint($5,$4),4326), $7::float8)
                AND ST_DWithin(t.geom::geography, ST_SetSRID(ST_MakePoint($5,$4),4326)::geography, $6::float8)))
          AND ($3::text IS NULL OR t.nombre ILIKE '%' || $3 || '%' OR t.domicilio ILIKE '%' || $3 || '%')
          AND t.estatus <> 'rechazada' AND t.operacion = 'activa'
        ORDER BY distancia_m NULLS LAST, t.nombre
        LIMIT $8`,
      [municipio ?? null, estado ?? null, q ?? null, cercania ? lat : null, cercania ? lng : null, radio, grados, limite ?? 10000],
    );
    return rows;
  });

  // Tortillerías de lo que se ve en el mapa. Si el área tiene demasiadas, se pide acercarse.
  app.get("/tortillerias/mapa", async (req, reply) => {
    const b = bboxSchema.safeParse((req.query as any)?.bbox);
    if (!b.success) return reply.code(400).send({ error: "bbox inválido: minLng,minLat,maxLng,maxLat" });
    const [x1, y1, x2, y2] = b.data;
    const { rows } = await pool.query(
      `SELECT t.id, t.nombre, t.domicilio, t.estatus, t.elaboracion, ST_Y(t.geom) AS lat, ST_X(t.geom) AS lng, d.razon_social
         FROM tortillerias t
         LEFT JOIN denue_catalogo d ON d.id_denue = t.id_denue
        WHERE t.geom && ST_MakeEnvelope($1,$2,$3,$4,4326) AND t.estatus <> 'rechazada' AND t.operacion = 'activa'
        LIMIT $5`,
      [x1, y1, x2, y2, MAX_PUNTOS_MAPA + 1],
    );
    if (rows.length > MAX_PUNTOS_MAPA) return { demasiadas: true };
    return rows;
  });

  // Mapa a poco zoom: cuántas tortillerías hay en cada zona (celdas de una cuadrícula que depende del zoom)
  app.get("/tortillerias/mapa/celdas", async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const b = bboxSchema.safeParse(q.bbox);
    if (!b.success) return reply.code(400).send({ error: "bbox inválido: minLng,minLat,maxLng,maxLat" });
    const [x1, y1, x2, y2] = b.data;
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n, avg(ST_X(t.geom)) AS lng, avg(ST_Y(t.geom)) AS lat,
              min(ST_X(t.geom)) AS x1, min(ST_Y(t.geom)) AS y1, max(ST_X(t.geom)) AS x2, max(ST_Y(t.geom)) AS y2
         FROM tortillerias t
        WHERE t.geom && ST_MakeEnvelope($1,$2,$3,$4,4326) AND t.estatus <> 'rechazada' AND t.operacion = 'activa'
        GROUP BY floor(ST_X(t.geom) / $5::float8), floor(ST_Y(t.geom) / $5::float8)
        LIMIT $6`,
      [x1, y1, x2, y2, tamanoCelda(zoomSchema.parse(q.zoom)), MAX_CELDAS],
    );
    return rows.map((r) => ({ lat: r.lat, lng: r.lng, n: r.n, bbox: [r.x1, r.y1, r.x2, r.y2] }));
  });

  // Alta de tortillería nueva por un usuario registrado (queda pendiente de validación; la foto es obligatoria para validarla)
  app.post("/tortillerias", { preHandler: app.autenticarCaptura, config: LIMITE_ESCRITURA }, async (req, reply) => {
    const p = nuevaTortilleriaSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos", detalle: p.error.flatten() });
    const d = p.data;
    // Reintento de algo que ya llegó: se responde con la misma tortillería
    if (d.idCliente) {
      const ya = await pool.query("SELECT id, estatus FROM tortillerias WHERE id_cliente = $1", [d.idCliente]);
      if (ya.rowCount) return reply.code(200).send({ id: ya.rows[0].id, estatus: ya.rows[0].estatus, existente: true });
    }
    const punto = "ST_SetSRID(ST_MakePoint($1,$2),4326)";
    const cercanas = d.confirmoNoDuplicado ? { rowCount: 0, rows: [] } : await pool.query(
      `SELECT id, nombre, domicilio FROM tortillerias
        WHERE ST_DWithin(geom::geography, ${punto}::geography, 50) AND lower(nombre) = lower($3)`,
      [d.lng, d.lat, d.nombre],
    );
    if (cercanas.rowCount) return reply.code(409).send({ error: "Posible duplicado", posibles: cercanas.rows });

    // El domicilio se arma igual que el del DENUE para que la búsqueda por texto y las listas funcionen igual
    const domicilio = domicilioDe({
      tipo_vial: d.tipoVial, calle: d.calle, numero_ext: d.numeroExt, numero_int: d.numeroInt ?? "", colonia: d.colonia, codigo_postal: d.codigoPostal,
    } as Fila);

    const { rows } = await pool.query(
      `INSERT INTO tortillerias(nombre, domicilio, estado_clave, municipio_clave, geom, origen, estatus, creado_por,
                                localidad, tipo_vial, calle, numero_ext, numero_int, colonia, codigo_postal, telefono, correo,
                                personal_ocupado, codigo_scian, fecha_alta, id_cliente, elaboracion, elaboracion_actualizada_en)
       VALUES ($3,$4,$5,$6,${punto},'nueva','pendiente',$7,
               $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'311830', to_char(now() AT TIME ZONE 'America/Mexico_City', 'YYYY-MM'), $18, $19, now())
       RETURNING id`,
      [
        d.lng, d.lat, d.nombre, domicilio, d.estadoClave, d.municipioClave, req.user.sub,
        d.localidad, d.tipoVial, d.calle, d.numeroExt, d.numeroInt ?? null, d.colonia, d.codigoPostal, d.telefono ?? null, d.correo ?? null,
        d.personalOcupado, d.idCliente ?? null, d.elaboracion,
      ],
    );
    await pool.query("INSERT INTO tortilleria_elaboracion(tortilleria_id, capturista_id, elaboracion) VALUES ($1,$2,$3)", [rows[0].id, req.user.sub, d.elaboracion]);
    await auditar(req.user.sub, d.confirmoNoDuplicado ? "crear_tortilleria_confirmada" : "crear_tortilleria", "tortillerias", rows[0].id);
    return reply.code(201).send({ id: rows[0].id, estatus: "pendiente" });
  });

  /* ------------------------------------------------------------------ datos fiscales (de la tortillería) */

  // ¿Ya tiene datos fiscales? También cuenta el registro viejo de `responsables`.
  // Es público a propósito: solo responde sí/no, y quien todavía no tiene cuenta (se crea al final del asistente)
  // necesita saberlo para que el asistente le pida o no los datos fiscales.
  app.get<{ Params: { id: string } }>("/tortillerias/:id/fiscal/existe", async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query(
      `SELECT (EXISTS (SELECT 1 FROM tortilleria_fiscal WHERE tortilleria_id = $1)
            OR EXISTS (SELECT 1 FROM responsables WHERE tortilleria_id = $1)) AS tiene`,
      [req.params.id],
    );
    // Último intento fallido: solo la clave del motivo y la fecha (el texto de "Otro motivo" no sale en un endpoint público)
    const n = await pool.query(
      `SELECT motivo, to_char(creado_en AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD') AS fecha
         FROM fiscal_negativas WHERE tortilleria_id = $1 ORDER BY creado_en DESC LIMIT 1`,
      [req.params.id],
    );
    // ¿Ya tiene foto? La primera visita a una tortillería que ya existe debe traerla (o el motivo de por qué no se pudo)
    const f = await pool.query("SELECT EXISTS (SELECT 1 FROM fotos WHERE tortilleria_id = $1) AS tiene_foto", [req.params.id]);
    // el tipo de elaboración (para preseleccionarlo) y si ya se dio de baja
    const o = await pool.query("SELECT elaboracion, operacion FROM tortillerias WHERE id = $1", [req.params.id]);
    // C21: solo el estatus del cuestionario (para decidir si el asistente lo pide), nunca respuestas
    const k = await pool.query(
      `SELECT coalesce(
         (SELECT json_build_object('estatus', 'aplicado', 'fecha', to_char(coalesce(v.capturado_en, v.creado_en) AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD')) FROM cuestionario_vigente v WHERE v.tortilleria_id = $1),
         (SELECT json_build_object('estatus', u.estatus, 'fecha', to_char(u.fecha AT TIME ZONE 'America/Mexico_City', 'YYYY-MM-DD'), 'motivo', u.motivo_no_aplica) FROM cuestionario_ultimo u WHERE u.tortilleria_id = $1)
       ) AS c`,
      [req.params.id],
    );
    return {
      tiene: !!rows[0]?.tiene, ultimaNegativa: n.rows[0] ? { motivo: n.rows[0].motivo, fecha: n.rows[0].fecha } : null, tieneFoto: !!f.rows[0]?.tiene_foto,
      elaboracion: o.rows[0]?.elaboracion ?? null, inactiva: o.rows[0]?.operacion === "inactiva", cuestionario: k.rows[0]?.c ?? null,
    };
  });

  // "No se pudo tomar la foto" de una tortillería que ya existe: queda el motivo (una fila por intento). Nunca bloquea el precio.
  app.post<{ Params: { id: string } }>("/tortillerias/:id/foto/negativa", { preHandler: app.autenticarCaptura, config: LIMITE_ESCRITURA }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const p = sinFotoSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos", detalle: p.error.flatten() });
    const d = p.data;
    if (d.idCliente) {
      const ya = await pool.query("SELECT id FROM foto_negativas WHERE id_cliente = $1", [d.idCliente]);
      if (ya.rowCount) return reply.code(200).send({ id: ya.rows[0].id, existente: true });
    }
    let capturadoEn: Date | null = null;
    if (d.capturadoEn) {
      capturadoEn = new Date(d.capturadoEn);
      const dif = Date.now() - capturadoEn.getTime();
      if (dif < -TOLERANCIA_FUTURO_MS) return reply.code(400).send({ error: "La hora de captura está en el futuro. Revisa la hora de tu teléfono." });
      if (dif > MAX_DIAS_ATRASO * 24 * 3600 * 1000) return reply.code(400).send({ error: `La captura tiene más de ${MAX_DIAS_ATRASO} días y ya no se puede enviar` });
    }
    const t = await pool.query("SELECT 1 FROM tortillerias WHERE id = $1", [req.params.id]);
    if (!t.rowCount) return reply.code(404).send({ error: "Tortillería no existe" });
    // Otro censador subió la foto mientras este no tenía señal: no es error, ya no hace falta
    const tiene = await pool.query("SELECT EXISTS (SELECT 1 FROM fotos WHERE tortilleria_id = $1) AS tiene", [req.params.id]);
    if (tiene.rows[0]?.tiene) return reply.code(200).send({ yaTenia: true });
    const ins = await pool.query(
      `INSERT INTO foto_negativas(tortilleria_id, capturista_id, motivo, motivo_otro, capturado_en, id_cliente)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id_cliente) DO NOTHING RETURNING id`,
      [req.params.id, req.user.sub, d.motivo, d.motivo === "otro" ? d.motivoOtro : null, capturadoEn ? capturadoEn.toISOString() : null, d.idCliente ?? null],
    );
    if (!ins.rowCount) {
      const ya = await pool.query("SELECT id FROM foto_negativas WHERE id_cliente = $1", [d.idCliente]);
      return reply.code(200).send({ id: ya.rows[0].id, existente: true });
    }
    await auditar(req.user.sub, "foto_negativa", "foto_negativas", ins.rows[0].id);
    return reply.code(201).send({ id: ins.rows[0].id });
  });

  /* ------------------------------------------------------------------ tipo de elaboración (C19.2) */

  // Se envía ANTES que los precios del paquete (así la comparación del precio atípico ya usa el tipo correcto). Queda el historial;
  // el valor vigente solo cambia si este registro es más reciente que el vigente (un paquete sin conexión enviado tarde no pisa algo más nuevo).
  app.post<{ Params: { id: string } }>("/tortillerias/:id/elaboracion", { preHandler: app.autenticarCaptura, config: LIMITE_ESCRITURA }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const p = elaboracionSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos", detalle: p.error.flatten() });
    const d = p.data;
    if (d.idCliente) {
      const ya = await pool.query("SELECT id FROM tortilleria_elaboracion WHERE id_cliente = $1", [d.idCliente]);
      if (ya.rowCount) return reply.code(200).send({ id: ya.rows[0].id, existente: true });
    }
    const hora = horaDeCaptura(d.capturadoEn);
    if (typeof hora === "string") return reply.code(400).send({ error: hora });
    const t = await pool.query("SELECT 1 FROM tortillerias WHERE id = $1 AND estatus <> 'rechazada'", [req.params.id]);
    if (!t.rowCount) return reply.code(404).send({ error: "Tortillería no existe" });
    let id: string;
    try {
      const ins = await pool.query(
        "INSERT INTO tortilleria_elaboracion(tortilleria_id, capturista_id, elaboracion, capturado_en, id_cliente) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [req.params.id, req.user.sub, d.elaboracion, hora ? hora.toISOString() : null, d.idCliente ?? null],
      );
      id = ins.rows[0].id;
    } catch (e: any) {
      if (e?.code === "23505" && d.idCliente) {
        const ya = await pool.query("SELECT id FROM tortilleria_elaboracion WHERE id_cliente = $1", [d.idCliente]);
        return reply.code(200).send({ id: ya.rows[0].id, existente: true });
      }
      throw e;
    }
    const cuando = hora ? hora.toISOString() : new Date().toISOString();
    const vigente = await pool.query(
      `UPDATE tortillerias SET elaboracion = $2, elaboracion_actualizada_en = $3::timestamptz
        WHERE id = $1 AND (elaboracion_actualizada_en IS NULL OR elaboracion_actualizada_en < $3::timestamptz) RETURNING id`,
      [req.params.id, d.elaboracion, cuando],
    );
    await auditar(req.user.sub, "registrar_elaboracion", "tortilleria_elaboracion", id);
    return reply.code(201).send({ id, vigente: !!vigente.rowCount });
  });

  /* ------------------------------------------------------------------ "ya no funciona" (C19.1) */

  // Un solo reporte basta: la tortillería queda inactiva en seguida (el cambio y el reporte van en la misma sentencia). No se captura precio ni se pide foto.
  app.post<{ Params: { id: string } }>("/tortillerias/:id/baja", { preHandler: app.autenticarCaptura, config: LIMITE_ESCRITURA }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const p = bajaSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos", detalle: p.error.flatten() });
    const d = p.data;
    if (d.idCliente) {
      const ya = await pool.query("SELECT id FROM tortilleria_bajas WHERE id_cliente = $1", [d.idCliente]);
      if (ya.rowCount) return reply.code(200).send({ id: ya.rows[0].id, existente: true });
    }
    const hora = horaDeCaptura(d.capturadoEn);
    if (typeof hora === "string") return reply.code(400).send({ error: hora });
    const t = await pool.query("SELECT operacion FROM tortillerias WHERE id = $1 AND estatus <> 'rechazada'", [req.params.id]);
    if (!t.rowCount) return reply.code(404).send({ error: "Tortillería no existe" });
    if (t.rows[0].operacion === "inactiva") return reply.code(200).send({ yaInactiva: true });
    const conGps = d.lat !== undefined && d.lng !== undefined;
    let id: string | undefined;
    try {
      const ins = await pool.query(
        `WITH cambio AS (UPDATE tortillerias SET operacion = 'inactiva', operacion_cambiada_en = now() WHERE id = $1 AND operacion = 'activa' RETURNING id)
         INSERT INTO tortilleria_bajas(tortilleria_id, capturista_id, motivo, motivo_otro, geom_captura, precision_gps, capturado_en, id_cliente)
         SELECT $1, $2, $3, $4, CASE WHEN $5::float8 IS NULL OR $6::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($5,$6),4326) END, $7, $8, $9 FROM cambio
         RETURNING id`,
        [req.params.id, req.user.sub, d.motivo, d.motivo === "otro" ? d.motivoOtro : null, conGps ? d.lng : null, conGps ? d.lat : null, d.precisionGps ?? null, hora ? hora.toISOString() : null, d.idCliente ?? null],
      );
      id = ins.rows[0]?.id;
    } catch (e: any) {
      if (e?.code === "23505" && d.idCliente) {
        const ya = await pool.query("SELECT id FROM tortilleria_bajas WHERE id_cliente = $1", [d.idCliente]);
        return reply.code(200).send({ id: ya.rows[0]?.id, existente: true });
      }
      throw e;
    }
    if (!id) return reply.code(200).send({ yaInactiva: true }); // otro censador la dio de baja justo antes
    await auditar(req.user.sub, "reportar_baja", "tortilleria_bajas", id);
    return reply.code(201).send({ id });
  });

  // "No se obtuvieron los datos fiscales": queda el motivo (una fila por intento). Nunca bloquea el precio.
  app.post<{ Params: { id: string } }>("/tortillerias/:id/fiscal/negativa", { preHandler: app.autenticarCaptura, config: LIMITE_ESCRITURA }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const p = sinFiscalSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos", detalle: p.error.flatten() });
    const d = p.data;
    // Reintento de algo que ya llegó: se responde con el mismo registro
    if (d.idCliente) {
      const ya = await pool.query("SELECT id FROM fiscal_negativas WHERE id_cliente = $1", [d.idCliente]);
      if (ya.rowCount) return reply.code(200).send({ id: ya.rows[0].id, existente: true });
    }
    let capturadoEn: Date | null = null;
    if (d.capturadoEn) {
      capturadoEn = new Date(d.capturadoEn);
      const dif = Date.now() - capturadoEn.getTime();
      if (dif < -TOLERANCIA_FUTURO_MS) return reply.code(400).send({ error: "La hora de captura está en el futuro. Revisa la hora de tu teléfono." });
      if (dif > MAX_DIAS_ATRASO * 24 * 3600 * 1000) return reply.code(400).send({ error: `La captura tiene más de ${MAX_DIAS_ATRASO} días y ya no se puede enviar` });
    }
    const t = await pool.query("SELECT 1 FROM tortillerias WHERE id = $1", [req.params.id]);
    if (!t.rowCount) return reply.code(404).send({ error: "Tortillería no existe" });
    // Otro censador los capturó mientras este no tenía señal: no es error, simplemente ya no hace falta
    const tiene = await pool.query(
      `SELECT (EXISTS (SELECT 1 FROM tortilleria_fiscal WHERE tortilleria_id = $1) OR EXISTS (SELECT 1 FROM responsables WHERE tortilleria_id = $1)) AS tiene`,
      [req.params.id],
    );
    if (tiene.rows[0]?.tiene) return reply.code(200).send({ yaTenia: true });
    const ins = await pool.query(
      `INSERT INTO fiscal_negativas(tortilleria_id, capturista_id, motivo, motivo_otro, capturado_en, id_cliente)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id_cliente) DO NOTHING RETURNING id`,
      [req.params.id, req.user.sub, d.motivo, d.motivo === "otro" ? d.motivoOtro : null, capturadoEn ? capturadoEn.toISOString() : null, d.idCliente ?? null],
    );
    if (!ins.rowCount) {
      const ya = await pool.query("SELECT id FROM fiscal_negativas WHERE id_cliente = $1", [d.idCliente]);
      return reply.code(200).send({ id: ya.rows[0].id, existente: true });
    }
    await pool.query("UPDATE tortillerias SET actualizado_en = now() WHERE id = $1", [req.params.id]); // cambia la versión del catálogo del estado
    await auditar(req.user.sub, "fiscal_negativa", "fiscal_negativas", ins.rows[0].id);
    return reply.code(201).send({ id: ins.rows[0].id });
  });

  // Los crea una sola vez: si ya existen, no se sobrescriben (las correcciones las hace el admin)
  app.post<{ Params: { id: string } }>("/tortillerias/:id/fiscal", { preHandler: app.autenticarCaptura, config: LIMITE_ESCRITURA }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    if ((req.body as { aceptoAviso?: boolean })?.aceptoAviso !== true) return reply.code(400).send({ error: "Falta aceptar el aviso de privacidad" });
    const p = fiscalSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos", detalle: p.error.flatten() });
    const t = await pool.query("SELECT 1 FROM tortillerias WHERE id = $1", [req.params.id]);
    if (!t.rowCount) return reply.code(404).send({ error: "Tortillería no existe" });
    const f = p.data;

    const ins = await pool.query(
      `INSERT INTO tortilleria_fiscal(tortilleria_id, tipo_persona, rfc_cifrado, rfc_hash, razon_social, celular_cifrado, celular_hash, capturado_por)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8
        WHERE NOT EXISTS (SELECT 1 FROM responsables WHERE tortilleria_id = $1)
       ON CONFLICT (tortilleria_id) DO NOTHING
       RETURNING tortilleria_id`,
      [
        req.params.id, f.tipoPersona, cifrar(f.rfc), hashBusqueda(f.rfc), f.razonSocial,
        f.celular ? cifrar(f.celular) : null, f.celular ? hashBusqueda(f.celular) : null, req.user.sub,
      ],
    );
    if (ins.rowCount) {
      await pool.query("UPDATE tortillerias SET actualizado_en = now() WHERE id = $1", [req.params.id]);
      await pool.query("INSERT INTO consentimientos(tortilleria_id, usuario_id, version) VALUES ($1,$2,$3)", [req.params.id, req.user.sub, "v1"]);
      await auditar(req.user.sub, "crear_datos_fiscales", "tortilleria_fiscal", req.params.id);
      return reply.code(201).send({ tipoPersona: f.tipoPersona, razonSocial: f.razonSocial, rfc: enmascarar(f.rfc), celular: f.celular ? enmascarar(f.celular) : null, existente: false });
    }
    // Ya los tenía: se responde con lo que hay, enmascarado, sin sobrescribir
    const ya = await leerFiscal(req.params.id, false);
    return reply.code(200).send({ ...ya, existente: true });
  });

  // Lectura: capturista enmascarado; supervisor y admin completos (con auditoría)
  app.get<{ Params: { id: string } }>("/tortillerias/:id/fiscal", { preHandler: app.autenticar }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const completo = req.user.permisos.includes("ver_datos_fiscales"); // sin el permiso (o un usuario de la app) se ve enmascarado
    const r = await leerFiscal(req.params.id, completo);
    if (!r) return reply.code(404).send({ error: "Sin datos fiscales" });
    if (completo) await auditar(req.user.sub, "ver_datos_fiscales", "tortilleria_fiscal", req.params.id);
    return r;
  });

  // Registro viejo (antes de la revisión): solo lectura
  app.get<{ Params: { id: string } }>("/tortillerias/:id/responsable", { preHandler: app.autenticar }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query("SELECT * FROM responsables WHERE tortilleria_id = $1 LIMIT 1", [req.params.id]);
    const r = rows[0];
    if (!r) return reply.code(404).send({ error: "Sin responsable" });
    const completo = req.user.permisos.includes("ver_datos_fiscales");
    const [curp, tel, rfc] = [descifrar(r.curp_cifrado), descifrar(r.telefono_cifrado), descifrar(r.rfc_cifrado)];
    if (completo) await auditar(req.user.sub, "ver_datos_personales", "responsables", r.id);
    return {
      id: r.id, nombre: r.nombre, apellidos: r.apellidos, tipoPersona: r.tipo_persona, razonSocial: r.razon_social,
      curp: completo ? curp : enmascarar(curp), telefono: completo ? tel : enmascarar(tel), rfc: completo ? rfc : enmascarar(rfc),
    };
  });

  // Validación por supervisor. Una tortillería nueva no se valida sin foto.
  app.patch<{ Params: { id: string } }>("/tortillerias/:id/estatus", { preHandler: app.conPermiso("validar_tortillerias") }, async (req, reply) => {
    const p = z.object({ estatus: z.enum(["validada", "rechazada"]) }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Datos inválidos" });
    // un administrador estatal solo valida tortillerías de su estado (fuera de su alcance: 404)
    if (!(await tortilleriaVisible(req, req.params.id))) return reply.code(404).send({ error: "No existe" });
    if (p.data.estatus === "validada") {
      const t = await pool.query(
        `SELECT t.origen, (SELECT count(*) FROM fotos f WHERE f.tortilleria_id = t.id)::int AS fotos FROM tortillerias t WHERE t.id = $1`,
        [req.params.id],
      );
      if (!t.rowCount) return reply.code(404).send({ error: "No existe" });
      if (t.rows[0].origen === "nueva" && !t.rows[0].fotos) return reply.code(400).send({ error: "La tortillería no tiene foto" });
    }
    const r = await pool.query("UPDATE tortillerias SET estatus = $1 WHERE id = $2", [p.data.estatus, req.params.id]);
    if (!r.rowCount) return reply.code(404).send({ error: "No existe" });
    await auditar(req.user.sub, `tortilleria_${p.data.estatus}`, "tortillerias", req.params.id);
    return { ok: true };
  });
}

type FiscalSalida = {
  tipoPersona: string; razonSocial: string; rfc: string; celular: string | null; legado?: boolean; responsable?: { nombre: string; apellidos: string };
};

/** Datos fiscales de una tortillería: de `tortilleria_fiscal` o, si solo hay registro viejo, de `responsables` */
async function leerFiscal(id: string, completo: boolean): Promise<FiscalSalida | null> {
  const f = await pool.query("SELECT * FROM tortilleria_fiscal WHERE tortilleria_id = $1", [id]);
  if (f.rows[0]) {
    const r = f.rows[0];
    const rfc = descifrar(r.rfc_cifrado);
    const cel = r.celular_cifrado ? descifrar(r.celular_cifrado) : null;
    return { tipoPersona: r.tipo_persona, razonSocial: r.razon_social, rfc: completo ? rfc : enmascarar(rfc), celular: cel ? (completo ? cel : enmascarar(cel)) : null };
  }
  const v = await pool.query("SELECT * FROM responsables WHERE tortilleria_id = $1 LIMIT 1", [id]);
  if (v.rows[0]) {
    const r = v.rows[0];
    const rfc = descifrar(r.rfc_cifrado);
    const cel = r.telefono_cifrado ? descifrar(r.telefono_cifrado) : null;
    return {
      tipoPersona: r.tipo_persona, razonSocial: r.razon_social ?? `${r.nombre} ${r.apellidos}`, rfc: completo ? rfc : enmascarar(rfc),
      celular: cel ? (completo ? cel : enmascarar(cel)) : null, legado: true, responsable: { nombre: r.nombre, apellidos: r.apellidos },
    };
  }
  return null;
}
