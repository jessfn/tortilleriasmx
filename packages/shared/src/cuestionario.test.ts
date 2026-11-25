import { describe, expect, it } from "vitest";
import { alternarApoyo, cuestionarioSchema, diccionarioCuestionario, limpiarCondicionales, respuestasSchema, textoB2, type Respuestas } from "./cuestionario.js";
import { PERMISOS_ESTATAL, PERMISOS_SUPERVISOR_POR_OMISION, permisosEfectivos } from "./permisos.js";

export const completo: Respuestas = {
  a1: "MERCADO",
  a2: { H_LIMPIEZA: true, H_PLAGAS: true, H_INSUMOS: false, H_PERSONAL: true, H_BASURA: false },
  b1: "MAIZ_PROPIO",
  b2: "V_500_1000",
  b3: "FAMILIAR",
  b4: "T_2_3",
  b5: "ADHERIDA",
  b8: ["NINGUNO"],
  c1: "SI_VISIBLE",
  c2: "ALGUNAS",
  c3: "SI",
};
const ok = (r: unknown) => respuestasSchema.safeParse(r).success;

describe("C21 · cuestionarioSchema", () => {
  it("acepta un cuestionario completo", () => {
    expect(ok(completo)).toBe(true);
    expect(cuestionarioSchema.safeParse({ estatus: "aplicado", respuestas: completo }).success).toBe(true);
  });
  it("rechaza una obligatoria vacía (también un punto de higiene)", () => {
    const { c2: _c2, ...sinC2 } = completo;
    expect(ok(sinC2)).toBe(false);
    expect(ok({ ...completo, a2: { ...completo.a2, H_BASURA: undefined } })).toBe(false);
    expect(ok({ ...completo, b8: [] })).toBe(false);
  });
  it("B6 (y su texto con OTRO) solo con CONOCE_NO_ADHERIDA; B7 solo si no está adherida", () => {
    const base = { ...completo, b5: "CONOCE_NO_ADHERIDA" as const };
    expect(ok({ ...base, b7: true })).toBe(false); // falta B6
    expect(ok({ ...base, b6: ["PRECIO"] })).toBe(false); // falta B7
    expect(ok({ ...base, b6: ["PRECIO"], b7: true })).toBe(true);
    expect(ok({ ...base, b6: ["OTRO"], b7: false })).toBe(false); // falta el texto
    expect(ok({ ...base, b6: ["OTRO"], b6Otro: "Le queda lejos el centro", b7: false })).toBe(true);
    expect(ok({ ...base, b6: ["OTRO"], b6Otro: "x".repeat(101), b7: false })).toBe(false);
    expect(ok({ ...completo, b5: "NO_CONOCE", b7: true })).toBe(true);
    expect(ok({ ...completo, b5: "NO_CONOCE" })).toBe(false); // falta B7
    expect(ok({ ...completo, b5: "NO_CONOCE", b7: true, b6: ["PRECIO"] })).toBe(false); // B6 no aplica
    expect(ok({ ...completo, b7: false })).toBe(false); // adherida: B7 no aplica
  });
  it("cada 'Otro' exige su texto (A1, B6 y B8), y el texto solo va con 'Otro'", () => {
    expect(ok({ ...completo, a1: "OTRO" })).toBe(false);
    expect(ok({ ...completo, a1: "OTRO", a1Otro: "En un puesto ambulante" })).toBe(true);
    expect(ok({ ...completo, a1Otro: "x" })).toBe(false);
    expect(ok({ ...completo, b8: ["OTRO"] })).toBe(false);
    expect(ok({ ...completo, b8: ["OTRO", "JCF"], b8Otro: "Programa municipal" })).toBe(true);
    expect(ok({ ...completo, b8: ["OTRO"], b8Otro: "x".repeat(101) })).toBe(false);
    const r = limpiarCondicionales({ ...completo, a1: "MERCADO", a1Otro: "x", b8: ["NINGUNO"], b8Otro: "y" });
    expect(r.a1Otro).toBeUndefined();
    expect(r.b8Otro).toBeUndefined();
  });

  it("rechaza NINGUNO junto con otra opción en B8", () => {
    expect(ok({ ...completo, b8: ["NINGUNO", "JCF"] })).toBe(false);
    expect(ok({ ...completo, b8: ["JCF", "CREDITO"] })).toBe(true);
  });
  it("acepta 'No sabe' y 'Prefiere no responder', y 'Otro' exige su texto en B1 y B3", () => {
    expect(ok({ ...completo, b1: "NO_SABE", b2: "NO_RESPONDE", b3: "NO_SABE", c1: "NO_RESPONDE", c2: "NO_RESPONDE", c3: "NO_SABE" })).toBe(true);
    expect(ok({ ...completo, b1: "OTRO" })).toBe(false);
    expect(ok({ ...completo, b1: "OTRO", b1Otro: "Maíz y trigo" })).toBe(true);
    expect(ok({ ...completo, b3: "OTRO", b3Otro: "Cooperativa" })).toBe(true);
    expect(ok({ ...completo, b3Otro: "x" })).toBe(false);
  });
  it("rechaza códigos que no existen y campos de más", () => {
    expect(ok({ ...completo, a1: "PLAZA" })).toBe(false);
    expect(ok({ ...completo, extra: 1 })).toBe(false);
  });
  it("'No se pudo aplicar' exige motivo y el texto de 5 a 100 con OTRO", () => {
    const n = (d: object) => cuestionarioSchema.safeParse({ estatus: "no_aplicado", ...d }).success;
    expect(n({ motivo: "INSEGURIDAD" })).toBe(true);
    expect(n({})).toBe(false);
    expect(n({ motivo: "OTRO" })).toBe(false);
    expect(n({ motivo: "OTRO", motivoOtro: "abc" })).toBe(false);
    expect(n({ motivo: "OTRO", motivoOtro: "Llovía mucho" })).toBe(true);
    expect(n({ motivo: "OTRO", motivoOtro: "x".repeat(101) })).toBe(false);
  });
  it("limpiarCondicionales borra B6/B7 cuando dejan de aplicar", () => {
    const r = limpiarCondicionales({ ...completo, b5: "ADHERIDA", b6: ["PRECIO"], b6Otro: "x", b7: true });
    expect(r.b6).toBeUndefined();
    expect(r.b7).toBeUndefined();
    expect(ok(r)).toBe(true);
    expect(limpiarCondicionales({ b5: "CONOCE_NO_ADHERIDA", b6: ["PRECIO"], b6Otro: "x" }).b6Otro).toBeUndefined();
  });
  it("B8: Ninguno es exclusivo al marcar", () => {
    expect(alternarApoyo(["JCF"], "NINGUNO")).toEqual(["NINGUNO"]);
    expect(alternarApoyo(["NINGUNO"], "JCF")).toEqual(["JCF"]);
    expect(alternarApoyo(["JCF", "CREDITO"], "JCF")).toEqual(["CREDITO"]);
  });
  it("el texto de B2 cambia según B1", () => {
    expect(textoB2("HARINA")).toMatch(/harina/);
    expect(textoB2(undefined)).toMatch(/insumo/);
  });
  it("el diccionario trae una columna por punto de higiene y por opción de B6 y B8", () => {
    const cols = new Set(diccionarioCuestionario().map((d) => d.columna));
    for (const c of ["a2_h_limpieza", "a2_h_basura", "b6_precio", "b6_otro", "b8_jcf", "b8_ninguno", "c3_declaracion"]) expect(cols.has(c)).toBe(true);
  });
  it("'Cuestionarios' es un permiso reservado: nadie lo tiene por su rol, solo si se le marca a mano", () => {
    expect(PERMISOS_SUPERVISOR_POR_OMISION).not.toContain("ver_cuestionarios");
    expect(PERMISOS_ESTATAL).not.toContain("ver_cuestionarios");
    expect(permisosEfectivos("admin", null)).not.toContain("ver_cuestionarios");
    expect(permisosEfectivos("admin", null)).toContain("ver_extras"); // un administrador sigue teniendo todo lo demás
    expect(permisosEfectivos("admin", ["ver_cuestionarios"])).toContain("ver_cuestionarios");
    expect(permisosEfectivos("admin", ["ver_cuestionarios"])).toContain("ver_resumen");
    expect(permisosEfectivos("supervisor", null)).not.toContain("ver_cuestionarios");
    expect(permisosEfectivos("supervisor", ["ver_cuestionarios"])).toEqual(["ver_cuestionarios"]);
    expect(permisosEfectivos("estatal", ["ver_cuestionarios"], true)).not.toContain("ver_cuestionarios");
  });
});
