import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;
let base: string;

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
    const r = await fetch(`${base}/health`);
    expect(await r.json()).toEqual({ ok: true });
  });
  it("rutas protegidas piden token", async () => {
    for (const url of ["/estados", "/tortillerias", "/auth/me", "/fotos/00000000-0000-4000-8000-000000000000"]) {
      expect((await fetch(base + url)).status).toBe(401);
    }
    const r = await fetch(`${base}/precios`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
  });
  it("PATCH estatus exige supervisor", async () => {
    const token = app.jwt.sign({ sub: "u", rol: "capturista" });
    const r = await fetch(`${base}/tortillerias/00000000-0000-4000-8000-000000000000/estatus`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ estatus: "validada" }),
    });
    expect(r.status).toBe(403);
  });
});
