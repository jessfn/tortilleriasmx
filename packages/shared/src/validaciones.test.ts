import { describe, it, expect } from "vitest";
import {
  telefonoSchema, precioSchema, normalizarTexto, registroSchema, nombreSchema, capturaPrecioSchema, fiscalSchema,
  nuevaTortilleriaSchema, TIPOS_VIAL, PERSONAL_OCUPADO, rfcFechaValida,
} from "./validaciones.js";

const ID = "00000000-0000-4000-8000-000000000000";

describe("validaciones básicas", () => {
  it("teléfono 10 dígitos", () => {
    expect(telefonoSchema.safeParse("5512345678").success).toBe(true);
    expect(telefonoSchema.safeParse("551234567").success).toBe(false);
  });
  it("precio en rango", () => {
    expect(precioSchema.safeParse(24).success).toBe(true);
    expect(precioSchema.safeParse(2).success).toBe(false);
    expect(precioSchema.safeParse(100).success).toBe(false);
  });
});

describe("captura de precio", () => {
  const base = { tortilleriaId: ID, producto: "maiz", precioKg: 24.5 };
  it("acepta maíz y masa", () => {
    expect(capturaPrecioSchema.safeParse(base).success).toBe(true);
    expect(capturaPrecioSchema.safeParse({ ...base, producto: "masa" }).success).toBe(true);
  });
  it("rechaza harina", () => expect(capturaPrecioSchema.safeParse({ ...base, producto: "harina" }).success).toBe(false));
  it("lat, lng y precisión son opcionales", () => {
    const r = capturaPrecioSchema.parse(base);
    expect([r.lat, r.lng, r.precisionGps]).toEqual([undefined, undefined, undefined]);
    expect(capturaPrecioSchema.safeParse({ ...base, lat: 19.4, lng: -99.1, precisionGps: 12 }).success).toBe(true);
  });
  it("sigue validando el rango de precio y de coordenadas", () => {
    expect(capturaPrecioSchema.safeParse({ ...base, precioKg: 2 }).success).toBe(false);
    expect(capturaPrecioSchema.safeParse({ ...base, lat: 200 }).success).toBe(false);
  });
});

describe("datos fiscales", () => {
  const fisica = { tipoPersona: "fisica", rfc: "pepa800101ab1", razonSocial: "José Pérez" };
  const moral = { tipoPersona: "moral", rfc: "tgu100101ab1", razonSocial: "Tortillería La Guadalupe SA de CV" };
  it("RFC de persona física: 13 caracteres", () => {
    const r = fiscalSchema.parse(fisica);
    expect([r.rfc, r.razonSocial]).toEqual(["PEPA800101AB1", "JOSE PEREZ"]);
    expect(fiscalSchema.safeParse({ ...fisica, rfc: "TGU100101AB1" }).success).toBe(false);
  });
  it("RFC de persona moral: 12 caracteres", () => {
    expect(fiscalSchema.safeParse(moral).success).toBe(true);
    expect(fiscalSchema.safeParse({ ...moral, rfc: "PEPA800101AB1" }).success).toBe(false);
  });
  it("la razón social es obligatoria", () => {
    expect(fiscalSchema.safeParse({ ...moral, razonSocial: "" }).success).toBe(false);
    expect(fiscalSchema.safeParse({ ...fisica, razonSocial: "   " }).success).toBe(false);
  });
  it("el celular es opcional: vacío o ausente pasa; 10 dígitos pasa; 9 no", () => {
    expect(fiscalSchema.safeParse(moral).success).toBe(true);
    expect(fiscalSchema.safeParse({ ...moral, celular: "" }).success).toBe(true);
    expect(fiscalSchema.safeParse({ ...moral, celular: "5512345678" }).success).toBe(true);
    expect(fiscalSchema.safeParse({ ...moral, celular: "551234567" }).success).toBe(false);
    expect(fiscalSchema.safeParse({ ...moral, celular: "55123abcde" }).success).toBe(false);
  });
  it("no pide CURP", () => {
    expect(fiscalSchema.safeParse({ ...moral, curp: undefined }).success).toBe(true);
  });
});

