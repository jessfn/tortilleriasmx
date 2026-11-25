export type Caso = "mapa" | "actualizar" | "cuestionario";

/**
 * Pasos del asistente según el caso:
 *  A) tortillería existente:  [estado → municipio, solo sin GPS] → tortilleria (mapa) → [fiscal, si no los tiene] → precio → [cuenta] → resumen
 *  B) tortillería nueva:      [estado → municipio] → tortilleria (mapa + pin) → nueva → foto → fiscal → precio → [cuenta] → resumen
 *  C) actualizar precio:      [fiscal, si no los tiene] → precio → [cuestionario] → resumen
 *  D) solo cuestionario:      cuestionario → resumen
 * El cuestionario (C21) va después del precio si la tortillería no tiene uno aplicado (o el último fue "no se pudo aplicar"),
 * o si el censador tocó "Actualizar" en el resumen. Se aplica una sola vez por tortillería.
 */
export function armarPasos(o: { caso: Caso; zonaManual: boolean; nueva: boolean; faltaFiscal: boolean; conCuenta: boolean; pideCuest: boolean }): string[] {
  // D) solo el cuestionario (tortillerías ya censadas, desde "Mis tortillerías"): no pide precio
  if (o.caso === "cuestionario") return ["cuestionario", "resumen"];
  const cuest = o.pideCuest ? ["cuestionario"] : [];
  if (o.caso === "actualizar") return [...(o.faltaFiscal ? ["fiscal"] : []), "precio", ...cuest, "resumen"];
  return [
    ...(o.zonaManual ? ["estado", "municipio"] : []),
    "tortilleria",
    ...(o.nueva ? ["nueva", "foto", "fiscal"] : o.faltaFiscal ? ["fiscal"] : []),
    "precio",
    ...cuest,
    ...(o.conCuenta ? ["cuenta"] : []),
    "resumen",
  ];
}

