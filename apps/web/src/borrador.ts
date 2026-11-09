import { kvBorrar, kvGuardar, kvLeer } from "./bd";

/**
 * Registro a medias del asistente. Se guarda en IndexedDB (no en sessionStorage) para que sobreviva aunque se cierre la app o se apague
 * el teléfono, y puede llevar la foto como archivo. La contraseña nunca se guarda. Se borra al terminar y al cerrar sesión.
 */
const CLAVE = "borrador";

export type BorradorGuardado<T> = T & { usuarioId: string | null; actualizado: string };

/** Solo devuelve el borrador si es de quien tiene la sesión (o de quien aún no tiene cuenta) */
export async function leerBorrador<T>(usuarioId: string | null): Promise<T | null> {
  const b = await kvLeer<BorradorGuardado<T>>(CLAVE);
  if (!b || b.usuarioId !== usuarioId) return null;
  return b;
}

export async function guardarBorrador<T extends object>(usuarioId: string | null, b: T): Promise<boolean> {
  return kvGuardar(CLAVE, { ...b, usuarioId, actualizado: new Date().toISOString() });
}

export const borrarBorrador = () => kvBorrar(CLAVE);

/** ¿Hay un registro a medias? (para ofrecer "Continuar" en el panel) */
export async function resumenBorrador(usuarioId: string | null): Promise<{ nombre?: string; pasoId?: string } | null> {
  const b = await kvLeer<BorradorGuardado<{ d?: { tortilleria?: { nombre?: string }; nv?: { nombre?: string } }; pasoId?: string }>>(CLAVE);
  if (!b || b.usuarioId !== usuarioId) return null;
  return { nombre: b.d?.tortilleria?.nombre || b.d?.nv?.nombre || undefined, pasoId: b.pasoId };
}
