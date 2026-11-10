import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";

/** Servidor de la PWA para el puerto 3007 (deploy/agricultura/servidor-web.mjs): lo que antes hacía nginx */
describe("servidor de la PWA", () => {
  let srv: Server;
  let base: string;
  let padre: string;
  let dir: string;
  const grande = "const x = 1;\n".repeat(400);

  beforeAll(async () => {
    padre = fs.mkdtempSync(path.join(os.tmpdir(), "pwa-"));
    dir = path.join(padre, "dist");
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>app</title>");
    fs.writeFileSync(path.join(dir, "sw.js"), grande);
    fs.writeFileSync(path.join(dir, "manifest.webmanifest"), "{}");
    fs.writeFileSync(path.join(dir, "assets", "app-abc123.js"), grande);
    fs.writeFileSync(path.join(dir, "logo.png"), Buffer.from([137, 80, 78, 71]));
    fs.writeFileSync(path.join(padre, "secreto-fuera.txt"), "no debe salir");
    const modulo = "../../../deploy/agricultura/servidor-web.mjs";
    const m: any = await import(/* @vite-ignore */ modulo);
    srv = m.crearServidorWeb(dir);
    await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${(srv.address() as any).port}`;
  });
  afterAll(async () => {
    await new Promise((ok) => srv.close(ok));
    fs.rmSync(padre, { recursive: true, force: true });
  });

  it("la raíz abre la app y nunca queda en caché (también sirve a la revisión de salud del balanceador)", async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<title>app</title>");
    expect(r.headers.get("cache-control")).toContain("no-store");
  });

  it("sw.js y el manifiesto no se guardan en caché; los archivos con hash, un año", async () => {
    expect((await fetch(`${base}/sw.js`)).headers.get("cache-control")).toContain("no-store");
    expect((await fetch(`${base}/manifest.webmanifest`)).headers.get("content-type")).toContain("manifest+json");
    expect((await fetch(`${base}/assets/app-abc123.js`)).headers.get("cache-control")).toContain("immutable");
    expect((await fetch(`${base}/logo.png`)).headers.get("cache-control")).toContain("max-age=2592000");
  });

  it("una dirección de la app (como /acceso) abre la app; un archivo que no existe es 404", async () => {
    const r = await fetch(`${base}/acceso`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<title>app</title>");
    expect((await fetch(`${base}/assets/no-existe.js`)).status).toBe(404);
  });

  it("no deja salir de la carpeta", async () => {
    for (const ruta of ["/../secreto-fuera.txt", "/%2e%2e/secreto-fuera.txt", "/assets/../../secreto-fuera.txt"]) {
      const r = await fetch(`${base}${ruta}`);
      expect(await r.text(), ruta).not.toContain("no debe salir");
    }
  });

  it("comprime cuando el navegador lo acepta", async () => {
    const r = await fetch(`${base}/assets/app-abc123.js`, { headers: { "accept-encoding": "gzip" } });
    expect(r.headers.get("content-encoding")).toBe("gzip");
    expect(r.headers.get("vary")).toContain("Accept-Encoding");
    expect(await r.text()).toBe(grande); // fetch descomprime solo
    // sin que el navegador lo acepte, va tal cual
    const sin = await fetch(`${base}/assets/app-abc123.js`, { headers: { "accept-encoding": "identity" } });
    expect(sin.headers.get("content-encoding")).toBeNull();
    expect(await sin.text()).toBe(grande);
  });

  it("manda a HTTPS lo que llegó por HTTP y solo atiende GET y HEAD", async () => {
    const r = await fetch(`${base}/acceso`, { headers: { "x-forwarded-proto": "http" }, redirect: "manual" });
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toMatch(/^https:\/\/127\.0\.0\.1:\d+\/acceso$/);
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
    expect((await fetch(`${base}/`, { method: "HEAD" })).status).toBe(200);
  });

  it("incluye los encabezados de seguridad", async () => {
    const r = await fetch(`${base}/`);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("strict-transport-security")).toContain("max-age");
  });
});
