import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verify } from "@node-rs/argon2";
import { z } from "zod";
import { pool } from "./db.js";

export type Rol = "capturista" | "supervisor" | "admin";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; rol: Rol };
    user: { sub: string; rol: Rol };
  }
}
declare module "fastify" {
  interface FastifyInstance {
    autenticar: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    soloRoles: (...roles: Rol[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export function registrarAuth(app: FastifyInstance) {
  app.decorate("autenticar", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: "No autenticado" });
    }
  });

  app.decorate("soloRoles", (...roles: Rol[]) => async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "No autenticado" });
    }
    if (!roles.includes(req.user.rol)) return reply.code(403).send({ error: "Sin permiso" });
  });

  const loginSchema = z.object({ usuario: z.string().min(1), password: z.string().min(1) });

  // Límite estricto por IP contra fuerza bruta
  app.post(
    "/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const p = loginSchema.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: "Datos inválidos" });
      const { rows } = await pool.query(
        "SELECT id, nombre, apellidos, password_hash, rol, activo FROM usuarios WHERE usuario = $1",
        [p.data.usuario],
      );
      const u = rows[0];
      // Mismo mensaje exista o no el usuario
      if (!u || !u.activo || !(await verify(u.password_hash, p.data.password)))
        return reply.code(401).send({ error: "Usuario o contraseña incorrectos" });
      const token = app.jwt.sign({ sub: u.id, rol: u.rol }, { expiresIn: "12h" });
      return { token, usuario: { id: u.id, nombre: u.nombre, apellidos: u.apellidos, rol: u.rol } };
    },
  );

  app.get("/auth/me", { preHandler: app.autenticar }, async (req) => ({ id: req.user.sub, rol: req.user.rol }));
}
