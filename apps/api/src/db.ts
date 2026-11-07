import pg from "pg";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

export async function auditar(usuarioId: string, accion: string, entidad?: string, entidadId?: string) {
  await pool.query("INSERT INTO auditoria(usuario_id, accion, entidad, entidad_id) VALUES ($1,$2,$3,$4)", [
    usuarioId,
    accion,
    entidad ?? null,
    entidadId ?? null,
  ]);
}
