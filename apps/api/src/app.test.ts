import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Base de datos simulada: la cuenta activa tiene el rol que cada prueba necesita
let rolActual = "capturista";
vi.mock("./db.js", () => ({
  pool: {
    query: vi.fn(async (sql: string) => {
      if (/FROM usuarios WHERE id/.test(sql)) return { rows: [{ rol: rolActual, activo: true }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  },
  auditar: vi.fn(),
}));

let app: FastifyInstance;
let base: string;
const ID = "00000000-0000-4000-8000-000000000000";
const json = { "content-type": "application/json" };
const token = (rol = "capturista") => app.jwt.sign({ sub: "u1", rol: rol as any });
const auth = (rol?: string) => ({ authorization: `Bearer ${token(rol)}`, ...json });

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "x".repeat(40);
  process.env.ENCRYPTION_KEY = "b".repeat(64);
  const { crearApp } = await import("./app.js");
  app = await crearApp();
  base = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await app.close();
});

describe("acceso", () => {
  it("health responde", async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
  });

  it("todo lo privado exige sesión", async () => {
    const get = [
      "/auth/me", "/mis/resumen", "/mis/registros", "/mis/tortillerias", "/admin/resumen", "/admin/usuarios", `/fotos/${ID}`,
      `/tortillerias/${ID}/responsable`, `/tortillerias/${ID}/fiscal`, `/tortillerias/${ID}/fiscal/existe`, `/tortillerias/${ID}/mis-precios-hoy`,
    ];
    for (const url of get) expect((await fetch(base + url)).status, url).toBe(401);
    for (const url of ["/precios", "/tortillerias", `/tortillerias/${ID}/fiscal`, `/tortillerias/${ID}/fotos`]) {
      expect((await fetch(base + url, { method: "POST", headers: json, body: "{}" })).status, url).toBe(401);
    }
  });

  it("un usuario registrado puede capturar (llega a la validación)", async () => {
    const r = await fetch(`${base}/precios`, { method: "POST", headers: auth(), body: "{}" });
    expect(r.status).toBe(400);
  });

  it("no se puede capturar tortilla de harina", async () => {
    const r = await fetch(`${base}/precios`, { method: "POST", headers: auth(), body: JSON.stringify({ tortilleriaId: ID, producto: "harina", precioKg: 24 }) });
    expect(r.status).toBe(400);
  });

  it("el mapa exige un rectángulo válido", async () => {
    expect((await fetch(`${base}/tortillerias/mapa`)).status).toBe(400);
    expect((await fetch(`${base}/tortillerias/mapa?bbox=1,2,0,1`)).status).toBe(400);
    expect((await fetch(`${base}/tortillerias/mapa?bbox=-99.2,19.3,-99.1,19.4`)).status).toBe(200);
  });

  it("el panel de administración es solo para supervisores y administradores", async () => {
    rolActual = "capturista";
    expect((await fetch(`${base}/admin/resumen`, { headers: auth("capturista") })).status).toBe(403);
    expect((await fetch(`${base}/admin/tortillerias`, { headers: auth("capturista") })).status).toBe(403);
    rolActual = "supervisor";
    expect((await fetch(`${base}/admin/resumen`, { headers: auth("supervisor") })).status).toBe(200);
  });

  it("la gestión de usuarios es solo del administrador", async () => {
    rolActual = "supervisor";
    expect((await fetch(`${base}/admin/usuarios`, { headers: auth("supervisor") })).status).toBe(403);
    rolActual = "admin";
    expect((await fetch(`${base}/admin/usuarios`, { headers: auth("admin") })).status).toBe(200);
  });

  it("el rol vigente en la base manda sobre el del token", async () => {
    rolActual = "capturista"; // lo degradaron, aunque su token diga admin
    expect((await fetch(`${base}/admin/usuarios`, { headers: auth("admin") })).status).toBe(403);
  });
});

describe("registro de cuenta", () => {
  const post = (body: unknown) => fetch(`${base}/auth/registro`, { method: "POST", headers: json, body: JSON.stringify(body) });

  it("rechaza contraseña corta, sin confirmar y correo inválido", async () => {
    expect((await post({ correo: "a@b.com", password: "12345", confirmar: "12345" })).status).toBe(400);
    expect((await post({ correo: "a@b.com", password: "123456", confirmar: "654321" })).status).toBe(400);
    expect((await post({ correo: "no-es-correo", password: "123456", confirmar: "123456" })).status).toBe(400);
  });

  it("los datos fiscales exigen aceptar el aviso de privacidad", async () => {
    const r = await fetch(`${base}/tortillerias/${ID}/fiscal`, { method: "POST", headers: auth(), body: JSON.stringify({ aceptoAviso: false }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/aviso/i);
  });

  it("ya no existe el alta de responsable con CURP", async () => {
    const r = await fetch(`${base}/tortillerias/${ID}/responsable`, { method: "POST", headers: auth(), body: JSON.stringify({ curp: "HEGG560427MVZRRL04" }) });
    expect(r.status).toBe(404);
  });
});
