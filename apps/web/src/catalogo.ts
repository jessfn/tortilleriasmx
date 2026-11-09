import { api } from "./api";
import { abrir, kvGuardar, kvLeer, type Local, type RegistroCatalogo } from "./bd";

/**
 * Catálogo de tortillerías por ESTADO guardado en el teléfono. Con él se elige por cercanía, se busca y se ve el mapa sin internet.
 * La cercanía se calcula aquí con el GPS (que sí funciona sin señal) y la fórmula de Haversine.
 */

export const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function distanciaM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Respuesta =
  | { sinCambios: true; version: string }
  | { version: string; columnas: string[]; filas: (string | number | null)[][] };

/** Lo descargado (en memoria, para consultar rápido) + lo capturado en este teléfono que todavía no llega al servidor */
let descargadas: RegistroCatalogo[] = [];
let temporales: Local[] = [];
let todos: Local[] = [];
const oyentes = new Set<() => void>();

function recomponer() {
  const ids = new Set<string>();
  todos = [];
  for (const t of temporales) {
    ids.add(t.id);
    todos.push(t);
  }
  for (const c of descargadas) for (const p of c.puntos) if (!ids.has(p.id)) todos.push(p);
  oyentes.forEach((f) => f());
}
export function alCambiarCatalogo(f: () => void) {
  oyentes.add(f);
  return () => void oyentes.delete(f);
}

/** Carga a memoria lo guardado en el teléfono (se llama al abrir la app) */
export async function cargarCatalogoLocal() {
  try {
    descargadas = await (await abrir()).getAll("catalogo");
  } catch {
    descargadas = [];
  }
  recomponer();
}

export function ponerTemporales(lista: Local[]) {
  temporales = lista;
  recomponer();
}

export const estadosDescargados = () => descargadas.map(({ clave, nombre, version, descargado, puntos }) => ({ clave, nombre, version, descargado, total: puntos.length }));
export const hayCatalogo = () => descargadas.length > 0;

function aLocales(clave: string, r: Extract<Respuesta, { filas: unknown }>): Local[] {
  const i = Object.fromEntries(r.columnas.map((c, n) => [c, n]));
  return r.filas.map((f) => ({
    id: f[i.id] as string,
    nombre: f[i.nombre] as string,
    domicilio: (f[i.domicilio] as string | null) ?? null,
    lat: f[i.lat] as number,
    lng: f[i.lng] as number,
    estatus: f[i.estatus] === 1 ? "pendiente" : "validada",
    razon_social: (f[i.razon_social] as string | null) ?? null,
    municipio_clave: f[i.municipio_clave] as string,
    tiene_fiscal: f[i.tiene_fiscal] === 1,
    estado_clave: clave,
  }));
}

/** Descarga (o actualiza) un estado. Devuelve false si ya estaba al día. */
export async function descargarEstado(clave: string, nombre?: string): Promise<boolean> {
  const actual = descargadas.find((d) => d.clave === clave);
  const r = await api<Respuesta>(`/catalogo/estado/${clave}${actual ? `?version=${encodeURIComponent(actual.version)}` : ""}`);
  if ("sinCambios" in r) {
    if (actual) {
      actual.descargado = new Date().toISOString();
      await (await abrir()).put("catalogo", actual);
      recomponer();
    }
    return false;
  }
  const reg: RegistroCatalogo = {
    clave,
    nombre: nombre ?? actual?.nombre ?? clave,
    version: r.version,
    descargado: new Date().toISOString(),
    puntos: aLocales(clave, r),
  };
  await (await abrir()).put("catalogo", reg);
  descargadas = [...descargadas.filter((d) => d.clave !== clave), reg];
  recomponer();
  return true;
}

export async function quitarEstado(clave: string) {
  await (await abrir()).delete("catalogo", clave);
  descargadas = descargadas.filter((d) => d.clave !== clave);
  recomponer();
}

/** Revisa la versión de cada estado descargado y baja solo los que cambiaron */
export async function actualizarCatalogos(): Promise<number> {
  let n = 0;
  for (const d of [...descargadas]) {
    try {
      if (await descargarEstado(d.clave, d.nombre)) n++;
    } catch {
      return n; // sin red: se intenta de nuevo después
    }
  }
  return n;
}

/** Marca localmente que una tortillería ya tiene datos fiscales (sin esperar a la siguiente descarga) */
export async function marcarFiscalLocal(id: string) {
  for (const c of descargadas) {
    const p = c.puntos.find((x) => x.id === id);
    if (p && !p.tiene_fiscal) {
      p.tiene_fiscal = true;
      try {
        await (await abrir()).put("catalogo", c);
      } catch {
        /* se corrige en la siguiente descarga */
      }
    }
  }
  const t = temporales.find((x) => x.id === id);
  if (t) t.tiene_fiscal = true;
  recomponer();
}

