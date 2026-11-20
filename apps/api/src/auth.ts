import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import { cambioPasswordSchema, completarDatosSchema, perfilSchema, permisosEfectivos, registroCensadorSchema, type Permiso } from "@tortillerias/shared";
import { auditar, pool } from "./db.js";
import { cifrar, hashBusqueda } from "./crypto.js";
import { leerCorte } from "./ajustes.js";

export type Rol = "capturista" | "supervisor" | "admin" | "estatal";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; rol: Rol };
    /** alcance: null = sin límite de estado; lista = solo esos estados (administrador estatal). estadoCuenta: por_autorizar | autorizado | rechazado */
    user: { sub: string; rol: Rol; permisos: Permiso[]; alcance: string[] | null; estadoCuenta: string };
  }
}
declare module "fastify" {
  interface FastifyInstance {
    autenticar: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    soloRoles: (...roles: Rol[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Personal del administrador con AL MENOS UNO de estos permisos (un administrador los tiene todos). Los usuarios de la app nunca pasan. */
    conPermiso: (...permisos: Permiso[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Igual que conPermiso, pero SOLO supervisor y administrador (nunca un administrador estatal): para lo que no tiene alcance por estado */
    conPermisoNacional: (...permisos: Permiso[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Con sesión Y cuenta autorizada: todo lo que captura (precios, tortillerías, datos fiscales, fotos, bajas, elaboración) */
    autenticarCaptura: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const loginSchema = z.object({ usuario: z.string().trim().min(1).max(120), password: z.string().min(1).max(200) });

export function registrarAuth(app: FastifyInstance) {
  // Verifica el token y confirma que la cuenta siga activa (una baja surte efecto de inmediato)
  const verificar = async (req: FastifyRequest, reply: FastifyReply, roles?: Rol[], permisos?: Permiso[]) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "No autenticado" });
    }
    const { rows } = await pool.query("SELECT rol, activo, permisos, estados_alcance, alcance_nacional, estado_cuenta FROM usuarios WHERE id = $1", [req.user.sub]);
    if (!rows[0] || !rows[0].activo) return reply.code(401).send({ error: "Cuenta desactivada" });
    req.user.rol = rows[0].rol; // el rol vigente manda sobre el del token
    req.user.permisos = permisosEfectivos(rows[0].rol, rows[0].permisos, rows[0].alcance_nacional === true); // y los permisos vigentes, también (un cambio surte efecto de inmediato)
    // Alcance por estado: solo el administrador estatal tiene límite (y el de alcance nacional, ninguno). Sin estados asignados no ve nada.
    req.user.alcance = rows[0].rol === "estatal" && rows[0].alcance_nacional !== true ? (rows[0].estados_alcance ?? []) : null;
    req.user.estadoCuenta = rows[0].estado_cuenta ?? "autorizado";
    if (roles && !roles.includes(req.user.rol)) return reply.code(403).send({ error: "Sin permiso" });
    if (permisos && !permisos.some((p) => req.user.permisos.includes(p))) return reply.code(403).send({ error: "Sin permiso" });
  };

  app.decorate("autenticar", (req: FastifyRequest, reply: FastifyReply) => verificar(req, reply));
  app.decorate("soloRoles", (...roles: Rol[]) => (req: FastifyRequest, reply: FastifyReply) => verificar(req, reply, roles));
  app.decorate("conPermiso", (...permisos: Permiso[]) => (req: FastifyRequest, reply: FastifyReply) => verificar(req, reply, ["supervisor", "admin", "estatal"], permisos));
  app.decorate("conPermisoNacional", (...permisos: Permiso[]) => (req: FastifyRequest, reply: FastifyReply) => verificar(req, reply, ["supervisor", "admin"], permisos));
  // Una cuenta por autorizar o rechazada NO captura: se valida aquí, en el servidor, no solo en la pantalla
  app.decorate("autenticarCaptura", async (req: FastifyRequest, reply: FastifyReply) => {
    await verificar(req, reply);
    if (reply.sent) return;
    if (req.user.estadoCuenta === "por_autorizar") return reply.code(403).send({ error: "cuenta_por_autorizar", mensaje: "Tu solicitud está en revisión. Te avisaremos cuando la autoricen." });
    if (req.user.estadoCuenta === "rechazado") return reply.code(403).send({ error: "cuenta_rechazada", mensaje: "Tu solicitud no fue autorizada." });
  });

  type FilaSesion = {
    id: string; nombre: string; apellidos: string; rol: Rol; correo: string | null; usuario: string; debe_cambiar_password?: boolean; permisos?: string[] | null;
    estado_cuenta?: string; datos_completos?: boolean; estado_clave?: string | null; estado_sugerido?: boolean; estados_alcance?: string[] | null;
    alcance_nacional?: boolean; programa?: string | null; apellido_paterno?: string | null; apellido_materno?: string | null;
  };
  const datosCuenta = (u: FilaSesion) => ({
    estadoCuenta: u.estado_cuenta ?? "autorizado",
    // los demás roles no pasan por "Completa tus datos"
    datosCompletos: u.rol === "capturista" ? u.datos_completos === true : true,
    estadoClave: u.estado_clave ?? null,
    estadoSugerido: u.estado_sugerido === true,
    apellidoPaterno: u.apellido_paterno ?? null,
    apellidoMaterno: u.apellido_materno ?? null,
    estadosAlcance: u.rol === "estatal" ? (u.estados_alcance ?? []) : null,
    alcanceNacional: u.rol === "estatal" && u.alcance_nacional === true,
    programa: u.programa ?? null,
  });
  const sesion = (u: FilaSesion) => ({
    token: app.jwt.sign({ sub: u.id, rol: u.rol }, { expiresIn: u.rol === "capturista" ? "7d" : "12h" }),
    usuario: {
      id: u.id, nombre: u.nombre, apellidos: u.apellidos, rol: u.rol, correo: u.correo ?? u.usuario, debeCambiarPassword: u.debe_cambiar_password === true,
      permisos: permisosEfectivos(u.rol, u.permisos, u.alcance_nacional === true), // qué pantallas y acciones tiene (solo el personal del administrador)
      ...datosCuenta(u),
    },
  });
  const COLUMNAS_SESION = `id, nombre, apellidos, rol, correo, usuario, debe_cambiar_password, permisos, estado_cuenta, datos_completos, estado_clave, estado_sugerido,
    estados_alcance, alcance_nacional, programa, apellido_paterno, apellido_materno`;

  // Crear cuenta de censador: datos personales, CURP (única, cifrada), estado y aviso de privacidad.
  // Antes de la fecha de corte la cuenta queda autorizada y con "registro abierto"; desde el corte queda por autorizar.
  app.post("/auth/registro", { config: { rateLimit: { max: process.env.NODE_ENV === "test" ? 1000 : 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const p = registroCensadorSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message, detalle: p.error.flatten() });
    const d = p.data;
    const existe = await pool.query("SELECT 1 FROM usuarios WHERE lower(correo) = $1 OR lower(usuario) = $1", [d.correo]);
    if (existe.rowCount) return reply.code(409).send({ error: "Ya existe una cuenta con ese correo" });
    const curpHash = hashBusqueda(d.curp);
    if ((await pool.query("SELECT 1 FROM usuarios WHERE curp_hash = $1", [curpHash])).rowCount) return reply.code(409).send({ error: "Ya hay una cuenta con esta CURP" });
    if (!(await pool.query("SELECT 1 FROM estados WHERE clave = $1", [d.estadoClave])).rowCount) return reply.code(400).send({ error: "Elige el estado" });
    const abierto = new Date() < (await leerCorte()); // la fecha se lee de la configuración en cada registro
    try {
      const { rows } = await pool.query(
        `INSERT INTO usuarios(usuario, correo, password_hash, rol, nombre, apellidos, apellido_paterno, apellido_materno, curp_cifrado, curp_hash, estado_clave,
                              estado_cuenta, registro_abierto, datos_completos)
         VALUES ($1,$1,$2,'capturista',$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
         RETURNING ${COLUMNAS_SESION}`,
        [d.correo, await hash(d.password), d.nombre, `${d.apellidoPaterno} ${d.apellidoMaterno}`, d.apellidoPaterno, d.apellidoMaterno, cifrar(d.curp), curpHash, d.estadoClave,
          abierto ? "autorizado" : "por_autorizar", abierto],
      );
      return reply.code(201).send(sesion(rows[0]));
    } catch (e: any) {
      if (e.code === "23505") return reply.code(409).send({ error: /curp/i.test(e.constraint ?? e.detail ?? "") ? "Ya hay una cuenta con esta CURP" : "Ya existe una cuenta con ese correo" });
      throw e;
    }
  });

  // "Completa tus datos": censadores que ya existían. Hasta completarlos no inician capturas nuevas (la bandeja sigue enviando lo que ya tenían).
  app.post("/auth/completar-datos", { preHandler: app.autenticar, config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const p = completarDatosSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message, detalle: p.error.flatten() });
    const d = p.data;
    const curpHash = hashBusqueda(d.curp);
    if ((await pool.query("SELECT 1 FROM usuarios WHERE curp_hash = $1 AND id <> $2", [curpHash, req.user.sub])).rowCount) return reply.code(409).send({ error: "Ya hay una cuenta con esta CURP" });
    if (!(await pool.query("SELECT 1 FROM estados WHERE clave = $1", [d.estadoClave])).rowCount) return reply.code(400).send({ error: "Elige el estado" });
    try {
      const { rows } = await pool.query(
        `UPDATE usuarios SET nombre = $1, apellido_paterno = $2, apellido_materno = $3, apellidos = $4, curp_cifrado = $5, curp_hash = $6,
                estado_clave = $7, estado_sugerido = false, datos_completos = true
          WHERE id = $8 RETURNING ${COLUMNAS_SESION}`,
        [d.nombre, d.apellidoPaterno, d.apellidoMaterno, `${d.apellidoPaterno} ${d.apellidoMaterno}`, cifrar(d.curp), curpHash, d.estadoClave, req.user.sub],
      );
      await auditar(req.user.sub, "completar_datos", "usuarios", req.user.sub);
      const u = rows[0];
      return { ...sesion(u).usuario };
    } catch (e: any) {
      if (e.code === "23505") return reply.code(409).send({ error: "Ya hay una cuenta con esta CURP" });
      throw e;
    }
  });

  // Entrada con correo (o usuario, para supervisores y administradores)
  app.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const p = loginSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos" });
    const id = p.data.usuario.toLowerCase();
    const { rows } = await pool.query(
      `SELECT ${COLUMNAS_SESION}, password_hash, activo FROM usuarios
        WHERE lower(correo) = $1 OR lower(usuario) = $1 LIMIT 1`,
      [id],
    );
    const u = rows[0];
    // Mismo mensaje exista o no el usuario
    if (!u || !u.activo || !(await verify(u.password_hash, p.data.password)))
      return reply.code(401).send({ error: "Correo o contraseña incorrectos" });
    return sesion(u);
  });

