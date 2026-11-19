import pg from "pg";

/**
 * Ninguna consulta debe tardar minutos: una consulta lenta del mapa que se acumula (cada movimiento del mapa lanza otra) llena la base de datos
 * y deja sin respuesta a toda la app. Pasado este tiempo la base la cancela y el servidor responde con error.
 */
const TIEMPO_MAX_CONSULTA_MS = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000);

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, statement_timeout: TIEMPO_MAX_CONSULTA_MS });

export async function auditar(usuarioId: string | null, accion: string, entidad?: string, entidadId?: string) {
  await pool.query("INSERT INTO auditoria(usuario_id, accion, entidad, entidad_id) VALUES ($1,$2,$3,$4)", [
    usuarioId,
    accion,
    entidad ?? null,
    entidadId ?? null,
  ]);
}
