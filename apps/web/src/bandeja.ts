import { api, ApiError, leerSesion } from "./api";
import { abrir, diaMexico, kvBorrar, kvGuardar, kvLeer, type Paquete, type Precio } from "./bd";
import { marcarFiscalLocal, ponerTemporales } from "./catalogo";
import type { Local } from "./bd";

/**
 * Bandeja de pendientes: todo lo que se captura pasa por aquí, con o sin conexión (un solo camino).
 * Funciona como la bandeja de salida del correo: se guarda en el teléfono y sale solo cuando hay señal.
 * Orden de envío por paquete: tortillería nueva → foto → datos fiscales → precios. Un paquete a la vez, en el orden en que se capturaron.
 */

export const DIAS_ENVIADOS = 7; // un paquete ya enviado se borra de la bandeja después de este tiempo
const ESPERA_MIN_MS = 30_000;
const ESPERA_MAX_MS = 15 * 60_000;
const CADA_MS = 2 * 60_000;

export const NOMBRE_PRODUCTO = { maiz: "tortilla", masa: "masa" } as const;

/* ---------------- estado visible para la pantalla ---------------- */

export const estadoSync = { sincronizando: false, sinSesion: false };
const avisar = () => {
  try {
    window.dispatchEvent(new Event("bandeja"));
  } catch {
    /* sin ventana (pruebas) */
  }
};

/* ---------------- acceso a los paquetes ---------------- */

async function todos(): Promise<Paquete[]> {
  try {
    return await (await abrir()).getAll("bandeja");
  } catch {
    return [];
  }
}
async function poner(p: Paquete) {
  await (await abrir()).put("bandeja", p);
}

const porFecha = (a: Paquete, b: Paquete) => a.capturadoEn.localeCompare(b.capturadoEn);

export async function listarPaquetes(usuarioId?: string): Promise<Paquete[]> {
  const u = usuarioId ?? leerSesion()?.usuario.id;
  return (await todos()).filter((p) => p.usuarioId === u).sort(porFecha);
}

export const pideAtencion = (p: Paquete) => p.estado !== "enviado";

export async function contarPendientes(usuarioId?: string): Promise<number> {
  return (await listarPaquetes(usuarioId)).filter(pideAtencion).length;
}

/** Guarda un paquete nuevo y lo deja listo para enviarse */
export async function guardarPaquete(p: Paquete) {
  await poner(p);
  await refrescarTemporales();
  avisar();
}

/** Un reinicio con un paquete "enviando" (se cerró la app a medias) lo devuelve a la fila */
export async function recuperar() {
  for (const p of await todos()) {
    if (p.estado === "enviando") await poner({ ...p, estado: "por_enviar" });
  }
}

/** Borra los enviados con más de 7 días */
export async function limpiarEnviados() {
  const limite = Date.now() - DIAS_ENVIADOS * 24 * 3600 * 1000;
  const bd = await abrir();
  for (const p of await todos()) if (p.estado === "enviado" && p.enviadoEn && new Date(p.enviadoEn).getTime() < limite) await bd.delete("bandeja", p.id);
}

export async function descartar(id: string) {
  await (await abrir()).delete("bandeja", id);
  await refrescarTemporales();
  avisar();
}

/** Cerrar sesión: la bandeja lleva RFC y celular, así que se borra del teléfono */
export async function borrarBandejaDe(usuarioId: string) {
  const bd = await abrir();
  for (const p of await todos()) if (p.usuarioId === usuarioId) await bd.delete("bandeja", p.id);
  await refrescarTemporales();
  avisar();
}

/* ---------------- ids de tortillerías nuevas ---------------- */

export const esTemporal = (id: string) => id.startsWith("t:");
export const idTemporal = (idCliente: string) => `t:${idCliente}`;

async function idsReales(): Promise<Record<string, string>> {
  return (await kvLeer<Record<string, string>>("idsReales")) ?? {};
}
/** El id real que el servidor dio a una tortillería nueva (o el mismo id si ya era real) */
export async function idReal(id: string): Promise<string | undefined> {
  return esTemporal(id) ? (await idsReales())[id] : id;
}
async function registrarIdReal(temporal: string, real: string) {
  await kvGuardar("idsReales", { ...(await idsReales()), [temporal]: real });
}

