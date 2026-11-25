import { z } from "zod";

/**
 * C21 · Cuestionario de supervisión de tortillerías (versión v1).
 * Las respuestas se guardan en CÓDIGO; los textos son solo para pantalla. La app, la API y la descarga usan estos mismos catálogos.
 * El orden de las preguntas es fijo: A (lo observa el censador) → B (preguntas al encargado) → C (sensibles, al final).
 */
export const CUESTIONARIO_VERSION = "v1";

type Op = { readonly clave: string; readonly texto: string };
const claves = <T extends readonly Op[]>(l: T) => l.map((o) => o.clave) as unknown as [T[number]["clave"], ...T[number]["clave"][]];
/** Respuestas que se ofrecieron en la primera versión y ya no (los registros anteriores las conservan) */
export const CODIGOS_ANTERIORES: Record<string, string> = { NO_SABE: "No sabe", NO_RESPONDE: "Prefiere no responder" };
export const textoDe = (l: readonly Op[], c: string | null | undefined) => l.find((o) => o.clave === c)?.texto ?? (c ? CODIGOS_ANTERIORES[c] : undefined) ?? c ?? "";

/* ---------------- Bloque A — lo observa el censador ---------------- */

export const UBICACION_TIPO = [
  { clave: "INDEPENDIENTE", texto: "Local independiente (en la calle)" },
  { clave: "MERCADO", texto: "Dentro de un mercado público" },
  { clave: "TIENDA", texto: "Dentro de una tienda o autoservicio" },
  { clave: "OTRO", texto: "Otro" },
] as const;

/** Cada punto se responde Sí/No. `col` es la columna de la base de datos y de la descarga. */
export const HIGIENE_PUNTOS = [
  { clave: "H_LIMPIEZA", texto: "El área donde se hace la tortilla se ve limpia (piso, paredes, máquina)", col: "limpieza" },
  { clave: "H_PLAGAS", texto: "No se ven moscas, cucarachas ni rastros de roedores", col: "plagas" },
  { clave: "H_INSUMOS", texto: "El maíz, la masa o la harina están tapados y no están en el piso", col: "insumos" },
  { clave: "H_PERSONAL", texto: "El personal trae ropa limpia y no come ni fuma donde trabaja", col: "personal" },
  { clave: "H_BASURA", texto: "La basura está en botes con tapa", col: "basura" },
] as const;
export type PuntoHigiene = (typeof HIGIENE_PUNTOS)[number]["clave"];

/* ---------------- Bloque B — preguntas al encargado ---------------- */

export const INSUMO = [
  { clave: "MAIZ_PROPIO", texto: "Muele su propio maíz (nixtamal)" },
  { clave: "MASA_COMPRADA", texto: "Compra la masa a un molino" },
  { clave: "HARINA", texto: "Usa harina de maíz" },
  { clave: "MEZCLA", texto: "Mezcla masa y harina" },
  { clave: "OTRO", texto: "Otro" },
  { clave: "NO_SABE", texto: "No sabe" },
] as const;

export const VOLUMEN_SEMANAL = [
  { clave: "V_0_250", texto: "Menos de 250 kg" },
  { clave: "V_250_500", texto: "De 250 a 500 kg" },
  { clave: "V_500_1000", texto: "De 500 kg a 1 tonelada" },
  { clave: "V_1000_3000", texto: "De 1 a 3 toneladas" },
  { clave: "V_3000_MAS", texto: "Más de 3 toneladas" },
  { clave: "NO_SABE", texto: "No sabe" },
  { clave: "NO_RESPONDE", texto: "Prefiere no responder" },
] as const;

/** El texto de B2 cambia según lo que respondió en B1 (las opciones son las mismas) */
export function textoB2(b1?: string | null): string {
  switch (b1) {
    case "MAIZ_PROPIO": return "¿Cuántos kilos de maíz compra a la semana?";
    case "MASA_COMPRADA": return "¿Cuántos kilos de masa compra a la semana?";
    case "HARINA": return "¿Cuántos kilos de harina compra a la semana?";
    case "MEZCLA": return "¿Cuántos kilos de masa y harina compra a la semana, en total?";
    case "OTRO": return "¿Cuántos kilos de insumo compra a la semana?";
    default: return "¿Cuántos kilos de insumo compra a la semana?";
  }
}

