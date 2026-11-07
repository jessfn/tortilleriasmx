import { describe, it, expect } from "vitest";
import { curpSchema, telefonoSchema, precioSchema, responsableSchema } from "./validaciones.js";

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
      nombre: "Ana",
      apellidos: "Pérez",
      curp: "HEGG560427MVZRRL04",
      telefono: "5512345678",
      tipoPersona: "moral",
      rfc: "ABC010101AB1",
    });
    expect(r.success).toBe(false);
  });
});
