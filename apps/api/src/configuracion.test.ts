import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.mock("./db.js", () => ({ pool: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) }, auditar: vi.fn() }));

/** Configuración por variables de entorno que se usa al migrar de servidor o de dominio */
describe("CORS con varios orígenes y proxies de confianza", () => {
  let app: FastifyInstance;
  let base: string;
  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.JWT_SECRET = "x".repeat(40);
    process.env.ENCRYPTION_KEY = "b".repeat(64);
    process.env.CORS_ORIGIN = "https://nuevo.example.gob.mx, https://viejo.example.com";
    process.env.TRUST_PROXY = "2";
    const { crearApp } = await import("./app.js");
    app = await crearApp();
    base = await app.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => {
    await app.close();
  });

  const permitido = async (origen: string) =>
    (await fetch(`${base}/health`, { headers: { origin: origen } })).headers.get("access-control-allow-origin");

  it("acepta el dominio nuevo y el anterior", async () => {
    expect(await permitido("https://nuevo.example.gob.mx")).toBe("https://nuevo.example.gob.mx");
    expect(await permitido("https://viejo.example.com")).toBe("https://viejo.example.com");
  });

  it("no acepta otros orígenes", async () => {
    expect(await permitido("https://otro.example.org")).toBeNull();
  });

  it("con TRUST_PROXY=2 cada cliente real tiene su propio cupo de inicios de sesión (no el de nginx)", async () => {
    const login = (cliente: string) =>
      fetch(`${base}/auth/login`, {
        method: "POST",
        // cadena que llega a la app: cliente, balanceador (nginx es quien se conecta)
        headers: { "content-type": "application/json", "x-forwarded-for": `${cliente}, 10.0.0.1` },
        body: JSON.stringify({ usuario: "nadie@example.com", password: "x".repeat(10) }),
      });
    for (let i = 0; i < 10; i++) expect((await login("203.0.113.10")).status).not.toBe(429);
    expect((await login("203.0.113.10")).status).toBe(429); // el mismo cliente se pasó del límite
    expect((await login("203.0.113.11")).status).not.toBe(429); // otro cliente no se ve afectado
  });
});
