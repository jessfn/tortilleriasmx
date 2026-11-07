import { z } from "zod";

export const CURP_REGEX =
  /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;
export const RFC_FISICA_REGEX = /^[A-ZÑ&]{4}\d{6}[A-Z\d]{3}$/;
export const RFC_MORAL_REGEX = /^[A-ZÑ&]{3}\d{6}[A-Z\d]{3}$/;
export const NOMBRE_REGEX = /^[A-ZÑ]+(?:[ '\-][A-ZÑ]+)*$/;

export const PRECIO_MIN = 5;
export const PRECIO_MAX = 60;
export const PASSWORD_MIN = 6;

/** Mayúsculas y sin acentos (conserva la Ñ, que es una letra y no un acento). */
export function normalizarTexto(s: string): string {
  return s
    .toUpperCase()
    .replace(/Ñ/g, "\u0001")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0001/g, "Ñ");
}

export const nombreSchema = z
  .string()
  .transform((v) => normalizarTexto(v.trim()))
  .pipe(z.string().min(1, "Obligatorio").max(80).regex(NOMBRE_REGEX, "Solo letras"));

export const telefonoSchema = z.string().regex(/^\d{10}$/, "Debe tener 10 dígitos");
export const curpSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(18, "18 caracteres")
  .regex(CURP_REGEX, "CURP inválida");
export const precioSchema = z
  .number()
  .min(PRECIO_MIN, `Mínimo $${PRECIO_MIN}`)
  .max(PRECIO_MAX, `Máximo $${PRECIO_MAX}`);

export const correoSchema = z.string().trim().toLowerCase().email("Correo inválido").max(120);
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Mínimo ${PASSWORD_MIN} caracteres`)
  .max(72, "Máximo 72 caracteres");

export const registroSchema = z
  .object({ correo: correoSchema, password: passwordSchema, confirmar: z.string() })
  .refine((v) => v.password === v.confirmar, { path: ["confirmar"], message: "Las contraseñas no coinciden" });

export const perfilSchema = z.object({ nombre: nombreSchema, apellidos: nombreSchema });

export const cambioPasswordSchema = z
  .object({ actual: z.string().min(1), nueva: passwordSchema, confirmar: z.string() })
  .refine((v) => v.nueva === v.confirmar, { path: ["confirmar"], message: "Las contraseñas no coinciden" });

export const responsableSchema = z
  .object({
    nombre: nombreSchema,
    apellidos: nombreSchema,
    curp: curpSchema,
    telefono: telefonoSchema,
    tipoPersona: z.enum(["fisica", "moral"]),
    rfc: z.string().trim().toUpperCase(),
    razonSocial: z
      .string()
      .transform((v) => normalizarTexto(v.trim()))
      .optional(),
  })
  .superRefine((v, ctx) => {
    const re = v.tipoPersona === "fisica" ? RFC_FISICA_REGEX : RFC_MORAL_REGEX;
    const len = v.tipoPersona === "fisica" ? 13 : 12;
    if (v.rfc.length !== len || !re.test(v.rfc))
      ctx.addIssue({ code: "custom", path: ["rfc"], message: `RFC de ${len} caracteres` });
    if (v.tipoPersona === "moral" && !v.razonSocial)
      ctx.addIssue({ code: "custom", path: ["razonSocial"], message: "Razón social obligatoria" });
  });

export const capturaPrecioSchema = z.object({
  tortilleriaId: z.string().uuid(),
  producto: z.enum(["maiz", "harina", "masa"]),
  precioKg: precioSchema,
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  precisionGps: z.number().nonnegative().optional(),
});