export const PROPIEDAD = [
  { clave: "FAMILIAR", texto: "De quien atiende o de su familia" },
  { clave: "VARIAS_SUCURSALES", texto: "El dueño tiene varias tortillerías" },
  { clave: "EMPRESA", texto: "Es franquicia o de una empresa" },
  { clave: "OTRO", texto: "Otro" },
  { clave: "NO_SABE", texto: "No sabe" },
] as const;

export const NUM_TRABAJADORES = [
  { clave: "T_1", texto: "1" },
  { clave: "T_2_3", texto: "2 a 3" },
  { clave: "T_4_6", texto: "4 a 6" },
  { clave: "T_7_MAS", texto: "7 o más" },
] as const;

export const CONOCE_ACUERDO = [
  { clave: "ADHERIDA", texto: "Sí, está adherida" },
  { clave: "CONOCE_NO_ADHERIDA", texto: "Lo conoce, pero no está adherida" },
  { clave: "NO_CONOCE", texto: "No lo conoce" },
] as const;

/** B6 · `col` es la columna Sí/No de la descarga */
export const MOTIVO_NO_ADHESION = [
  { clave: "PRECIO", texto: "El precio no le conviene", col: "b6_precio" },
  { clave: "BODEGA_LEJOS", texto: "La bodega para recoger el maíz está lejos", col: "b6_bodega_lejos" },
  { clave: "CANTIDAD_MINIMA", texto: "Le piden comprar mucho maíz de una vez (camión de 10 toneladas o más)", col: "b6_cantidad_minima" },
  { clave: "PAGO_ADELANTADO", texto: "No puede pagar por adelantado", col: "b6_pago_adelantado" },
  { clave: "TRAMITE", texto: "El trámite es complicado", col: "b6_tramite" },
  { clave: "USA_HARINA", texto: "Usa harina o masa, no maíz", col: "b6_usa_harina" },
  { clave: "OTRO", texto: "Otro", col: "b6_otro" },
] as const;

/** B8 · `NINGUNO` es exclusivo */
export const APOYOS = [
  { clave: "JCF", texto: "Jóvenes Construyendo el Futuro", col: "b8_jcf" },
  { clave: "CREDITO", texto: "Crédito (FIRA, FINABIEN u otro)", col: "b8_credito" },
  { clave: "OTRO", texto: "Otro", col: "b8_otro" },
  { clave: "NINGUNO", texto: "Ninguno", col: "b8_ninguno" },
] as const;

/** B6 solo si B5 = "Lo conoce, pero no está adherida"; B7 si no está adherida (la conozca o no) */
export const aplicaB6 = (b5?: string | null) => b5 === "CONOCE_NO_ADHERIDA";
export const aplicaB7 = (b5?: string | null) => b5 === "CONOCE_NO_ADHERIDA" || b5 === "NO_CONOCE";

/* ---------------- Bloque C — sensibles (al final, nunca se prellenan) ---------------- */

export const LICENCIA = [
  { clave: "SI_VISIBLE", texto: "Sí, está visible o la mostró" },
  { clave: "SI_NO_MOSTRO", texto: "Dice que sí, pero no la mostró" },
  { clave: "NO", texto: "No tiene" },
  { clave: "NO_RESPONDE", texto: "Prefiere no responder" },
] as const;

export const IMSS = [
  { clave: "TODAS", texto: "Todas" },
  { clave: "ALGUNAS", texto: "Algunas" },
  { clave: "NINGUNA", texto: "Ninguna" },
  { clave: "NO_RESPONDE", texto: "Prefiere no responder" },
] as const;

export const DECLARACION_ANUAL = [
  { clave: "SI", texto: "Sí" },
  { clave: "NO", texto: "No" },
  { clave: "NO_SABE", texto: "No sabe" },
  { clave: "NO_RESPONDE", texto: "Prefiere no responder" },
] as const;

/* ---------------- "No se pudo aplicar" ---------------- */

export const MOTIVO_NO_APLICA = [
  { clave: "NO_QUISO", texto: "No quiso responder" },
  { clave: "SIN_ENCARGADO", texto: "No estaba el encargado" },
  { clave: "CERRADA", texto: "Estaba cerrada" },
  { clave: "INSEGURIDAD", texto: "Inseguridad en la zona" },
  { clave: "OTRO", texto: "Otro" },
] as const;
export const textoMotivoNoAplica = (c: string | null | undefined) => textoDe(MOTIVO_NO_APLICA, c);