/* ---------------- lo que ya se capturó hoy (límite de una vez al día por producto) ---------------- */

type MisFilas = { fecha: string; filas: { id: string; maiz_hoy: boolean; masa_hoy: boolean }[] };

/** Copia de "Mis tortillerías" guardada en el teléfono: sirve para el límite diario y para verlas sin conexión */
export async function guardarMisTortillerias(filas: any[]) {
  await kvGuardar("misTortillerias", { fecha: diaMexico(), guardadoEn: new Date().toISOString(), usuarioId: leerSesion()?.usuario.id, filas });
}
export async function leerMisTortillerias<T = any>(): Promise<{ fecha: string; guardadoEn?: string; usuarioId?: string; filas: T[] } | undefined> {
  const m = await kvLeer<{ fecha: string; guardadoEn?: string; usuarioId?: string; filas: T[] }>("misTortillerias");
  return m && m.usuarioId === leerSesion()?.usuario.id ? m : undefined;
}

/** Productos que este usuario ya capturó HOY en esa tortillería según el teléfono: la bandeja y la última copia del servidor */
export async function capturadoHoyLocal(tortilleriaId: string, usuarioId = leerSesion()?.usuario.id): Promise<{ maiz: number | null; masa: number | null }> {
  const r: { maiz: number | null; masa: number | null } = { maiz: null, masa: null };
  if (!usuarioId) return r;
  const hoy = diaMexico();
  const reales = await idsReales();
  for (const p of await todos()) {
    if (p.usuarioId !== usuarioId || p.estado === "error") continue;
    const tid = esTemporal(p.tortilleria.id) ? (reales[p.tortilleria.id] ?? p.tortilleria.id) : p.tortilleria.id;
    if (tid !== tortilleriaId && p.tortilleria.id !== tortilleriaId) continue;
    if (diaMexico(p.capturadoEn) !== hoy) continue;
    for (const pr of p.precios) if (pr.estado !== "conflicto") r[pr.producto] = pr.precioKg;
  }
  const m = await leerMisTortillerias<{ id: string; maiz_hoy: boolean; masa_hoy: boolean; ultimo_maiz?: { precio: number; fecha: string }; ultima_masa?: { precio: number; fecha: string } }>();
  if (m && m.fecha === hoy) {
    const f = m.filas.find((x) => x.id === tortilleriaId);
    if (f?.maiz_hoy && r.maiz === null) r.maiz = f.ultimo_maiz?.precio ?? 0;
    if (f?.masa_hoy && r.masa === null) r.masa = f.ultima_masa?.precio ?? 0;
  }
  return r;
}

/* ---------------- tortillerías nuevas visibles en el mapa local ---------------- */

export async function refrescarTemporales() {
  const u = leerSesion()?.usuario.id;
  const reales = await idsReales();
  const lista: Local[] = [];
  for (const p of await todos()) {
    if (p.usuarioId !== u || !p.nueva || p.estado === "error") continue;
    const d = p.nueva.datos as { estadoClave?: string; municipioClave?: string };
    const real = reales[p.tortilleria.id];
    lista.push({
      id: real ?? p.tortilleria.id,
      nombre: p.tortilleria.nombre,
      domicilio: p.tortilleria.domicilio,
      lat: p.tortilleria.lat,
      lng: p.tortilleria.lng,
      estatus: p.hecho.tortilleria ? "pendiente" : "porenviar",
      razon_social: null,
      municipio_clave: d.municipioClave ?? "",
      estado_clave: d.estadoClave ?? "",
      tiene_fiscal: !!p.fiscal,
    });
  }
  ponerTemporales(lista);
}

/* ---------------- envío ---------------- */

const esperaMs = (intentos: number) => Math.min(ESPERA_MIN_MS * 2 ** Math.max(intentos - 1, 0), ESPERA_MAX_MS);

type Resultado = "seguir" | "parar";

