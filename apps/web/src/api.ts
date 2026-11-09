const BASE = import.meta.env.VITE_API_URL ?? "https://apitortillerias.geodatos.com.mx";
/**
 * Dos accesos separados: /acceso es el panel administrativo (administración y supervisión) y el resto de la app es para quienes
 * registran tortillerías. Cada uno guarda su propia sesión, así entrar por un lado no abre el otro.
 */
export const ES_ADMIN = typeof location !== "undefined" && location.pathname.startsWith("/acceso");
const KEY = ES_ADMIN ? "tmx_sesion_admin" : "tmx_sesion";
/** ¿Esta cuenta corresponde a este acceso? Las del personal solo entran por /acceso; las de tortillerías, por el acceso normal */
export const cuentaDeEsteAcceso = (rol: Rol) => (ES_ADMIN ? rol !== "capturista" : rol === "capturista");

export type Rol = "capturista" | "supervisor" | "admin";
export type Sesion = { token: string; usuario: { id: string; nombre: string; apellidos: string; rol: Rol; correo: string } };

export function leerSesion(): Sesion | null {
  try {
    const s = localStorage.getItem(KEY);
    const ses = s ? (JSON.parse(s) as Sesion) : null;
    return ses && cuentaDeEsteAcceso(ses.usuario.rol) ? ses : null;
  } catch {
    return null;
  }
}
export function guardarSesion(s: Sesion | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public cuerpo?: any, public reintentarEnSeg?: number) {
    super(message);
  }
}

/** Descarga una imagen protegida (requiere sesión) y devuelve una URL local para <img> */
export async function apiImagenUrl(ruta: string): Promise<string> {
  const s = leerSesion();
  const r = await fetch(BASE + ruta, { headers: s ? { authorization: `Bearer ${s.token}` } : {} });
  if (!r.ok) throw new ApiError(r.status, "No se pudo cargar la imagen");
  return URL.createObjectURL(await r.blob());
}

export async function api<T = any>(
  ruta: string,
  op: { metodo?: string; json?: unknown; form?: FormData; signal?: AbortSignal; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...op.headers };
  const s = leerSesion();
  if (s) headers.authorization = `Bearer ${s.token}`;
  if (op.json !== undefined) headers["content-type"] = "application/json";
  let r: Response;
  try {
    r = await fetch(BASE + ruta, {
      method: op.metodo ?? (op.json !== undefined || op.form ? "POST" : "GET"),
      headers,
      body: op.form ?? (op.json !== undefined ? JSON.stringify(op.json) : undefined),
      signal: op.signal,
    });
  } catch {
    throw new ApiError(0, "Sin conexión con el servidor");
  }
  const cuerpo = await r.json().catch(() => null);
  if (r.status === 401 && s && ruta !== "/auth/login") {
    guardarSesion(null);
    window.dispatchEvent(new Event("sesion-expirada"));
  }
  if (!r.ok) {
    const ra = Number(r.headers.get("retry-after"));
    throw new ApiError(r.status, cuerpo?.error ?? "Error del servidor", cuerpo, Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  return cuerpo as T;
}
