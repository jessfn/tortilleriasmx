import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let base: string;
const ID = "00000000-0000-4000-8000-000000000000";
const json = { "content-type": "application/json" };

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

describe("app", () => {
  it("health responde", async () => {
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
  });

  it("lo sensible exige sesión: datos personales, fotos y perfil", async () => {
    for (const url of ["/auth/me", `/fotos/${ID}`, `/tortillerias/${ID}/responsable`]) {
      expect((await fetch(base + url)).status).toBe(401);
    }
  });

  it("la captura es pública: valida datos sin pedir token", async () => {
    // Sin token llega a la validación (400), no al 401
    const precio = await fetch(`${base}/precios`, { method: "POST", headers: json, body: "{}" });
    expect(precio.status).toBe(400);
    const nueva = await fetch(`${base}/tortillerias`, { method: "POST", headers: json, body: "{}" });
    expect(nueva.status).toBe(400);
    const resp = await fetch(`${base}/tortillerias/${ID}/responsable`, { method: "POST", headers: json, body: "{}" });
    expect(resp.status).toBe(400);
  });

  it("el responsable exige aceptar el aviso de privacidad", async () => {
    const r = await fetch(`${base}/tortillerias/${ID}/responsable`, { method: "POST", headers: json, body: JSON.stringify({ aceptoAviso: false }) });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/aviso/i);
  });

  it("PATCH estatus exige supervisor", async () => {
    const token = app.jwt.sign({ sub: "u", rol: "capturista" });
    const r = await fetch(`${base}/tortillerias/${ID}/estatus`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, ...json },
      body: JSON.stringify({ estatus: "validada" }),
    });
    expect(r.status).toBe(403);
  });
});