async function enviarPaquete(p: Paquete): Promise<Resultado> {
  let etapa = "tortilleria";
  const reales = await idsReales();
  // Los precios de una tortillería nueva esperan a que esa tortillería llegue al servidor
  if (esTemporal(p.tortilleria.id) && !p.nueva && !reales[p.tortilleria.id]) {
    await poner({ ...p, estado: "por_enviar", mensaje: "Esperando a que llegue la tortillería nueva" });
    return "seguir";
  }
  p = { ...p, estado: "enviando", mensaje: undefined, proximoIntento: undefined };
  await poner(p);
  avisar();
  try {
    let real = esTemporal(p.tortilleria.id) ? reales[p.tortilleria.id] : p.tortilleria.id;

    // 1) tortillería nueva
    if (p.nueva && !p.hecho.tortilleria) {
      etapa = "tortilleria";
      const r = await api<{ id: string }>("/tortillerias", {
        json: { ...p.nueva.datos, idCliente: p.nueva.idCliente, ...(p.nueva.confirmoNoDuplicado ? { confirmoNoDuplicado: true } : {}) },
      });
      real = r.id;
      await registrarIdReal(p.tortilleria.id, r.id);
      p = { ...p, hecho: { ...p.hecho, tortilleria: true }, posibles: undefined };
      await poner(p);
    }
    if (!real) throw new ApiError(400, "No se encontró la tortillería de esta captura");

    // 2) foto (solo las nuevas)
    if (p.nueva && p.nueva.foto && !p.hecho.foto) {
      etapa = "foto";
      const f = new FormData();
      f.append("file", p.nueva.foto, "foto.jpg");
      await api(`/tortillerias/${real}/fotos`, { form: f, headers: { "x-id-cliente": p.nueva.fotoIdCliente } });
      p = { ...p, hecho: { ...p.hecho, foto: true }, nueva: { ...p.nueva, foto: undefined } }; // la foto ya no hace falta en el teléfono
      await poner(p);
    }

    // 3) datos fiscales (una sola vez por tortillería; el servidor no sobrescribe)
    if (p.fiscal && !p.hecho.fiscal) {
      etapa = "fiscal";
      await api(`/tortillerias/${real}/fiscal`, { json: { ...p.fiscal, celular: p.fiscal.celular || undefined } });
      await marcarFiscalLocal(real);
      p = { ...p, hecho: { ...p.hecho, fiscal: true } };
      await poner(p);
    }

    // 4) precios, uno por producto
    etapa = "precio";
    const precios: Precio[] = [...p.precios];
    for (let i = 0; i < precios.length; i++) {
      const pr = precios[i];
      if (pr.estado !== "pendiente") continue;
      try {
        await api("/precios", {
          json: {
            tortilleriaId: real, producto: pr.producto, precioKg: pr.precioKg, idCliente: pr.idCliente, capturadoEn: p.capturadoEn,
            ...(p.gps ? { lat: p.gps.lat, lng: p.gps.lng, precisionGps: p.gps.precision } : {}),
          },
        });
        precios[i] = { ...pr, estado: "enviado" };
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409)) throw e;
        precios[i] = { ...pr, estado: "conflicto", mensaje: `Ya habías capturado ${NOMBRE_PRODUCTO[pr.producto]} ese día en esta tortillería.` };
      }
      p = { ...p, precios };
      await poner(p);
    }

    const hayConflicto = precios.some((x) => x.estado === "conflicto");
    p = {
      ...p, precios, estado: hayConflicto ? "conflicto" : "enviado", intentos: 0,
      mensaje: hayConflicto ? precios.find((x) => x.estado === "conflicto")!.mensaje : undefined,
      enviadoEn: hayConflicto ? undefined : new Date().toISOString(),
    };
    await poner(p);
    await refrescarTemporales();
    return "seguir";
  } catch (e) {
    const intentos = p.intentos + 1;
    if (e instanceof ApiError) {
      if (e.status === 401) {
        estadoSync.sinSesion = true;
        await poner({ ...p, estado: "por_enviar" }); // todo se conserva; se envía al volver a iniciar sesión
        return "parar";
      }
      if (e.status === 429) {
        await poner({ ...p, estado: "por_enviar", proximoIntento: Date.now() + (e.reintentarEnSeg ?? 60) * 1000, mensaje: "Muchos envíos seguidos: se reintentará en un momento" });
        return "parar";
      }
      if (e.status === 0 || e.status >= 500) {
        await poner({ ...p, estado: "por_enviar", intentos, proximoIntento: Date.now() + esperaMs(intentos), mensaje: undefined });
        return "parar";
      }
      if (e.status === 409 && etapa === "tortilleria" && e.cuerpo?.posibles) {
        await poner({ ...p, estado: "conflicto", posibles: e.cuerpo.posibles, mensaje: "Ya existe una tortillería parecida en ese lugar." });
        return "seguir";
      }
      // 400, 404, 413, 415…: el servidor no la acepta; el censador decide (nada se borra solo)
      await poner({ ...p, estado: "error", mensaje: e.message });
      return "seguir";
    }
    await poner({ ...p, estado: "por_enviar", intentos, proximoIntento: Date.now() + esperaMs(intentos) });
    return "parar";
  }
}