describe("tortillería nueva", () => {
  const base = {
    nombre: "Tortillería La Guadalupe", estadoClave: "09", municipioClave: "09015", localidad: "Ciudad de México", tipoVial: "CALLE",
    calle: "Hidalgo", numeroExt: "123", colonia: "Centro", codigoPostal: "09700", telefono: "5512345678", personalOcupado: "0 a 5 personas", lat: 19.43, lng: -99.13,
  };
  it("acepta lo mínimo y normaliza el texto", () => {
    const r = nuevaTortilleriaSchema.parse(base);
    expect([r.nombre, r.calle, r.colonia, r.localidad]).toEqual(["TORTILLERIA LA GUADALUPE", "HIDALGO", "CENTRO", "CIUDAD DE MEXICO"]);
    expect([r.numeroInt, r.telefono, r.correo]).toEqual([undefined, "5512345678", undefined]);
  });
  it("número interior y correo son opcionales (vacíos pasan)", () => {
    expect(nuevaTortilleriaSchema.safeParse({ ...base, numeroInt: "", correo: "" }).success).toBe(true);
  });
  it("el teléfono de la tortillería es obligatorio y de 10 dígitos", () => {
    const { telefono: _t, ...sinTelefono } = base;
    expect(nuevaTortilleriaSchema.safeParse(sinTelefono).success).toBe(false);
    expect(nuevaTortilleriaSchema.safeParse({ ...base, telefono: "" }).success).toBe(false);
    expect(nuevaTortilleriaSchema.safeParse({ ...base, telefono: "55123456" }).success).toBe(false);
    expect(nuevaTortilleriaSchema.safeParse({ ...base, telefono: "5512345678" }).success).toBe(true);
  });
  it("valida teléfono y correo si se escriben", () => {
    expect(nuevaTortilleriaSchema.safeParse({ ...base, telefono: "123" }).success).toBe(false);
    expect(nuevaTortilleriaSchema.safeParse({ ...base, correo: "no-es-correo" }).success).toBe(false);
    expect(nuevaTortilleriaSchema.safeParse({ ...base, correo: "tortas@ejemplo.com", telefono: "5512345678" }).success).toBe(true);
  });
  it("los demás campos son obligatorios", () => {
    for (const campo of ["nombre", "localidad", "calle", "numeroExt", "colonia", "codigoPostal", "personalOcupado", "tipoVial", "lat", "lng"]) {
      const { [campo]: _quitado, ...resto } = base as Record<string, unknown>;
      expect(nuevaTortilleriaSchema.safeParse(resto).success, campo).toBe(false);
    }
  });
  it("el código postal es de 5 dígitos", () => {
    expect(nuevaTortilleriaSchema.safeParse({ ...base, codigoPostal: "0970" }).success).toBe(false);
    expect(nuevaTortilleriaSchema.safeParse({ ...base, codigoPostal: "097000" }).success).toBe(false);
  });
  it("acepta 'SN' como número exterior y solo los valores de las listas", () => {
    expect(nuevaTortilleriaSchema.parse({ ...base, numeroExt: "sn" }).numeroExt).toBe("SN");
    expect(nuevaTortilleriaSchema.safeParse({ ...base, tipoVial: "RUTA" }).success).toBe(false);
    expect(nuevaTortilleriaSchema.safeParse({ ...base, personalOcupado: "mucha gente" }).success).toBe(false);
    expect(TIPOS_VIAL[0]).toBe("CALLE");
    expect(PERSONAL_OCUPADO).toHaveLength(7);
  });
});

describe("normalización de texto", () => {
  it("mayúsculas y sin acentos, conserva la Ñ", () => {
    expect(normalizarTexto("José Ángel Núñez")).toBe("JOSE ANGEL NUÑEZ");
    expect(normalizarTexto("Peña")).toBe("PEÑA");
  });
  it("el esquema del nombre normaliza", () => {
    expect(nombreSchema.parse("  María-José ")).toBe("MARIA-JOSE");
    expect(nombreSchema.safeParse("Ana2").success).toBe(false);
  });
});

describe("registro de cuenta", () => {
  const base = { correo: "Ana@Correo.com", password: "abc123", confirmar: "abc123" };
  it("acepta correo, contraseña de 6+ y confirmación igual", () => {
    const r = registroSchema.safeParse(base);
    expect(r.success && r.data.correo).toBe("ana@correo.com");
  });
  it("rechaza contraseña corta", () => expect(registroSchema.safeParse({ ...base, password: "12345", confirmar: "12345" }).success).toBe(false));
  it("rechaza confirmación distinta", () => expect(registroSchema.safeParse({ ...base, confirmar: "otra123" }).success).toBe(false));
  it("rechaza correo inválido", () => expect(registroSchema.safeParse({ ...base, correo: "ana@" }).success).toBe(false));
});

describe("precio con centavos y RFC con fecha real", () => {
  it("el precio acepta hasta 2 decimales", () => {
    for (const ok of [15, 15.1, 15.12, 24.5, 5, 60]) expect(precioSchema.safeParse(ok).success, String(ok)).toBe(true);
    for (const mal of [15.125, 50.999, 24.501, 4.999]) expect(precioSchema.safeParse(mal).success, String(mal)).toBe(false);
  });

  it("el RFC rechaza meses y días que no existen", () => {
    const f = (rfc: string, tipoPersona: "fisica" | "moral" = "fisica") => fiscalSchema.safeParse({ tipoPersona, rfc, razonSocial: "Juan Pérez" });
    expect(f("ABCD660000123").success).toBe(false); // mes 00, día 00 (el ejemplo de la prueba)
    expect(f("ZZZZ000000123").success).toBe(false);
    expect(f("PEPA801301AB1").success).toBe(false); // mes 13
    expect(f("PEPA800132AB1").success).toBe(false); // día 32
    expect(f("PEPA800431AB1").success).toBe(false); // abril no tiene 31
    expect(f("PEPA800230AB1").success).toBe(false); // febrero no tiene 30
    expect(f("PEPA800229AB1").success).toBe(true); // 29 de febrero sí puede existir
    expect(f("PEPA801231AB1").success).toBe(true);
    expect(f("TGU101301AB1", "moral").success).toBe(false);
    expect(f("TGU100101AB1", "moral").success).toBe(true);
    expect(f("XAXX010101000").success).toBe(true); // RFC genérico del público en general
  });

  it("el mensaje de error explica qué pasa", () => {
    const r = fiscalSchema.safeParse({ tipoPersona: "fisica", rfc: "ABCD660000123", razonSocial: "Juan Pérez" });
    expect(!r.success && r.error.issues[0].message).toContain("fecha del RFC");
    expect(rfcFechaValida("PEPA800101AB1", "fisica")).toBe(true);
  });
});
