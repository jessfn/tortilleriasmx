import type { FastifyRequest } from "fastify";
import { pool } from "./db.js";

/**
 * Alcance por estado (C20). UNA sola función decide qué ve cada cuenta:
 *  - null  → sin límite (administrador, supervisor o administrador estatal con alcance nacional)
 *  - lista → solo esas claves de estado (administrador estatal)
 * Toda ruta que usa el rol `estatal` filtra con esto. Lo que queda fuera del alcance responde 404 (no se revela que existe).
 */
export const alcanceDe = (req: FastifyRequest): string[] | null => req.user.alcance;

/** Condición SQL para filtrar por estado según el alcance: pasa la lista (o null) en el parámetro `$n` */
export const enAlcanceSql = (columna: string, n: number) => `($${n}::text[] IS NULL OR ${columna} = ANY($${n}::text[]))`;

/** Un administrador estatal (aunque sea de alcance nacional) NO ve a los censadores sin estado: esos solo los ve DGTIC */
export const soloConEstado = (req: FastifyRequest) => req.user.rol === "estatal";

/** ¿La tortillería está dentro del alcance de quien pide? (administrador, supervisor y estatal nacional: siempre) */
export async function tortilleriaVisible(req: FastifyRequest, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`SELECT 1 FROM tortillerias t WHERE t.id = $1 AND ${enAlcanceSql("t.estado_clave", 2)}`, [id, alcanceDe(req)]);
  return !!rowCount;
}

/** ¿El censador está dentro del alcance? (por el estado del CENSADOR; sin estado solo lo ve quien no tiene límite) */
export async function censadorVisible(req: FastifyRequest, id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`SELECT 1 FROM usuarios u WHERE u.id = $1 AND u.rol = 'capturista' AND ${enAlcanceSql("u.estado_clave", 2)} AND ($3::boolean IS NOT TRUE OR u.estado_clave IS NOT NULL)`, [id, alcanceDe(req), soloConEstado(req)]);
  return !!rowCount;
}

/** ¿Puede cambiar o asignar este estado? (el estatal solo dentro de su alcance) */
export const estadoPermitido = (req: FastifyRequest, clave: string) => {
  const a = alcanceDe(req);
  return a === null || a.includes(clave);
};
