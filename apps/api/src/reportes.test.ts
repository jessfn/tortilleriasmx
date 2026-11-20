import { describe, it, expect, vi } from "vitest";

vi.mock("./db.js", () => ({ pool: { query: async () => ({ rows: [] }) }, auditar: vi.fn() }));
const { calcularRango, hoyMx, textosRango } = await import("./reportes.js");

const ok = (p: Parameters<typeof calcularRango>[0], f: string, h?: string, hoy = "2026-11-19") => {
  const r = calcularRango(p, f, h, hoy);
  if (typeof r === "string") throw new Error(r);
  return r;
};

describe("periodos de los reportes (hora de México)", () => {
  it("día: del 00:00 al 23:59 de ese día; el límite superior es el día siguiente", () => {
    const r = ok("dia", "2026-11-19");
    expect(r).toMatchObject({ desde: "2026-11-19", hasta: "2026-11-19", hastaExcl: "2026-11-20", dias: 1, granularidad: "hora" });
    expect(r.ant).toEqual({ desde: "2026-11-18", hastaExcl: "2026-11-19" });
  });
  it("semana: de lunes a domingo, sin importar qué día se elija", () => {
    for (const f of ["2026-11-16", "2026-11-19", "2026-11-22"]) expect(ok("semana", f, undefined, "2026-11-30")).toMatchObject({ desde: "2026-11-16", hasta: "2026-11-22", hastaExcl: "2026-11-23", dias: 7, granularidad: "dia" });
    expect(ok("semana", "2026-11-19").ant).toEqual({ desde: "2026-11-09", hastaExcl: "2026-11-16" });
  });
  it("mes: del día 1 al último (febrero, bisiesto y cambio de año)", () => {
    expect(ok("mes", "2026-02-10", undefined, "2026-11-19")).toMatchObject({ desde: "2026-02-01", hasta: "2026-02-28", dias: 28 });
    expect(ok("mes", "2028-02-10", undefined, "2028-11-19")).toMatchObject({ hasta: "2028-02-29", dias: 29 });
    const dic = ok("mes", "2026-12-05", undefined, "2026-12-31");
    expect(dic).toMatchObject({ desde: "2026-12-01", hasta: "2026-12-31", hastaExcl: "2027-01-01" });
    expect(ok("mes", "2026-01-15").ant).toEqual({ desde: "2025-12-01", hastaExcl: "2026-01-01" });
  });
  it("año: del 1 de enero al 31 de diciembre, por mes", () => {
    expect(ok("anio", "2026-06-01")).toMatchObject({ desde: "2026-01-01", hasta: "2026-12-31", hastaExcl: "2027-01-01", dias: 365, granularidad: "mes" });
    expect(ok("anio", "2025-06-01").ant).toEqual({ desde: "2024-01-01", hastaExcl: "2025-01-01" });
  });
  it("rango: inclusivo, anterior del mismo largo; un solo día usa horas; más de 62 días usa meses", () => {
    expect(ok("rango", "2026-11-01", "2026-11-10")).toMatchObject({ dias: 10, granularidad: "dia", hastaExcl: "2026-11-11", ant: { desde: "2026-10-22", hastaExcl: "2026-11-01" } });
    expect(ok("rango", "2026-11-05", "2026-11-05").granularidad).toBe("hora");
    expect(ok("rango", "2026-01-01", "2026-06-30").granularidad).toBe("mes");
  });
  it("rechaza lo que no tiene sentido", () => {
    expect(typeof calcularRango("dia", "2026-11-20", undefined, "2026-11-19")).toBe("string"); // futuro
    expect(typeof calcularRango("rango", "2026-11-10", undefined, "2026-11-19")).toBe("string"); // sin fin
    expect(typeof calcularRango("rango", "2026-11-10", "2026-11-01", "2026-11-19")).toBe("string"); // al revés
    expect(typeof calcularRango("rango", "2026-11-01", "2026-11-25", "2026-11-19")).toBe("string"); // fin futuro
    expect(typeof calcularRango("rango", "2025-01-01", "2026-11-19", "2026-11-19")).toBe("string"); // más de 366 días
  });
  it("hoy se calcula en hora de México (a las 23:30 del 6 en México ya es el 7 en UTC)", () => {
    expect(hoyMx(new Date("2026-11-07T05:30:00Z"))).toBe("2026-11-06");
    expect(hoyMx(new Date("2026-11-07T06:30:00Z"))).toBe("2026-11-07");
  });
  it("textos del encabezado", () => {
    expect(textosRango(ok("dia", "2026-11-19")).titulo).toBe("Jueves 19 de noviembre de 2026");
    expect(textosRango(ok("semana", "2026-11-19")).titulo).toBe("Semana del 16 al 22 de noviembre de 2026");
    expect(textosRango(ok("mes", "2026-11-19")).titulo).toBe("Noviembre de 2026");
    expect(textosRango(ok("anio", "2026-03-01")).titulo).toBe("Año 2026");
    expect(textosRango(ok("dia", "2026-11-19")).horario).toContain("12:00 a. m. a 11:59 p. m.");
  });
});
