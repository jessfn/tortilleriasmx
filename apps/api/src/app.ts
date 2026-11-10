import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import { registrarAuth } from "./auth.js";
import { rutasCatalogos } from "./rutas/catalogos.js";
import { rutasTortillerias } from "./rutas/tortillerias.js";
import { rutasPrecios } from "./rutas/precios.js";
import { rutasFotos } from "./rutas/fotos.js";
import { rutasPanel } from "./rutas/panel.js";
import { rutasAdmin } from "./rutas/admin.js";
import { rutasAdminMapa } from "./rutas/admin-mapa.js";
import { rutasCatalogoEstado } from "./rutas/catalogo-estado.js";

export async function crearApp() {
  // Detrás de nginx (y, en el servidor de la Secretaría, también del balanceador) la IP real del cliente viene en X-Forwarded-For.
  // TRUST_PROXY = cuántos proxies hay delante de la app (1 = solo nginx, 2 = balanceador + nginx). Sin esto el límite de peticiones
  // y los intentos de inicio de sesión se cuentan por la IP de nginx y todos los usuarios comparten el mismo cupo.
  const saltos = Number(process.env.TRUST_PROXY ?? "1");
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 1_000_000, trustProxy: (_dir: string, salto: number) => salto < (Number.isInteger(saltos) && saltos >= 0 ? saltos : 1) });
  const secreto = process.env.JWT_SECRET;
  if (!secreto || secreto.length < 32) throw new Error("JWT_SECRET debe tener al menos 32 caracteres");

  // CORS_ORIGIN admite varias direcciones separadas por coma (p. ej. el dominio nuevo y el anterior durante una migración)
  const origenes = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((o) => o.trim()).filter(Boolean);
  await app.register(cors, {
    origin: origenes.length === 1 ? origenes[0] : origenes,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
  });
  // Sin nginx delante (el balanceador entrega directo a la app) las respuestas grandes, como el catálogo de un estado
  // (~3 MB de JSON), se comprimen aquí: pasan a ~0.5 MB en el teléfono del censador.
  await app.register(compress, { threshold: 1024, encodings: ["gzip", "deflate"] });
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  await app.register(jwt, { secret: secreto });

  // El balanceador revisa la salud de la app pidiendo "/" (o "/health")
  app.get("/", async () => ({ ok: true }));
  app.get("/health", async () => ({ ok: true }));
  registrarAuth(app);
  rutasCatalogos(app);
  rutasTortillerias(app);
  rutasPrecios(app);
  await rutasFotos(app);
  rutasPanel(app);
  rutasAdmin(app);
  rutasAdminMapa(app);
  rutasCatalogoEstado(app);
  return app;
}
