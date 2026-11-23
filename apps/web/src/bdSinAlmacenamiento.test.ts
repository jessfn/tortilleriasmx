import { describe, expect, it, vi } from "vitest";

describe("sin IndexedDB (contexto de seguridad inválido, modo privado)", () => {
  it("la app no se detiene: guarda y lee en memoria y avisa que no hay almacenamiento", async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", {
      open() {
        throw new DOMException("IDBFactory.open() called in an invalid security context", "SecurityError");
      },
    });
    const bd = await import("./bd");
    const db = await bd.abrir();
    expect(bd.almacenamientoEnMemoria).toBe(true);
    await db.put("kv", { a: 1 }, "x");
    expect(await db.get("kv", "x")).toEqual({ a: 1 });
    await db.put("bandeja", { id: "p1" } as never);
    expect((await db.getAll("bandeja")).map((p) => p.id)).toEqual(["p1"]);
    await db.delete("bandeja", "p1");
    expect(await db.getAll("bandeja")).toEqual([]);
    vi.unstubAllGlobals();
  });
});
