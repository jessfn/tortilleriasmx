const BASE = import.meta.env.VITE_API_URL ?? "https://apitortillerias.geodatos.com.mx";
const KEY = "tmx_sesion";

export type Sesion = { token: string; usuario: { id: string; nombre: string; apellidos: string; rol: string } };

export function leerSesion(): Sesion | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as Sesion) : null;
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
  constructor(public status: number, message: string, public cuerpo?: any) {
    super(message);
  }
}

export async function api<T = any>(
  ruta: string,
  op: { metodo?: string; json?: unknown; form?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const s = leerSesion();
  if (s) headers.authorization = `Bearer ${s.token}`;
  if (op.json !== undefined) headers["content-type"] = "application/json";
  let r: Response;
  try {
    r = await fetch(BASE + ruta, {
      method: op.metodo ?? (op.json || op.form ? "POST" : "GET"),
      headers,
      body: op.form ?? (op.json !== undefined ? JSON.stringify(op.json) : undefined),
    });
  } catch {
    throw new ApiError(0, "Sin conexión con el servidor");
  }
  const cuerpo = await r.json().catch(() => null);
  if (r.status === 401 && s && ruta !== "/auth/login") {
    guardarSesion(null);
    window.dispatchEvent(new Event("sesion-expirada"));
  }
  if (!r.ok) throw new ApiError(r.status, cuerpo?.error ?? "Error del servidor", cuerpo);
  return cuerpo as T;
}
