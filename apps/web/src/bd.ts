import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * Almacenamiento del teléfono (IndexedDB) para trabajar sin conexión:
 *  - catalogo: las tortillerías de cada estado descargado
 *  - bandeja:  lo capturado, "por enviar" o ya enviado
 *  - kv:       borrador del asistente, listas de estados/municipios, copia de "Mis tortillerías"…
 * Nunca se usa localStorage/sessionStorage para esto: tienen poco espacio y no guardan fotos.
 */

export type Local = {
  id: string;
  nombre: string;
  domicilio: string | null;
  lat: number;
  lng: number;
  /** pendiente = "por validar" · porenviar = alta hecha en este teléfono que aún no llega al servidor */
  estatus: string;
  razon_social: string | null;
  municipio_clave: string;
  tiene_fiscal: boolean;
  estado_clave: string;
};

export type RegistroCatalogo = { clave: string; nombre: string; version: string; descargado: string; puntos: Local[] };

export type EstadoPaquete = "por_enviar" | "enviando" | "enviado" | "conflicto" | "error";

export type Precio = { producto: "maiz" | "masa"; precioKg: number; idCliente: string; estado: "pendiente" | "enviado" | "conflicto"; mensaje?: string };

export type Paquete = {
  id: string;
  usuarioId: string;
  /** hora del teléfono al capturar (ISO 8601): de aquí sale el día del precio */
  capturadoEn: string;
  estado: EstadoPaquete;
  mensaje?: string;
  intentos: number;
  /** no reintentar antes de esta hora (ms desde 1970) */
  proximoIntento?: number;
  enviadoEn?: string;
  /** tortillería a la que van los precios: id real o temporal (`t:<idCliente>`) si es nueva y aún no llega al servidor */
  tortilleria: { id: string; nombre: string; domicilio: string | null; lat: number; lng: number };
  nueva?: { idCliente: string; datos: Record<string, unknown>; fotoIdCliente: string; foto?: Blob; confirmoNoDuplicado?: boolean };
  fiscal?: { tipoPersona: string; rfc: string; razonSocial: string; celular?: string; aceptoAviso: boolean };
  precios: Precio[];
  gps?: { lat: number; lng: number; precision?: number };
  hecho: { tortilleria?: boolean; foto?: boolean; fiscal?: boolean };
  /** parecidas que encontró el servidor (conflicto de duplicado) */
  posibles?: { id: string; nombre: string; domicilio: string | null }[];
};

interface Esquema extends DBSchema {
  catalogo: { key: string; value: RegistroCatalogo };
  bandeja: { key: string; value: Paquete };
  kv: { key: string; value: unknown };
}

let conexion: Promise<IDBPDatabase<Esquema>> | null = null;

export function abrir() {
  conexion ??= openDB<Esquema>("tortilleriasmx", 1, {
    upgrade(db) {
      db.createObjectStore("catalogo", { keyPath: "clave" });
      db.createObjectStore("bandeja", { keyPath: "id" });
      db.createObjectStore("kv");
    },
  }).catch((e) => {
    conexion = null; // si falla (p. ej. modo privado) se puede reintentar
    throw e;
  });
  return conexion;
}

/** Pide que el navegador no borre estos datos cuando le falte espacio */
export function pedirAlmacenamientoPersistente() {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* no disponible */
  }
}

export async function kvLeer<T>(clave: string): Promise<T | undefined> {
  try {
    return (await (await abrir()).get("kv", clave)) as T | undefined;
  } catch {
    return undefined;
  }
}
export async function kvGuardar(clave: string, valor: unknown): Promise<boolean> {
  try {
    await (await abrir()).put("kv", valor, clave);
    return true;
  } catch {
    return false;
  }
}
export async function kvBorrar(clave: string) {
  try {
    await (await abrir()).delete("kv", clave);
  } catch {
    /* sin almacenamiento */
  }
}

/** Fecha de hoy en hora de México (AAAA-MM-DD): el día en que cuenta el límite de una captura por producto */
export function diaMexico(cuando: Date | string | number = Date.now()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(cuando));
  return p; // en-CA ya da AAAA-MM-DD
}

export function nuevoId(): string {
  return crypto.randomUUID();
}
