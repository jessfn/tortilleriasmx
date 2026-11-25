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
  /** clave del motivo del último intento sin datos fiscales (si lo hubo) */
  ultima_negativa?: string | null;
  /** ¿ya tiene foto? Si no, la primera visita debe traerla. undefined = no se sabe (catálogo viejo): no se exige. */
  tiene_foto?: boolean;
  /** cómo hacen la tortilla (maquina, mano, ambas); null = aún sin dato. Sirve para preseleccionarlo sin conexión. */
  elaboracion?: string | null;
  /** C21: estatus del cuestionario (aplicado, no_aplicado o null = falta). Solo el estatus: nunca las respuestas. */
  cuestionario_estatus?: "aplicado" | "no_aplicado" | null;
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
  /** "No se obtuvieron los datos fiscales" (con su motivo). Un paquete lleva `fiscal` o `sinFiscal`, nunca los dos. */
  sinFiscal?: { motivo: string; motivoOtro?: string; idCliente: string };
  /** Tortillería que ya existía y aún no tenía foto: la foto del frente, o el motivo de por qué no se pudo (nunca las dos) */
  fotoExistente?: { idCliente: string; archivo?: Blob };
  sinFoto?: { motivo: string; motivoOtro?: string; idCliente: string };
  /** Tipo de elaboración de una tortillería que ya existía (solo si no lo tenía o es distinto). Se envía antes de los precios. */
  elaboracion?: { valor: string; idCliente: string };
  /** "Ya no funciona": paquete de baja (sin precios). La tortillería queda inactiva en cuanto llega al servidor. */
  baja?: { motivo: string; motivoOtro?: string; idCliente: string };
  /**
   * C21: cuestionario de supervisión. Se envía DESPUÉS de los precios. Un paquete solo de cuestionario (sin precios) es válido.
   * Las respuestas (que incluyen el bloque C, sensible) se borran del teléfono en cuanto el servidor las recibe.
   */
  cuestionario?: { estatus: "aplicado" | "no_aplicado"; respuestas?: Record<string, unknown>; motivo?: string; motivoOtro?: string; idCliente: string };
  precios: Precio[];
  gps?: { lat: number; lng: number; precision?: number };
  hecho: { tortilleria?: boolean; foto?: boolean; fiscal?: boolean; sinFiscal?: boolean; fotoExistente?: boolean; sinFoto?: boolean; elaboracion?: boolean; baja?: boolean; cuestionario?: boolean };
  /** parecidas que encontró el servidor (conflicto de duplicado) */
  posibles?: { id: string; nombre: string; domicilio: string | null }[];
};

interface Esquema extends DBSchema {
  catalogo: { key: string; value: RegistroCatalogo };
  bandeja: { key: string; value: Paquete };
  kv: { key: string; value: unknown };
}

/**
 * Algunos navegadores no dejan usar IndexedDB (modo privado, cookies o datos del sitio bloqueados, página abierta dentro de otra app o sin https):
 * "IDBFactory.open() called in an invalid security context". En ese caso la app NO se detiene: se guarda en la memoria de la pestaña.
 * Con señal todo sale igual (la captura se envía de inmediato); lo único que se pierde es el trabajo sin conexión y las copias del teléfono,
 * y lo guardado solo dura mientras la pestaña esté abierta.
 */
export let almacenamientoEnMemoria = false;
type Base = IDBPDatabase<Esquema>;
function baseEnMemoria(): Base {
  const t: Record<string, Map<unknown, unknown>> = { catalogo: new Map(), bandeja: new Map(), kv: new Map() };
  const llave = (tabla: string, valor: any, k?: unknown) => (k !== undefined ? k : tabla === "catalogo" ? valor.clave : valor.id);
  const copia = <T,>(v: T): T => (typeof structuredClone === "function" ? structuredClone(v) : v);
  return {
    get: async (tabla: string, k: unknown) => copia(t[tabla].get(k)),
    getAll: async (tabla: string) => [...t[tabla].values()].map(copia),
    put: async (tabla: string, valor: unknown, k?: unknown) => {
      const clave = llave(tabla, valor, k);
      t[tabla].set(clave, copia(valor));
      return clave;
    },
    delete: async (tabla: string, k: unknown) => void t[tabla].delete(k),
    clear: async (tabla: string) => void t[tabla].clear(),
  } as unknown as Base;
}

let conexion: Promise<Base> | null = null;

export function abrir(): Promise<Base> {
  conexion ??= Promise.resolve()
    .then(() =>
      openDB<Esquema>("tortilleriasmx", 1, {
        upgrade(db) {
          db.createObjectStore("catalogo", { keyPath: "clave" });
          db.createObjectStore("bandeja", { keyPath: "id" });
          db.createObjectStore("kv");
        },
      }),
    )
    .catch(() => {
      almacenamientoEnMemoria = true;
      return baseEnMemoria();
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
