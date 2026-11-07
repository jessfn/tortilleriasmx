import { useEffect, useState } from "react";

/**
 * Estado que sobrevive a una recarga de la página (por ejemplo, al actualizarse la app sola).
 * Se guarda en sessionStorage: se borra al cerrar la pestaña/app y al cerrar sesión,
 * así los datos personales de una captura a medias no quedan guardados en el dispositivo.
 */
const PREFIJO = "tmx_";
export const CLAVES = { vista: "vista", borrador: "borrador", tabUsuario: "tab_usuario", tabAdmin: "tab_admin" } as const;

export function leer<T>(clave: string): T | null {
  try {
    const s = sessionStorage.getItem(PREFIJO + clave);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

/** Devuelve false si no se pudo guardar (por ejemplo, almacenamiento lleno) */
export function guardar(clave: string, valor: unknown): boolean {
  try {
    sessionStorage.setItem(PREFIJO + clave, JSON.stringify(valor));
    return true;
  } catch {
    return false;
  }
}

export function borrar(clave: string) {
  try {
    sessionStorage.removeItem(PREFIJO + clave);
  } catch {
    /* sin almacenamiento */
  }
}

export function borrarTodo() {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(PREFIJO))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* sin almacenamiento */
  }
}

export function usePersistente<T>(clave: string, inicial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => leer<T>(clave) ?? inicial);
  useEffect(() => {
    guardar(clave, v);
  }, [clave, v]);
  return [v, setV];
}