  app.get("/auth/me", { preHandler: app.autenticar }, async (req) => {
    const { rows } = await pool.query(`SELECT ${COLUMNAS_SESION}, creado_en FROM usuarios WHERE id = $1`, [req.user.sub]);
    const u = rows[0];
    return {
      id: u.id, nombre: u.nombre, apellidos: u.apellidos, rol: u.rol, correo: u.correo ?? u.usuario, creadoEn: u.creado_en,
      permisos: permisosEfectivos(u.rol, u.permisos, u.alcance_nacional === true), ...datosCuenta(u),
    };
  });

  app.patch("/perfil", { preHandler: app.autenticar }, async (req, reply) => {
    const p = perfilSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Revisa tu nombre y apellidos (solo letras)" });
    await pool.query("UPDATE usuarios SET nombre = $1, apellidos = $2 WHERE id = $3", [p.data.nombre, p.data.apellidos, req.user.sub]);
    return { nombre: p.data.nombre, apellidos: p.data.apellidos };
  });

  app.post("/perfil/password", { preHandler: app.autenticar, config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const p = cambioPasswordSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message });
    const { rows } = await pool.query("SELECT password_hash FROM usuarios WHERE id = $1", [req.user.sub]);
    if (!rows[0] || !(await verify(rows[0].password_hash, p.data.actual))) return reply.code(401).send({ error: "La contraseña actual no es correcta" });
    if (p.data.nueva === p.data.actual) return reply.code(400).send({ error: "La contraseña nueva debe ser distinta de la actual" });
    // Al cambiarla ya no hace falta la pantalla obligatoria (si la cuenta venía de un restablecimiento)
    await pool.query("UPDATE usuarios SET password_hash = $1, debe_cambiar_password = false WHERE id = $2", [await hash(p.data.nueva), req.user.sub]);
    return { ok: true };
  });
}
