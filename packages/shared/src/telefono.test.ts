import { describe, it, expect } from "vitest";
import { armarTelefono, esTelefonoValido, formatearNacional, formatearTelefono, maxDigitos, normalizarTelefono, PAIS_MX, PAISES, paisDe, partirTelefono } from "./telefono.js";
import { fiscalSchema, nuevaTortilleriaSchema, telefonoSchema } from "./validaciones.js";

const pais = (iso: string) => PAISES.find((p) => p.iso === iso)!;

describe("teléfono con país", () => {
  it("normaliza: espacios, guiones, paréntesis y +52", () => {
    expect(normalizarTelefono("55 1234 5678")).toBe("5512345678");
    expect(normalizarTelefono("+52 (55) 1234-5678")).toBe("5512345678");
    expect(normalizarTelefono("0014155552671")).toBe("+14155552671");
    expect(normalizarTelefono("+1 (415) 555-2671")).toBe("+14155552671");
  });

  it("valida México (10 dígitos) y otros países (+código y número)", () => {
    for (const ok of ["5512345678", "+14155552671", "+34612345678", "+50255551234"]) expect(esTelefonoValido(ok), ok).toBe(true);
    for (const mal of ["551234567", "55123456789", "+5255123", "+1415", "+0123456789", "abc", "", "+525512345678"]) expect(esTelefonoValido(mal), mal).toBe(false);
  });

  it("detecta el país de un número guardado", () => {
    expect(paisDe("5512345678").iso).toBe("MX");
    expect(paisDe("+14155552671").lada).toBe("1");
    expect(paisDe("+50255551234").iso).toBe("GT"); // 502 (Guatemala) gana sobre 5…
    expect(partirTelefono("+34612345678")).toEqual({ pais: pais("ES"), digitos: "612345678" });
    expect(partirTelefono("5512345678").digitos).toBe("5512345678");
  });

  it("arma el valor que se guarda", () => {
    expect(armarTelefono(PAIS_MX, "5512345678")).toBe("5512345678");
    expect(armarTelefono(pais("ES"), "612345678")).toBe("+34612345678");
    expect(armarTelefono(pais("ES"), "")).toBe("");
    expect(maxDigitos(PAIS_MX)).toBe(10);
    expect(maxDigitos(pais("US"))).toBe(10);
    expect(maxDigitos(pais("GT"))).toBe(12);
  });

  it("se ve como un teléfono, también mientras se escribe", () => {
    expect(formatearNacional("5512345678", PAIS_MX)).toBe("55 1234 5678");
    expect(formatearNacional("7441234567", PAIS_MX)).toBe("744 123 4567"); // lada de 3 dígitos
    expect(formatearNacional("551", PAIS_MX)).toBe("55 1");
    expect(formatearNacional("55123", PAIS_MX)).toBe("55 123");
    expect(formatearNacional("4155552671", pais("US"))).toBe("(415) 555-2671");
    expect(formatearNacional("415", pais("US"))).toBe("415");
    expect(formatearNacional("612345678", pais("ES"))).toBe("612 345 678");
  });

  it("muestra el número guardado completo con su lada", () => {
    expect(formatearTelefono("5512345678")).toBe("+52 55 1234 5678");
    expect(formatearTelefono("+14155552671")).toBe("+1 (415) 555-2671");
    expect(formatearTelefono("+34612345678")).toBe("+34 612 345 678");
    expect(formatearTelefono("******5678")).toBe("******5678"); // enmascarado por el servidor
    expect(formatearTelefono(null)).toBe("");
  });

  it("los esquemas aceptan números de otros países y guardan la forma canónica", () => {
    expect(telefonoSchema.parse("+1 (415) 555-2671")).toBe("+14155552671");
    expect(telefonoSchema.parse("+52 55 1234 5678")).toBe("5512345678");
    expect(telefonoSchema.safeParse("12345").success).toBe(false);
    const f = fiscalSchema.parse({ tipoPersona: "fisica", rfc: "pepa800101ab1", razonSocial: "José Pérez", celular: "+34 612 345 678" });
    expect(f.celular).toBe("+34612345678");
    const base = {
      nombre: "Tortillería La Guadalupe", estadoClave: "09", municipioClave: "09015", localidad: "Ciudad de México", tipoVial: "CALLE", calle: "Hidalgo",
      numeroExt: "123", colonia: "Centro", codigoPostal: "09700", personalOcupado: "0 a 5 personas", lat: 19.43, lng: -99.13,
    };
    expect(nuevaTortilleriaSchema.parse({ ...base, telefono: "+502 5555 1234" }).telefono).toBe("+50255551234");
    expect(nuevaTortilleriaSchema.safeParse({ ...base, telefono: "+502" }).success).toBe(false);
  });
});
