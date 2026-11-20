import { pool } from "./db.js";

/** Fecha de corte inicial (miércoles 25 de noviembre de 2026, 00:00 hora de México). Solo es el valor de arranque: la vigente vive en la tabla `configuracion`. */
export const CORTE_POR_OMISION = "2026-11-25T00:00:00-06:00";
export const CLAVE_CORTE = "corte_registro_abierto";

/** La fecha de corte vigente (se lee en cada registro: cambiarla no requiere publicar una versión nueva) */
export async function leerCorte(): Promise<Date> {
  const { rows } = await pool.query("SELECT valor FROM configuracion WHERE clave = $1", [CLAVE_CORTE]);
  const d = new Date(rows[0]?.valor ?? CORTE_POR_OMISION);
  return Number.isNaN(d.getTime()) ? new Date(CORTE_POR_OMISION) : d;
}

/** "2026-11-25T00:00" (hora de México) → instante. México no tiene horario de verano: siempre UTC-6. */
export function corteDesdeHoraMexico(texto: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(texto)) return null;
  const d = new Date(`${texto}:00-06:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Un instante como "2026-11-25T00:00" en hora de México (para el campo de fecha y hora del panel) */
export function aHoraMexico(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
