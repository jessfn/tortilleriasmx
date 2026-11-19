import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";
import { cambioPasswordSchema, perfilSchema, permisosEfectivos, registroSchema, type Permiso } from "@tortillerias/shared";
import { pool } from "./db.js";

export type Rol = "capturista" | "supervisor" | "admin";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; rol: Rol };
    user: { sub: string; rol: Rol; permisos: Permiso[] };
  }
}
declare module "fastify" {
  interface FastifyInstance {
    autenticar: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    soloRoles: (...roles: Rol[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Personal del administrador con AL MENOS UNO de estos permisos (un administrador los tiene todos). Los usuarios de la app nunca pasan. */
    conPermiso: (...permisos: Permiso[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
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
    const { rows } = await pool.query("SELECT rol, activo, permisos FROM usuarios WHERE id = $1", [req.user.sub]);
    if (!rows[0] || !rows[0].activo) return reply.code(401).send({ error: "Cuenta desactivada" });
    req.user.rol = rows[0].rol; // el rol vigente manda sobre el del token
    req.user.permisos = permisosEfectivos(rows[0].rol, rows[0].permisos); // y los permisos vigentes, también (un cambio surte efecto de inmediato)
    if (roles && !roles.includes(req.user.rol)) return reply.code(403).send({ error: "Sin permiso" });
    if (permisos && !permisos.some((p) => req.user.permisos.includes(p))) return reply.code(403).send({ error: "Sin permiso" });
  };

  app.decorate("autenticar", (req: FastifyRequest, reply: FastifyReply) => verificar(req, reply));
  app.decorate("soloRoles", (...roles: Rol[]) => (req: FastifyRequest, reply: FastifyReply) => verificar(req, reply, roles));
  app.decorate("conPermiso", (...permisos: Permiso[]) => (req: FastifyRequest, reply: FastifyReply) => verificar(req, reply, ["supervisor", "admin"], permisos));

  const sesion = (u: { id: string; nombre: string; apellidos: string; rol: Rol; correo: string | null; usuario: string; debe_cambiar_password?: boolean; permisos?: string[] | null }) => ({
    token: app.jwt.sign({ sub: u.id, rol: u.rol }, { expiresIn: u.rol === "capturista" ? "7d" : "12h" }),
    usuario: {
      id: u.id, nombre: u.nombre, apellidos: u.apellidos, rol: u.rol, correo: u.correo ?? u.usuario, debeCambiarPassword: u.debe_cambiar_password === true,
      permisos: permisosEfectivos(u.rol, u.permisos), // qué pantallas y acciones tiene (solo el personal del administrador)
    },
  });

  // Crear cuenta (correo + contraseña de 6 o más caracteres + confirmación)
  app.post("/auth/registro", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const p = registroSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0].message, detalle: p.error.flatten() });
    const { correo, password } = p.data;
    const existe = await pool.query("SELECT 1 FROM usuarios WHERE lower(correo) = $1 OR lower(usuario) = $1", [correo]);
    if (existe.rowCount) return reply.code(409).send({ error: "Ya existe una cuenta con ese correo" });
    try {
      const { rows } = await pool.query(
        `INSERT INTO usuarios(usuario, correo, password_hash, rol) VALUES ($1,$1,$2,'capturista')
         RETURNING id, nombre, apellidos, rol, correo, usuario`,
        [correo, await hash(password)],
      );
      return reply.code(201).send(sesion(rows[0]));
    } catch (e: any) {
      if (e.code === "23505") return reply.code(409).send({ error: "Ya existe una cuenta con ese correo" });
      throw e;
    }
  });

  // Entrada con correo (o usuario, para supervisores y administradores)
  app.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const p = loginSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: "Datos inválidos" });
    const id = p.data.usuario.toLowerCase();
    const { rows } = await pool.query(
      `SELECT id, nombre, apellidos, password_hash, rol, activo, correo, usuario, debe_cambiar_password, permisos FROM usuarios
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
    const { rows } = await pool.query(
      "SELECT id, nombre, apellidos, rol, correo, usuario, creado_en, permisos FROM usuarios WHERE id = $1",
      [req.user.sub],
    );
    const u = rows[0];
    return { id: u.id, nombre: u.nombre, apellidos: u.apellidos, rol: u.rol, correo: u.correo ?? u.usuario, creadoEn: u.creado_en, permisos: permisosEfectivos(u.rol, u.permisos) };
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
