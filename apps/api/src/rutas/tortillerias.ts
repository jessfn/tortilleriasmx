import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { responsableSchema } from "@tortillerias/shared";
import { auditar, pool } from "../db.js";
import { cifrar, descifrar, enmascarar, hashBusqueda } from "../crypto.js";

const busquedaSchema = z.object({
  municipio: z.string().optional(),
  estado: z.string().optional(),
  q: z.string().trim().max(80).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

const nuevaSchema = z.object({
  nombre: z.string().trim().min(2).max(120),
  domicilio: z.string().trim().min(3).max(250),
  estadoClave: z.string().min(1),
  municipioClave: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const uuid = z.string().uuid();
const LIMITE_ESCRITURA = { rateLimit: { max: 20, timeWindow: "1 minute" } };

export function rutasTortillerias(app: FastifyInstance) {
  // Búsqueda pública por municipio, nombre y cercanía (solo datos no personales)
  app.get("/tortillerias", async (req, reply) => {
    const p = busquedaSchema.safeParse(req.query);
    if (!p.success) return reply.code(400).send({ error: "Parámetros inválidos" });
    const { municipio, estado, q, lat, lng } = p.data;
    const cercania = lat !== undefined && lng !== undefined;
    const { rows } = await pool.query(
      `SELECT id, nombre, domicilio, estatus, origen,
              ST_Y(geom) AS lat, ST_X(geom) AS lng,
              CASE WHEN $4::float8 IS NULL THEN NULL
                   ELSE ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint($5,$4),4326)::geography) END AS distancia_m
         FROM tortillerias
        WHERE ($1::text IS NULL OR municipio_clave = $1)
          AND ($2::text IS NULL OR estado_clave = $2)
          AND ($3::text IS NULL OR nombre ILIKE '%' || $3 || '%')
          AND estatus <> 'rechazada'
        ORDER BY distancia_m NULLS LAST, nombre
        LIMIT 50`,
      [municipio ?? null, estado ?? null, q ?? null, cercania ? lat : null, cercania ? lng : null],
    );
    return rows;
  });

  // Alta pública de tortillería nueva (queda pendiente de validación)
  app.post("/tortillerias", { config: LIMITE_ESCRITURA }, async (req, reply) => {
    const p = nuevaSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos", detalle: p.error.flatten() });
    const d = p.data;
    const punto = "ST_SetSRID(ST_MakePoint($1,$2),4326)";
    const cercanas = await pool.query(
      `SELECT id, nombre, domicilio FROM tortillerias
        WHERE ST_DWithin(geom::geography, ${punto}::geography, 50) AND lower(nombre) = lower($3)`,
      [d.lng, d.lat, d.nombre],
    );
    if (cercanas.rowCount) return reply.code(409).send({ error: "Posible duplicado", posibles: cercanas.rows });
    const { rows } = await pool.query(
      `INSERT INTO tortillerias(nombre, domicilio, estado_clave, municipio_clave, geom, origen, estatus)
       VALUES ($3,$4,$5,$6,${punto},'nueva','pendiente') RETURNING id`,
      [d.lng, d.lat, d.nombre, d.domicilio, d.estadoClave, d.municipioClave],
    );
    return reply.code(201).send({ id: rows[0].id, estatus: "pendiente" });
  });

  // Alta pública del responsable: datos personales cifrados
  app.post<{ Params: { id: string } }>("/tortillerias/:id/responsable", { config: LIMITE_ESCRITURA }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const body = req.body as { aceptoAviso?: boolean };
    if (body?.aceptoAviso !== true) return reply.code(400).send({ error: "Falta aceptar el aviso de privacidad" });
    const p = responsableSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos", detalle: p.error.flatten() });
    const r = p.data;
    const t = await pool.query("SELECT 1 FROM tortillerias WHERE id = $1", [req.params.id]);
    if (!t.rowCount) return reply.code(404).send({ error: "Tortillería no existe" });

    const hash = hashBusqueda(r.curp);
    const dup = await pool.query("SELECT id, tortilleria_id FROM responsables WHERE curp_hash = $1", [hash]);
    if (dup.rowCount) {
      // Mismo responsable en la misma tortillería: no se duplica (reintentos y capturas repetidas)
      if (dup.rows[0].tortilleria_id === req.params.id) return reply.code(200).send({ id: dup.rows[0].id });
      return reply.code(409).send({ error: "Estos datos ya están registrados en otra tortillería" });
    }
    const { rows } = await pool.query(
      `INSERT INTO responsables(tortilleria_id, nombre, apellidos, curp_cifrado, curp_hash, telefono_cifrado,
                                telefono_hash, tipo_persona, rfc_cifrado, rfc_hash, razon_social)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        req.params.id, r.nombre, r.apellidos, cifrar(r.curp), hash, cifrar(r.telefono),
        hashBusqueda(r.telefono), r.tipoPersona, cifrar(r.rfc), hashBusqueda(r.rfc), r.razonSocial ?? null,
      ],
    );
    await pool.query("INSERT INTO consentimientos(responsable_id, version) VALUES ($1,$2)", [rows[0].id, "v1"]);
    await auditar(null, "crear_responsable_publico", "responsables", rows[0].id);
    return reply.code(201).send({ id: rows[0].id });
  });

  // Lectura de datos personales: SOLO con sesión. Capturista enmascarado; supervisor y admin completos (con auditoría).
  app.get<{ Params: { id: string } }>("/tortillerias/:id/responsable", { preHandler: app.autenticar }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query("SELECT * FROM responsables WHERE tortilleria_id = $1 LIMIT 1", [req.params.id]);
    const r = rows[0];
    if (!r) return reply.code(404).send({ error: "Sin responsable" });
    const completo = req.user.rol !== "capturista";
    const [curp, tel, rfc] = [descifrar(r.curp_cifrado), descifrar(r.telefono_cifrado), descifrar(r.rfc_cifrado)];
    if (completo) await auditar(req.user.sub, "ver_datos_personales", "responsables", r.id);
    return {
      id: r.id, nombre: r.nombre, apellidos: r.apellidos, tipoPersona: r.tipo_persona, razonSocial: r.razon_social,
      curp: completo ? curp : enmascarar(curp), telefono: completo ? tel : enmascarar(tel), rfc: completo ? rfc : enmascarar(rfc),
    };
  });

  // Validación por supervisor
  app.patch<{ Params: { id: string } }>("/tortillerias/:id/estatus", { preHandler: app.soloRoles("supervisor", "admin") }, async (req, reply) => {
    const p = z.object({ estatus: z.enum(["validada", "rechazada"]) }).safeParse(req.body);
    if (!p.success || !uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Datos inválidos" });
    const r = await pool.query("UPDATE tortillerias SET estatus = $1 WHERE id = $2", [p.data.estatus, req.params.id]);
    if (!r.rowCount) return reply.code(404).send({ error: "No existe" });
    await auditar(req.user.sub, `tortilleria_${p.data.estatus}`, "tortillerias", req.params.id);
    return { ok: true };
  });
}
