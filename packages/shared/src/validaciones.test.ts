import { describe, it, expect } from "vitest";
import {
  curpSchema, telefonoSchema, precioSchema, responsableSchema, normalizarTexto, registroSchema, nombreSchema,
} from "./validaciones.js";

describe("validaciones", () => {
  it("CURP válida", () => expect(curpSchema.safeParse("HEGG560427MVZRRL04").success).toBe(true));
  it("CURP inválida", () => expect(curpSchema.safeParse("ABC").success).toBe(false));
  it("teléfono 10 dígitos", () => {
    expect(telefonoSchema.safeParse("5512345678").success).toBe(true);
    expect(telefonoSchema.safeParse("551234567").success).toBe(false);
  });
  it("precio en rango", () => {
    expect(precioSchema.safeParse(24).success).toBe(true);
    expect(precioSchema.safeParse(2).success).toBe(false);
    expect(precioSchema.safeParse(100).success).toBe(false);
  });
  it("persona moral exige razón social", () => {
    const r = responsableSchema.safeParse({
      nombre: "Ana", apellidos: "Pérez", curp: "HEGG560427MVZRRL04", telefono: "5512345678",
      tipoPersona: "moral", rfc: "ABC010101AB1",
    });
    expect(r.success).toBe(false);
  });
});

describe("normalización de texto", () => {
  it("mayúsculas y sin acentos, conserva la Ñ", () => {
    expect(normalizarTexto("José Ángel Núñez")).toBe("JOSE ANGEL NÚÑEZ".replace("Ú", "U"));
    expect(normalizarTexto("Peña")).toBe("PEÑA");
  });
  it("el esquema del nombre normaliza", () => {
    expect(nombreSchema.parse("  María-José ")).toBe("MARIA-JOSE");
    expect(nombreSchema.safeParse("Ana2").success).toBe(false);
  });
  it("el responsable se guarda normalizado", () => {
    const r = responsableSchema.parse({
      nombre: "José", apellidos: "Pérez", curp: "hegg560427mvzrrl04", telefono: "5512345678",
      tipoPersona: "fisica", rfc: "pepa800101ab1",
    });
    expect([r.nombre, r.apellidos, r.curp, r.rfc]).toEqual(["JOSE", "PEREZ", "HEGG560427MVZRRL04", "PEPA800101AB1"]);
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
