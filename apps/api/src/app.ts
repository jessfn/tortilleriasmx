import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { registrarAuth } from "./auth.js";
import { rutasCatalogos } from "./rutas/catalogos.js";
import { rutasTortillerias } from "./rutas/tortillerias.js";
import { rutasPrecios } from "./rutas/precios.js";
import { rutasFotos } from "./rutas/fotos.js";

export async function crearApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 1_000_000 });
  const secreto = process.env.JWT_SECRET;
  if (!secreto || secreto.length < 32) throw new Error("JWT_SECRET debe tener al menos 32 caracteres");

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
  });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(jwt, { secret: secreto });

  app.get("/health", async () => ({ ok: true }));
  registrarAuth(app);
  rutasCatalogos(app);
  rutasTortillerias(app);
  rutasPrecios(app);
  await rutasFotos(app);
  return app;
}
