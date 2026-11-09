import { z } from "zod";

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

/** Productos que se pueden capturar (la tortilla de harina ya no se captura; las capturas viejas se siguen mostrando) */
export const PRODUCTOS = ["maiz", "masa"] as const;
export type ProductoCaptura = (typeof PRODUCTOS)[number];

export const capturaPrecioSchema = z.object({
  tortilleriaId: z.string().uuid(),
  producto: z.enum(PRODUCTOS),
  precioKg: precioSchema,
  // GPS del teléfono: solo como evidencia, nunca bloquea la captura
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  precisionGps: z.number().nonnegative().optional(),
  // Captura sin conexión: id generado en el teléfono (un reintento no duplica) y hora en que se capturó
  idCliente: z.string().uuid().optional(),
  capturadoEn: z.string().datetime({ offset: true }).optional(),
});

/* ---------------- datos fiscales (de la tortillería, no de quien captura) ---------------- */

const vacioAUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const celularOpcionalSchema = z.preprocess(vacioAUndefined, telefonoSchema.optional());

export const fiscalSchema = z
  .object({
    tipoPersona: z.enum(["fisica", "moral"]),
    rfc: z.string().trim().toUpperCase(),
    razonSocial: z
      .string()
      .transform((v) => normalizarTexto(v.trim()))
      .pipe(z.string().min(2, "Obligatorio").max(150)),
    celular: celularOpcionalSchema,
  })
  .superRefine((v, ctx) => {
    const re = v.tipoPersona === "fisica" ? RFC_FISICA_REGEX : RFC_MORAL_REGEX;
    const len = v.tipoPersona === "fisica" ? 13 : 12;
    if (v.rfc.length !== len || !re.test(v.rfc)) ctx.addIssue({ code: "custom", path: ["rfc"], message: `RFC de ${len} caracteres` });
  });

/* ---------------- tortillería nueva: mismos datos que el DENUE ---------------- */

/** Valores del DENUE (por frecuencia) */
export const TIPOS_VIAL = [
  "CALLE", "AVENIDA", "PRIVADA", "PROLONGACION", "BOULEVARD", "CARRETERA", "CALLEJON", "CALZADA", "ANDADOR", "CERRADA", "CIRCUITO",
  "EJE VIAL", "PERIFERICO", "PEATONAL", "DIAGONAL", "RETORNO", "PASAJE", "AMPLIACION", "VIADUCTO", "CONTINUACION", "AUTOPISTA",
  "CORREDOR", "CIRCUNVALACION", "OTRO(ESPECIFIQUE)",
] as const;

export const PERSONAL_OCUPADO = [
  "0 a 5 personas", "6 a 10 personas", "11 a 30 personas", "31 a 50 personas", "51 a 100 personas", "101 a 250 personas", "251 y más personas",
] as const;

const texto = (min: number, max: number, msg = "Obligatorio") =>
  z.string().transform((v) => normalizarTexto(v.trim())).pipe(z.string().min(min, msg).max(max));
const textoOpcional = (max: number) =>
  z.preprocess(vacioAUndefined, z.string().transform((v) => normalizarTexto(v.trim())).pipe(z.string().max(max)).optional());

export const nuevaTortilleriaSchema = z.object({
  nombre: texto(2, 120),
  estadoClave: z.string().min(1),
  municipioClave: z.string().min(1),
  localidad: texto(1, 120),
  tipoVial: z.enum(TIPOS_VIAL),
  calle: texto(1, 120),
  numeroExt: texto(1, 20), // "SN" = sin número
  numeroInt: textoOpcional(20),
  colonia: texto(1, 120),
  codigoPostal: z.string().regex(/^[0-9]{5}$/, "5 dígitos"),
  telefono: celularOpcionalSchema,
  correo: z.preprocess(vacioAUndefined, correoSchema.optional()),
  personalOcupado: z.enum(PERSONAL_OCUPADO),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  idCliente: z.string().uuid().optional(),
  // El censador ya vio las parecidas y confirma que es otra
  confirmoNoDuplicado: z.boolean().optional(),
});
export type NuevaTortilleria = z.infer<typeof nuevaTortilleriaSchema>;
