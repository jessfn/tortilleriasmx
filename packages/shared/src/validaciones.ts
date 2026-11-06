import { z } from "zod";

export const CURP_REGEX =
  /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;
export const RFC_FISICA_REGEX = /^[A-ZÑ&]{4}\d{6}[A-Z\d]{3}$/;
export const RFC_MORAL_REGEX = /^[A-ZÑ&]{3}\d{6}[A-Z\d]{3}$/;
export const NOMBRE_REGEX = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[ '\-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)*$/;

export const PRECIO_MIN = 5;
export const PRECIO_MAX = 60;

const nombre = z.string().trim().min(1, "Obligatorio").regex(NOMBRE_REGEX, "Solo letras");

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

export const responsableSchema = z
  .object({
    nombre,
    apellidos: nombre,
    curp: curpSchema,
    telefono: telefonoSchema,
    tipoPersona: z.enum(["fisica", "moral"]),
    rfc: z.string().trim().toUpperCase(),
    razonSocial: z.string().trim().optional(),
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