/* ---------------- Textos de las preguntas (pantalla y diccionario de datos) ---------------- */

export const PREGUNTAS = {
  a1: "¿Dónde está la tortillería?",
  a2: "Higiene — ¿Qué observas?",
  b1: "¿Con qué hace la tortilla?",
  b2: "¿Cuánto compra a la semana?",
  b3: "¿De quién es el negocio?",
  b4: "¿Cuántas personas trabajan aquí, contando al dueño?",
  b5: "¿Conoce el Acuerdo Maíz-Tortilla?",
  b6: "¿Por qué no se ha adherido?",
  b7: "¿Le interesa recibir información para adherirse?",
  b8: "¿Recibe algún otro apoyo o participa en algún programa?",
  c1: "¿Tiene licencia de funcionamiento?",
  c2: "¿Las personas que trabajan aquí están dadas de alta en el IMSS?",
  c3: "¿Presenta su declaración anual ante el SAT?",
} as const;

/* ---------------- Esquemas ---------------- */

const fecha = z.string().datetime({ offset: true }).optional();
const meta = {
  idCliente: z.string().uuid().optional(),
  capturadoEn: fecha,
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  precisionGps: z.number().min(0).max(100000).optional(),
};
const requerido = "Responde esta pregunta";
const unica = <T extends readonly Op[]>(l: T) => z.enum(claves(l), { errorMap: () => ({ message: requerido }) });
const sinRepetidos = <T>(a: T[]) => new Set(a).size === a.length;

export const respuestasSchema = z
  .object({
    a1: unica(UBICACION_TIPO),
    /** con A1 = "Otro": dónde está (texto libre) */
    a1Otro: z.string().trim().max(100, "Máximo 100 caracteres").optional(),
    /** con B1 = "Otro": con qué hace la tortilla */
    b1Otro: z.string().trim().max(100, "Máximo 100 caracteres").optional(),
    /** con B3 = "Otro": de quién es el negocio */
    b3Otro: z.string().trim().max(100, "Máximo 100 caracteres").optional(),
    a2: z.object(Object.fromEntries(HIGIENE_PUNTOS.map((h) => [h.clave, z.boolean({ required_error: requerido, invalid_type_error: requerido })])) as Record<PuntoHigiene, z.ZodBoolean>),
    b1: unica(INSUMO),
    b2: unica(VOLUMEN_SEMANAL),
    b3: unica(PROPIEDAD),
    b4: unica(NUM_TRABAJADORES),
    b5: unica(CONOCE_ACUERDO),
    b6: z.array(z.enum(claves(MOTIVO_NO_ADHESION))).optional(),
    b6Otro: z.string().trim().max(100, "Máximo 100 caracteres").optional(),
    b7: z.boolean().optional(),
    b8: z.array(z.enum(claves(APOYOS))).min(1, requerido).refine(sinRepetidos, "Opción repetida"),
    /** con B8 = "Otro": cuál apoyo o programa (texto libre) */
    b8Otro: z.string().trim().max(100, "Máximo 100 caracteres").optional(),
    c1: unica(LICENCIA),
    c2: unica(IMSS),
    c3: unica(DECLARACION_ANUAL),
  })
  .strict()
  .superRefine((r, ctx) => {
    // Cada "Otro" lleva su texto (y el texto solo va si se marcó "Otro")
    if (r.a1 === "OTRO" && !r.a1Otro) ctx.addIssue({ code: "custom", path: ["a1Otro"], message: "Escribe dónde está" });
    if (r.a1 !== "OTRO" && r.a1Otro) ctx.addIssue({ code: "custom", path: ["a1Otro"], message: "Solo si marcó \"Otro\"" });
    for (const [k, t] of [["b1", "b1Otro"], ["b3", "b3Otro"]] as const) {
      if (r[k] === "OTRO" && !r[t]) ctx.addIssue({ code: "custom", path: [t], message: "Escribe cuál" });
      if (r[k] !== "OTRO" && r[t]) ctx.addIssue({ code: "custom", path: [t], message: "Solo si marcó \"Otro\"" });
    }
    if (r.b8.includes("OTRO") && !r.b8Otro) ctx.addIssue({ code: "custom", path: ["b8Otro"], message: "Escribe cuál apoyo o programa" });
    if (!r.b8.includes("OTRO") && r.b8Otro) ctx.addIssue({ code: "custom", path: ["b8Otro"], message: "Solo si marcó \"Otro\"" });
    // B6 solo cuando aplica; con "Otro", su texto
    if (aplicaB6(r.b5)) {
      if (!r.b6?.length) ctx.addIssue({ code: "custom", path: ["b6"], message: "Marca al menos un motivo" });
      else if (!sinRepetidos(r.b6)) ctx.addIssue({ code: "custom", path: ["b6"], message: "Opción repetida" });
      const conOtro = r.b6?.includes("OTRO");
      if (conOtro && !r.b6Otro) ctx.addIssue({ code: "custom", path: ["b6Otro"], message: "Escribe el otro motivo" });
      if (!conOtro && r.b6Otro) ctx.addIssue({ code: "custom", path: ["b6Otro"], message: "Solo si marcó \"Otro\"" });
    } else if (r.b6?.length || r.b6Otro) ctx.addIssue({ code: "custom", path: ["b6"], message: "B6 no aplica con esa respuesta de B5" });
    // B7 solo cuando aplica
    if (aplicaB7(r.b5)) {
      if (r.b7 === undefined) ctx.addIssue({ code: "custom", path: ["b7"], message: requerido });
    } else if (r.b7 !== undefined) ctx.addIssue({ code: "custom", path: ["b7"], message: "B7 no aplica con esa respuesta de B5" });
    // "Ninguno" es exclusivo
    if (r.b8.includes("NINGUNO") && r.b8.length > 1) ctx.addIssue({ code: "custom", path: ["b8"], message: "\"Ninguno\" no va con otras opciones" });
  });