/* ---------------- consultas sobre lo que hay en el teléfono ---------------- */

/** ¿Hay datos locales para esta zona? (algún punto a menos de 30 km) */
export function cubre(c: { lat: number; lng: number }, kmMax = 30): boolean {
  if (!todos.length) return false;
  const d = kmMax / 111;
  return todos.some((p) => Math.abs(p.lat - c.lat) < d && Math.abs(p.lng - c.lng) < d * 1.2);
}

export function enCaja(w: number, s: number, e: number, n: number, max = 5000): Local[] | "demasiadas" {
  const r: Local[] = [];
  for (const p of todos) {
    if (p.lng < w || p.lng > e || p.lat < s || p.lat > n) continue;
    if (r.length >= max) return "demasiadas";
    r.push(p);
  }
  return r;
}

export type ConDistancia = Local & { distancia_m: number | null };

function coincide(p: Local, q: string) {
  return norm(`${p.nombre} ${p.domicilio ?? ""}`).includes(q);
}

/** Cercanas a una posición, de la más cercana a la más lejana. `km` 0 = sin radio. */
export function cercanas(pos: { lat: number; lng: number }, km: number, texto = "", limite = 10000): ConDistancia[] {
  const q = norm(texto.trim());
  const maxM = km > 0 ? km * 1000 : Infinity;
  const dg = km > 0 ? km / 111 + 0.001 : Infinity;
  const r: ConDistancia[] = [];
  for (const p of todos) {
    if (Math.abs(p.lat - pos.lat) > dg) continue;
    const d = distanciaM(pos, p);
    if (d > maxM) continue;
    if (q && !coincide(p, q)) continue;
    r.push({ ...p, distancia_m: d });
  }
  return r.sort((a, b) => a.distancia_m! - b.distancia_m!).slice(0, limite);
}

export function delMunicipio(municipio: string, texto = "", pos?: { lat: number; lng: number }, limite = 10000): ConDistancia[] {
  const q = norm(texto.trim());
  const r = todos.filter((p) => p.municipio_clave === municipio && (!q || coincide(p, q))).map((p) => ({ ...p, distancia_m: pos ? distanciaM(pos, p) : null }));
  return r.sort((a, b) => (a.distancia_m ?? 0) - (b.distancia_m ?? 0) || a.nombre.localeCompare(b.nombre)).slice(0, limite);
}

/** Búsqueda por nombre o calle alrededor de un punto (o en todo el catálogo si no hay punto) */
export function buscar(texto: string, ref?: { lat: number; lng: number }, limite = 30): ConDistancia[] {
  const q = norm(texto.trim());
  if (q.length < 2) return [];
  const r: ConDistancia[] = [];
  for (const p of todos) if (coincide(p, q)) r.push({ ...p, distancia_m: ref ? distanciaM(ref, p) : null });
  return r.sort((a, b) => (a.distancia_m ?? 0) - (b.distancia_m ?? 0)).slice(0, limite);
}

/** La tortillería local más cercana: da el estado y municipio para precargar el formulario de una nueva */
export function masCercana(pos: { lat: number; lng: number }): { estado: string; municipio: string } | null {
  let mejor: Local | null = null;
  let md = Infinity;
  for (const p of todos) {
    if (!p.municipio_clave) continue;
    const d = distanciaM(pos, p);
    if (d < md) {
      md = d;
      mejor = p;
    }
  }
  return mejor && md < 60000 ? { estado: mejor.estado_clave, municipio: mejor.municipio_clave } : null;
}

/** Posibles duplicados de una tortillería nueva: a 50 m o menos y con el mismo nombre */
export function parecidas(pos: { lat: number; lng: number }, nombre: string): Local[] {
  const n = norm(nombre.trim());
  return todos.filter((p) => norm(p.nombre.trim()) === n && distanciaM(pos, p) <= 50);
}

export function porId(id: string): Local | undefined {
  return todos.find((p) => p.id === id);
}

/* ---------------- listas de estados y municipios (sirven también sin conexión) ---------------- */

export type Item = { clave: string; nombre: string };

/** Con conexión se actualizan; sin ella se usa la última copia guardada */
export async function listaEstados(): Promise<Item[]> {
  try {
    const r = await api<Item[]>("/estados");
    void kvGuardar("estados", r);
    return r;
  } catch (e) {
    const g = await kvLeer<Item[]>("estados");
    if (g?.length) return g;
    throw e;
  }
}
export async function listaMunicipios(estado: string): Promise<Item[]> {
  try {
    const r = await api<Item[]>(`/estados/${estado}/municipios`);
    void kvGuardar(`municipios_${estado}`, r);
    return r;
  } catch (e) {
    const g = await kvLeer<Item[]>(`municipios_${estado}`);
    if (g?.length) return g;
    throw e;
  }
}