let corriendo: Promise<void> | null = null;

/** Envía lo pendiente del usuario que tiene la sesión abierta. `forzar` ignora las esperas ("Enviar ahora"). */
export function sincronizar(opc: { forzar?: boolean } = {}): Promise<void> {
  if (corriendo) return corriendo;
  corriendo = (async () => {
    estadoSync.sincronizando = true;
    avisar();
    try {
      const s = leerSesion();
      if (!s) return;
      estadoSync.sinSesion = false;
      const fila = (await listarPaquetes(s.usuario.id)).filter((p) => p.estado === "por_enviar" || p.estado === "enviando");
      for (const p of fila) {
        if (!opc.forzar && p.proximoIntento && p.proximoIntento > Date.now()) break; // se conserva el orden: no se salta al siguiente
        if ((await enviarPaquete(p)) === "parar") break;
      }
    } finally {
      corriendo = null;
      estadoSync.sincronizando = false;
      avisar();
    }
  })();
  return corriendo;
}

/* ---------------- acciones del censador sobre un conflicto ---------------- */

/** "Era la misma": los precios y datos fiscales pasan a la tortillería que ya existe y se descarta la nueva */
export async function usarExistente(id: string, existente: { id: string; nombre: string; domicilio: string | null; lat?: number; lng?: number }) {
  const p = (await todos()).find((x) => x.id === id);
  if (!p?.nueva) return;
  await registrarIdReal(p.tortilleria.id, existente.id);
  await poner({
    ...p, estado: "por_enviar", mensaje: undefined, posibles: undefined, nueva: undefined, intentos: 0, proximoIntento: undefined,
    tortilleria: { ...p.tortilleria, id: existente.id, nombre: existente.nombre, domicilio: existente.domicilio },
  });
  await refrescarTemporales();
  avisar();
  void sincronizar({ forzar: true });
}

/** "Es otra, enviar de todos modos" */
export async function enviarDeTodosModos(id: string) {
  const p = (await todos()).find((x) => x.id === id);
  if (!p?.nueva) return;
  await poner({ ...p, estado: "por_enviar", mensaje: undefined, posibles: undefined, intentos: 0, proximoIntento: undefined, nueva: { ...p.nueva, confirmoNoDuplicado: true } });
  avisar();
  void sincronizar({ forzar: true });
}

export async function reintentar(id: string) {
  const p = (await todos()).find((x) => x.id === id);
  if (!p) return;
  await poner({ ...p, estado: "por_enviar", mensaje: undefined, intentos: 0, proximoIntento: undefined });
  avisar();
  void sincronizar({ forzar: true });
}

/* ---------------- cuándo se intenta enviar ---------------- */

let iniciada = false;
/** Al abrir la app, al volver la señal, cada 2 minutos y al volver a la pestaña */
export function iniciarSincronizacion() {
  if (iniciada) return;
  iniciada = true;
  void recuperar()
    .then(limpiarEnviados)
    .then(refrescarTemporales)
    .then(() => sincronizar());
  window.addEventListener("online", () => void sincronizar({ forzar: true }));
  window.addEventListener("sesion-iniciada", () => void sincronizar({ forzar: true }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void sincronizar();
  });
  window.setInterval(() => void sincronizar(), CADA_MS);
}

export async function borrarTodoLocal() {
  const bd = await abrir();
  await bd.clear("bandeja");
  await kvBorrar("idsReales");
  await kvBorrar("misTortillerias");
  await refrescarTemporales();
  avisar();
}