export type Respuestas = z.infer<typeof respuestasSchema>;
/** Lo que se prellena al actualizar: solo los bloques A y B (el C nunca sale del servidor) */
export type RespuestasAB = Omit<Respuestas, "c1" | "c2" | "c3">;
/** Tamaño máximo de los textos de "Otro" */
export const MAX_OTRO = 100;

export const cuestionarioSchema = z
  .discriminatedUnion("estatus", [
    z.object({ estatus: z.literal("aplicado"), respuestas: respuestasSchema, ...meta }).strict(),
    z
      .object({
        estatus: z.literal("no_aplicado"),
        motivo: z.enum(claves(MOTIVO_NO_APLICA), { errorMap: () => ({ message: "Elige el motivo" }) }),
        motivoOtro: z.preprocess(
          (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
          z.string().trim().min(5, "Especifica el motivo (mínimo 5 caracteres)").max(100, "Máximo 100 caracteres").optional(),
        ),
        ...meta,
      })
      .strict(),
  ])
  .superRefine((d, ctx) => {
    if (d.estatus !== "no_aplicado") return;
    if (d.motivo === "OTRO" && !d.motivoOtro) ctx.addIssue({ code: "custom", path: ["motivoOtro"], message: "Especifica el motivo" });
    if (d.motivo !== "OTRO" && d.motivoOtro) ctx.addIssue({ code: "custom", path: ["motivoOtro"], message: "Solo si el motivo es \"Otro\"" });
  });
export type CuestionarioInput = z.infer<typeof cuestionarioSchema>;

/**
 * Deja las respuestas listas para guardar: borra B6/B7 cuando dejaron de aplicar y el texto de "Otro" cuando ya no está marcado.
 * Se usa en la pantalla antes de validar y enviar (regla de C21.3).
 */
export function limpiarCondicionales<T extends Partial<Respuestas>>(r: T): T {
  const x: Partial<Respuestas> = { ...r };
  if (!aplicaB6(x.b5)) { delete x.b6; delete x.b6Otro; }
  else if (!x.b6?.includes("OTRO")) delete x.b6Otro;
  if (!aplicaB7(x.b5)) delete x.b7;
  if (x.a1 !== "OTRO") delete x.a1Otro;
  if (x.b1 !== "OTRO") delete x.b1Otro;
  if (x.b3 !== "OTRO") delete x.b3Otro;
  if (!x.b8?.includes("OTRO")) delete x.b8Otro;
  return x as T;
}

/** B8: marcar "Ninguno" desmarca las demás; marcar otra desmarca "Ninguno" */
export function alternarApoyo(actual: readonly string[], clave: string): string[] {
  if (actual.includes(clave)) return actual.filter((c) => c !== clave);
  if (clave === "NINGUNO") return ["NINGUNO"];
  return [...actual.filter((c) => c !== "NINGUNO"), clave];
}

/** Diccionario de datos para quien analiza la descarga: pregunta → códigos y textos */
export function diccionarioCuestionario(): { columna: string; pregunta: string; codigo: string; texto: string }[] {
  const f: { columna: string; pregunta: string; codigo: string; texto: string }[] = [];
  const lista = (columna: string, pregunta: string, l: readonly Op[]) => l.forEach((o) => f.push({ columna, pregunta, codigo: o.clave, texto: o.texto }));
  const sino = (columna: string, pregunta: string) => { f.push({ columna, pregunta, codigo: "Sí", texto: "Sí" }, { columna, pregunta, codigo: "No", texto: "No" }); };
  f.push({ columna: "estatus", pregunta: "Estatus del cuestionario vigente", codigo: "aplicado", texto: "Aplicado" }, { columna: "estatus", pregunta: "Estatus del cuestionario vigente", codigo: "no_aplicado", texto: "No se pudo aplicar" }, { columna: "estatus", pregunta: "Estatus del cuestionario vigente", codigo: "(vacío)", texto: "Visitada, sin cuestionario" });
  lista("motivo_no_aplica", "Motivo por el que no se pudo aplicar", MOTIVO_NO_APLICA);
  lista("a1_ubicacion", `A1. ${PREGUNTAS.a1}`, UBICACION_TIPO);
  f.push({ columna: "a1_otro_texto", pregunta: "A1. Texto de \"Otro\" (dónde está)", codigo: "(texto libre)", texto: "Máximo 100 caracteres" });
  HIGIENE_PUNTOS.forEach((h) => sino(`a2_h_${h.col}`, `A2. Higiene: ${h.texto}`));
  lista("b1_insumo", `B1. ${PREGUNTAS.b1}`, INSUMO);
  f.push({ columna: "b1_otro_texto", pregunta: "B1. Texto de \"Otro\" (con qué hace la tortilla)", codigo: "(texto libre)", texto: "Máximo 100 caracteres" });
  lista("b2_volumen", `B2. ${PREGUNTAS.b2} (el texto cambia según B1: maíz, masa, harina o ambos)`, VOLUMEN_SEMANAL);
  lista("b3_propiedad", `B3. ${PREGUNTAS.b3}`, PROPIEDAD);
  f.push({ columna: "b3_otro_texto", pregunta: "B3. Texto de \"Otro\" (de quién es el negocio)", codigo: "(texto libre)", texto: "Máximo 100 caracteres" });
  lista("b4_trabajadores", `B4. ${PREGUNTAS.b4}`, NUM_TRABAJADORES);
  lista("b5_conoce_acuerdo", `B5. ${PREGUNTAS.b5}`, CONOCE_ACUERDO);
  MOTIVO_NO_ADHESION.forEach((m) => sino(m.col, `B6. ${PREGUNTAS.b6} (solo si B5 = CONOCE_NO_ADHERIDA): ${m.texto}`));
  f.push({ columna: "b6_otro_texto", pregunta: "B6. Texto del otro motivo", codigo: "(texto libre)", texto: "Máximo 100 caracteres" });
  sino("b7_interes", `B7. ${PREGUNTAS.b7} (solo si B5 = NO_CONOCE o CONOCE_NO_ADHERIDA)`);
  APOYOS.forEach((a) => sino(a.col, `B8. ${PREGUNTAS.b8}: ${a.texto}`));
  f.push({ columna: "b8_otro_texto", pregunta: "B8. Texto de \"Otro\" (cuál apoyo o programa)", codigo: "(texto libre)", texto: "Máximo 100 caracteres" });
  lista("c1_licencia", `C1. ${PREGUNTAS.c1}`, LICENCIA);
  lista("c2_imss", `C2. ${PREGUNTAS.c2}`, IMSS);
  lista("c3_declaracion", `C3. ${PREGUNTAS.c3}`, DECLARACION_ANUAL);
  return f;
}
