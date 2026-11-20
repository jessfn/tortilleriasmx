import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Lógica del teléfono: la bandeja de pendientes y el catálogo local. El servidor se simula; IndexedDB es una implementación en memoria. */
const h = vi.hoisted(() => ({ llamadas: [] as { ruta: string; cuerpo: any; headers?: any }[], respuesta: null as null | ((ruta: string, cuerpo: any) => any) }));

vi.mock("./api", () => {
  class ApiError extends Error {
    constructor(public status: number, message: string, public cuerpo?: any, public reintentarEnSeg?: number) {
      super(message);
    }
  }
  return {
    ApiError,
    leerSesion: () => ({ token: "t", usuario: { id: "u1", nombre: "", apellidos: "", rol: "capturista", correo: "a@b.c" } }),
    api: async (ruta: string, op: any = {}) => {
      h.llamadas.push({ ruta, cuerpo: op.json ?? op.form, headers: op.headers });
      const r = h.respuesta?.(ruta, op.json);
      if (r instanceof Error) throw r;
      return r ?? {};
    },
  };
});

import { ApiError } from "./api";
import { abrir, diaMexico, nuevoId, type Paquete } from "./bd";
import {
  borrarBandejaDe, borrarTodoLocal, capturadoHoyLocal, contarPendientes, descartar, enviarDeTodosModos, estadoSync, guardarPaquete, idTemporal, listarPaquetes,
  sincronizar, usarExistente,
} from "./bandeja";
import { cercanas, descargarEstado, delMunicipio, distanciaM, masCercana, parecidas, buscar, cubre, quitarEstado, enCaja, porId, quitarLocal } from "./catalogo";

const REAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let reloj = 0;
const ahora = () => new Date(Date.UTC(2026, 10, 8, 18, 0, reloj++)).toISOString(); // siempre creciente

function paquete(extra: Partial<Paquete> = {}): Paquete {
  return {
    id: nuevoId(), usuarioId: "u1", capturadoEn: ahora(), estado: "por_enviar", intentos: 0, hecho: {},
    tortilleria: { id: REAL, nombre: "LA GUERA", domicilio: "CALLE 5", lat: 19.43, lng: -99.13 },
    precios: [{ producto: "maiz", precioKg: 24, idCliente: nuevoId(), estado: "pendiente" }],
    ...extra,
  };
}

const rutas = () => h.llamadas.map((l) => l.ruta.replace(/[0-9a-f-]{36}/g, ":id"));

beforeEach(async () => {
  await borrarTodoLocal();
  const bd = await abrir();
  await bd.clear("catalogo");
  await bd.clear("kv");
  h.llamadas = [];
  h.respuesta = null;
  estadoSync.sinSesion = false;
});

describe("bandeja de pendientes", () => {
  it("envía en orden: tortillería nueva → foto → datos fiscales → precios", async () => {
    const idCliente = nuevoId();
    h.respuesta = (ruta) => (ruta === "/tortillerias" ? { id: REAL } : {});
    await guardarPaquete(
      paquete({
        tortilleria: { id: idTemporal(idCliente), nombre: "NUEVA", domicilio: null, lat: 19.5, lng: -99.2 },
        nueva: { idCliente, datos: { nombre: "NUEVA" }, fotoIdCliente: nuevoId(), foto: new Blob(["x"], { type: "image/jpeg" }) },
        fiscal: { tipoPersona: "moral", rfc: "ABC100101AB1", razonSocial: "NUEVA SA", aceptoAviso: true },
        precios: [
          { producto: "maiz", precioKg: 24, idCliente: nuevoId(), estado: "pendiente" },
          { producto: "masa", precioKg: 18, idCliente: nuevoId(), estado: "pendiente" },
        ],
      }),
    );
    await sincronizar();
    expect(rutas()).toEqual(["/tortillerias", "/tortillerias/:id/fotos", "/tortillerias/:id/fiscal", "/precios", "/precios"]);
    expect(h.llamadas[1].headers["x-id-cliente"]).toBeTruthy(); // la foto lleva su id para no duplicarse
    const [p] = await listarPaquetes();
    expect(p.estado).toBe("enviado");
    expect(p.nueva?.foto).toBeUndefined(); // la foto ya no ocupa espacio
  });

  it("la negativa de datos fiscales se envía en orden: tortillería → foto → negativa → precios (y no manda RFC)", async () => {
    const idCliente = nuevoId();
    h.respuesta = (ruta) => (ruta === "/tortillerias" ? { id: REAL } : {});
    await guardarPaquete(
      paquete({
        tortilleria: { id: idTemporal(idCliente), nombre: "NUEVA", domicilio: null, lat: 19.5, lng: -99.2 },
        nueva: { idCliente, datos: { nombre: "NUEVA" }, fotoIdCliente: nuevoId(), foto: new Blob(["x"], { type: "image/jpeg" }) },
        sinFiscal: { motivo: "otro", motivoOtro: "Esta de vacaciones", idCliente: nuevoId() },
        precios: [{ producto: "maiz", precioKg: 24, idCliente: nuevoId(), estado: "pendiente" }],
      }),
    );
    await sincronizar();
    expect(rutas()).toEqual(["/tortillerias", "/tortillerias/:id/fotos", "/tortillerias/:id/fiscal/negativa", "/precios"]);
    const neg = h.llamadas[2].cuerpo;
    expect(neg).toMatchObject({ motivo: "otro", motivoOtro: "Esta de vacaciones" });
    expect(neg.idCliente).toBeTruthy();
    expect(neg.capturadoEn).toBeTruthy();
    expect(JSON.stringify(neg)).not.toMatch(/rfc/i);
    expect((await listarPaquetes())[0].estado).toBe("enviado");
  });

  it("un reintento no vuelve a enviar la negativa que ya llegó", async () => {
    h.respuesta = () => ({});
    await guardarPaquete(paquete({ sinFiscal: { motivo: "se_nego", idCliente: nuevoId() }, hecho: { sinFiscal: true } }));
    await sincronizar();
    expect(rutas()).toEqual(["/precios"]);
  });

  it("tortillería que ya existía y no tenía foto: se envía su foto antes de los datos fiscales y los precios, y la foto ya no ocupa espacio", async () => {
    h.respuesta = () => ({});
    await guardarPaquete(
      paquete({
        fotoExistente: { idCliente: nuevoId(), archivo: new Blob(["x"], { type: "image/jpeg" }) },
        fiscal: { tipoPersona: "moral", rfc: "ABC100101AB1", razonSocial: "X SA", aceptoAviso: true },
      }),
    );
    await sincronizar();
    expect(rutas()).toEqual(["/tortillerias/:id/fotos", "/tortillerias/:id/fiscal", "/precios"]);
    expect(h.llamadas[0].headers["x-id-cliente"]).toBeTruthy(); // lleva su id para que un reintento no la duplique
    const [p] = await listarPaquetes();
    expect(p.estado).toBe("enviado");
    expect(p.fotoExistente?.archivo).toBeUndefined();
  });

  it("'No se pudo tomar la foto': se envía el motivo (sin foto) antes de los precios y no se marca la tortillería como con foto", async () => {
    h.respuesta = () => ({});
    await guardarPaquete(paquete({ sinFoto: { motivo: "otro", motivoOtro: "Local en remodelación", idCliente: nuevoId() } }));
    await sincronizar();
    expect(rutas()).toEqual(["/tortillerias/:id/foto/negativa", "/precios"]);
    expect(h.llamadas[0].cuerpo).toMatchObject({ motivo: "otro", motivoOtro: "Local en remodelación" });
    expect(h.llamadas[0].cuerpo.idCliente).toBeTruthy();
    expect(h.llamadas[0].cuerpo.capturadoEn).toBeTruthy();
    expect((await listarPaquetes())[0].estado).toBe("enviado");
  });

  it("un reintento no vuelve a enviar la foto ni el motivo que ya llegaron", async () => {
    h.respuesta = () => ({});
    await guardarPaquete(paquete({ sinFoto: { motivo: "cerrado", idCliente: nuevoId() }, hecho: { sinFoto: true } }));
    await guardarPaquete(paquete({ fotoExistente: { idCliente: nuevoId(), archivo: new Blob(["x"]) }, hecho: { fotoExistente: true } }));
    await sincronizar();
    expect(rutas()).toEqual(["/precios", "/precios"]);
  });

  it("'Era la misma': la foto que se había tomado para la nueva sirve para la que ya existía", async () => {
    const idCliente = nuevoId();
    const temp = idTemporal(idCliente);
    const fotoIdCliente = nuevoId();
    h.respuesta = (ruta) => (ruta === "/tortillerias" ? { id: REAL } : {});
    await guardarPaquete(paquete({ tortilleria: { id: temp, nombre: "N", domicilio: null, lat: 1, lng: 1 }, nueva: { idCliente, datos: {}, fotoIdCliente, foto: new Blob(["x"], { type: "image/jpeg" }) }, estado: "conflicto", posibles: [{ id: REAL, nombre: "LA GUERA", domicilio: null }] }));
    const [antes] = await listarPaquetes();
    await usarExistente(antes.id, { id: REAL, nombre: "LA GUERA", domicilio: null });
    await sincronizar({ forzar: true });
    expect(rutas()).toEqual(["/tortillerias/:id/fotos", "/precios"]);
    expect(h.llamadas[0].headers["x-id-cliente"]).toBe(fotoIdCliente);
  });

  it("el id temporal de una tortillería nueva se reemplaza por el real en los paquetes que la usan", async () => {
    const idCliente = nuevoId();
    const temp = idTemporal(idCliente);
    h.respuesta = (ruta) => (ruta === "/tortillerias" ? { id: REAL } : {});
    await guardarPaquete(paquete({ tortilleria: { id: temp, nombre: "N", domicilio: null, lat: 1, lng: 1 }, nueva: { idCliente, datos: {}, fotoIdCliente: nuevoId() } }));
    // otro día se captura un precio de esa misma tortillería (todavía con el id temporal)
    await guardarPaquete(paquete({ tortilleria: { id: temp, nombre: "N", domicilio: null, lat: 1, lng: 1 } }));
    await sincronizar();
    const precios = h.llamadas.filter((l) => l.ruta === "/precios");
    expect(precios).toHaveLength(2);
    expect(precios.every((x) => x.cuerpo.tortilleriaId === REAL)).toBe(true);
    expect((await listarPaquetes()).every((p) => p.estado === "enviado")).toBe(true);
  });

  it("los precios de una tortillería nueva esperan a que ella llegue", async () => {
    const temp = idTemporal(nuevoId());
    await guardarPaquete(paquete({ tortilleria: { id: temp, nombre: "N", domicilio: null, lat: 1, lng: 1 } }));
    await sincronizar();
    expect(h.llamadas).toHaveLength(0);
    expect((await listarPaquetes())[0].estado).toBe("por_enviar");
  });

  it("manda la hora del teléfono y un id por precio (un reintento no duplica)", async () => {
    const p = paquete();
    await guardarPaquete(p);
    await sincronizar();
    expect(h.llamadas[0].cuerpo).toMatchObject({ tortilleriaId: REAL, producto: "maiz", precioKg: 24, capturadoEn: p.capturadoEn, idCliente: p.precios[0].idCliente });
  });

  it("un paquete a la vez, en el orden en que se capturaron", async () => {
    const a = paquete({ precios: [{ producto: "maiz", precioKg: 20, idCliente: nuevoId(), estado: "pendiente" }] });
    const b = paquete({ precios: [{ producto: "maiz", precioKg: 21, idCliente: nuevoId(), estado: "pendiente" }] });
    await guardarPaquete(b);
    await guardarPaquete(a);
    await sincronizar();
    expect(h.llamadas.map((l) => l.cuerpo.precioKg)).toEqual([20, 21]);
  });

  it("sin sesión vencida o con otro usuario no se envía lo del anterior", async () => {
    await guardarPaquete(paquete({ usuarioId: "otro" }));
    await sincronizar();
    expect(h.llamadas).toHaveLength(0);
    expect(await contarPendientes("otro")).toBe(1);
  });

  it("401 detiene el envío sin borrar nada", async () => {
    h.respuesta = () => new ApiError(401, "No autenticado");
    await guardarPaquete(paquete());
    await sincronizar();
    expect(estadoSync.sinSesion).toBe(true);
    const [p] = await listarPaquetes();
    expect(p.estado).toBe("por_enviar");
    expect(p.precios[0].estado).toBe("pendiente");
  });

  it("un error de red reintenta después con espera creciente, y 'Enviar ahora' lo intenta ya", async () => {
    h.respuesta = () => new ApiError(0, "Sin conexión con el servidor");
    await guardarPaquete(paquete());
    await sincronizar();
    let [p] = await listarPaquetes();
    expect(p.estado).toBe("por_enviar");
    expect(p.intentos).toBe(1);
    expect(p.proximoIntento!).toBeGreaterThan(Date.now() + 20_000);
    h.llamadas = [];
    await sincronizar(); // todavía en espera: no insiste
    expect(h.llamadas).toHaveLength(0);
    h.respuesta = null; // vuelve la señal
    await sincronizar({ forzar: true });
    [p] = await listarPaquetes();
    expect(p.estado).toBe("enviado");
  });

  it("429 espera lo que indica Retry-After", async () => {
    h.respuesta = () => new ApiError(429, "Demasiadas", undefined, 90);
    await guardarPaquete(paquete());
    await sincronizar();
    const [p] = await listarPaquetes();
    expect(p.proximoIntento!).toBeGreaterThan(Date.now() + 80_000);
    expect(p.estado).toBe("por_enviar");
  });

  it("409 en un precio: queda en conflicto y no se borra", async () => {
    h.respuesta = () => new ApiError(409, "Ya capturaste este producto hoy");
    await guardarPaquete(paquete());
    await sincronizar();
    const [p] = await listarPaquetes();
    expect(p.estado).toBe("conflicto");
    expect(p.mensaje).toMatch(/Ya habías capturado tortilla/);
    await descartar(p.id);
    expect(await listarPaquetes()).toHaveLength(0);
  });

  it("400 queda como error con el mensaje del servidor", async () => {
    h.respuesta = () => new ApiError(400, "Datos inválidos");
    await guardarPaquete(paquete());
    await sincronizar();
    const [p] = await listarPaquetes();
    expect([p.estado, p.mensaje]).toEqual(["error", "Datos inválidos"]);
  });

  it("posible duplicado: 'Era la misma' pasa los precios a la tortillería existente y 'Es otra' reenvía confirmado", async () => {
    const idCliente = nuevoId();
    const temp = idTemporal(idCliente);
    const existente = { id: REAL, nombre: "LA GUERA", domicilio: "CALLE 5" };
    h.respuesta = (ruta) => (ruta === "/tortillerias" ? new ApiError(409, "Posible duplicado", { posibles: [existente] }) : {});
    await guardarPaquete(paquete({ tortilleria: { id: temp, nombre: "LA GUERA", domicilio: null, lat: 1, lng: 1 }, nueva: { idCliente, datos: { nombre: "LA GUERA" }, fotoIdCliente: nuevoId() } }));
    await sincronizar();
    let [p] = await listarPaquetes();
    expect(p.estado).toBe("conflicto");
    expect(p.posibles).toHaveLength(1);

    // "Es otra": se reenvía con confirmoNoDuplicado
    h.llamadas = [];
    h.respuesta = (ruta) => (ruta === "/tortillerias" ? { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } : {});
    await enviarDeTodosModos(p.id);
    await sincronizar({ forzar: true });
    expect(h.llamadas[0].cuerpo.confirmoNoDuplicado).toBe(true);

    // "Era la misma" en otro paquete
    h.llamadas = [];
    const id2 = nuevoId();
    h.respuesta = (ruta) => (ruta === "/tortillerias" ? new ApiError(409, "Posible duplicado", { posibles: [existente] }) : {});
    await guardarPaquete(paquete({ tortilleria: { id: idTemporal(id2), nombre: "LA GUERA", domicilio: null, lat: 1, lng: 1 }, nueva: { idCliente: id2, datos: {}, fotoIdCliente: nuevoId() } }));
    await sincronizar();
    [p] = (await listarPaquetes()).filter((x) => x.estado === "conflicto");
    h.llamadas = [];
    h.respuesta = null;
    await usarExistente(p.id, existente);
    await sincronizar({ forzar: true });
    expect(rutas()).toEqual(["/precios"]);
    expect(h.llamadas[0].cuerpo.tortilleriaId).toBe(REAL);
  });

  it("cerrar sesión borra la bandeja de ese usuario", async () => {
    await guardarPaquete(paquete());
    await guardarPaquete(paquete({ usuarioId: "otro" }));
    await borrarBandejaDe("u1");
    expect(await listarPaquetes("u1")).toHaveLength(0);
    expect(await listarPaquetes("otro")).toHaveLength(1);
  });
});

describe("límite de una vez al día, sin conexión", () => {
  it("no deja capturar dos veces el mismo producto el mismo día si ya está en la bandeja", async () => {
    await guardarPaquete(paquete({ precios: [{ producto: "maiz", precioKg: 24, idCliente: nuevoId(), estado: "pendiente" }], capturadoEn: new Date().toISOString() }));
    expect(await capturadoHoyLocal(REAL, "u1")).toEqual({ maiz: 24, masa: null });
    expect(await capturadoHoyLocal("otra", "u1")).toEqual({ maiz: null, masa: null });
  });

  it("lo capturado ayer no cuenta para hoy", async () => {
    const ayer = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    expect(diaMexico(ayer)).not.toBe(diaMexico());
    await guardarPaquete(paquete({ capturadoEn: ayer }));
    expect(await capturadoHoyLocal(REAL, "u1")).toEqual({ maiz: null, masa: null });
  });
});

describe("catálogo local", () => {
  const filas = [
    ["i1", "LA GUERA", "CALLE 5 10", 19.43, -99.13, 0, "09015", "JUAN PEREZ SA", 1],
    ["i2", "EL MAIZ", "AV JUAREZ 3", 19.44, -99.14, 0, "09015", null, 0],
    ["i3", "TORTILLERIA LEJANA", "CALLE 9", 19.9, -99.5, 1, "09016", null, 0],
  ];
  const columnas = ["id", "nombre", "domicilio", "lat", "lng", "estatus", "municipio_clave", "razon_social", "tiene_fiscal"];

  beforeEach(async () => {
    h.respuesta = () => ({ version: "v1", columnas, filas });
    await descargarEstado("09", "CIUDAD DE MEXICO");
  });

  it("el catálogo trae si cada tortillería tiene foto; sin esa columna (catálogo viejo) no se sabe y no se exige", async () => {
    h.respuesta = () => ({ version: "v3", columnas: [...columnas, "ultima_negativa", "tiene_foto"], filas: filas.map((f, n) => [...f, null, n === 1 ? 0 : 1]) });
    await descargarEstado("09", "CIUDAD DE MEXICO");
    expect(porId("i1")?.tiene_foto).toBe(true);
    expect(porId("i2")?.tiene_foto).toBe(false);
    h.respuesta = () => ({ version: "v4", columnas, filas });
    await descargarEstado("09", "CIUDAD DE MEXICO");
    expect(porId("i2")?.tiene_foto).toBeUndefined();
  });

  it("al enviar la foto, el catálogo local recuerda que ya tiene (no se pide de nuevo sin conexión)", async () => {
    h.respuesta = () => ({ version: "v3", columnas: [...columnas, "ultima_negativa", "tiene_foto"], filas: filas.map((f) => [...f, null, 0]) });
    await descargarEstado("09", "CIUDAD DE MEXICO");
    expect(porId("i2")?.tiene_foto).toBe(false);
    h.respuesta = () => ({});
    await guardarPaquete(paquete({ tortilleria: { id: "i2", nombre: "EL MAIZ", domicilio: null, lat: 19.44, lng: -99.14 }, fotoExistente: { idCliente: nuevoId(), archivo: new Blob(["x"]) } }));
    await sincronizar();
    expect(porId("i2")?.tiene_foto).toBe(true);
  });

  it("si el servidor dice que otra persona ya subió la foto, el catálogo local también lo recuerda", async () => {
    h.respuesta = () => ({ version: "v3", columnas: [...columnas, "ultima_negativa", "tiene_foto"], filas: filas.map((f) => [...f, null, 0]) });
    await descargarEstado("09", "CIUDAD DE MEXICO");
    h.respuesta = (ruta) => (ruta.endsWith("/foto/negativa") ? { yaTenia: true } : {});
    await guardarPaquete(paquete({ tortilleria: { id: "i2", nombre: "EL MAIZ", domicilio: null, lat: 19.44, lng: -99.14 }, sinFoto: { motivo: "cerrado", idCliente: nuevoId() } }));
    await sincronizar();
    expect(porId("i2")?.tiene_foto).toBe(true);
  });

  it("una negativa NO marca tiene_fiscal en el catálogo local (la tortillería sigue sin datos)", async () => {
    h.respuesta = () => ({});
    await guardarPaquete(paquete({ tortilleria: { id: "i2", nombre: "EL MAIZ", domicilio: null, lat: 19.44, lng: -99.14 }, sinFiscal: { motivo: "inseguridad", idCliente: nuevoId() } }));
    await sincronizar();
    expect(porId("i2")?.tiene_fiscal).toBe(false);
  });

  it("si el servidor dice que ya tenía datos fiscales, el catálogo local lo recuerda", async () => {
    h.respuesta = (ruta) => (ruta.endsWith("/fiscal/negativa") ? { yaTenia: true } : {});
    await guardarPaquete(paquete({ tortilleria: { id: "i2", nombre: "EL MAIZ", domicilio: null, lat: 19.44, lng: -99.14 }, sinFiscal: { motivo: "inseguridad", idCliente: nuevoId() } }));
    await sincronizar();
    expect(porId("i2")?.tiene_fiscal).toBe(true);
  });

  it("lee la última negativa del catálogo del estado (aviso sin conexión)", async () => {
    h.respuesta = () => ({ version: "v2", columnas: [...columnas, "ultima_negativa"], filas: filas.map((f, n) => [...f, n === 1 ? "inseguridad" : null]) });
    await descargarEstado("09", "CIUDAD DE MEXICO");
    expect(porId("i2")?.ultima_negativa).toBe("inseguridad");
    expect(porId("i1")?.ultima_negativa).toBeNull();
  });

  it("ordena por cercanía con la distancia calculada en el teléfono y respeta el radio", () => {
    const yo = { lat: 19.431, lng: -99.131 };
    const r = cercanas(yo, 5);
    expect(r.map((x) => x.nombre)).toEqual(["LA GUERA", "EL MAIZ"]); // la lejana (a ~55 km) queda fuera
    expect(r[0].distancia_m!).toBeLessThan(r[1].distancia_m!);
    expect(r[0].distancia_m!).toBeCloseTo(distanciaM(yo, { lat: 19.43, lng: -99.13 }), 0);
    expect(cercanas(yo, 1).map((x) => x.nombre)).toEqual(["LA GUERA"]);
    expect(cercanas(yo, 0).map((x) => x.nombre)).toHaveLength(3); // "Muni.": sin radio
  });

  it("busca por nombre o calle sin importar acentos ni mayúsculas", () => {
    expect(buscar("guera").map((x) => x.id)).toEqual(["i1"]);
    expect(buscar("juárez").map((x) => x.id)).toEqual(["i2"]);
    expect(buscar("x")).toEqual([]);
    expect(cercanas({ lat: 19.43, lng: -99.13 }, 5, "MAIZ").map((x) => x.id)).toEqual(["i2"]);
  });

  it("filtra por municipio y por la caja visible del mapa", () => {
    expect(delMunicipio("09016").map((x) => x.id)).toEqual(["i3"]);
    expect((enCaja(-99.2, 19.4, -99.1, 19.5) as { id: string }[]).map((x) => x.id).sort()).toEqual(["i1", "i2"]);
  });

  it("precarga estado y municipio con la tortillería más cercana, y detecta duplicados a 50 m", () => {
    expect(masCercana({ lat: 19.4301, lng: -99.1301 })).toEqual({ estado: "09", municipio: "09015" });
    expect(parecidas({ lat: 19.43002, lng: -99.13002 }, "la güera").map((x) => x.id)).toEqual(["i1"]);
    expect(parecidas({ lat: 19.43002, lng: -99.13002 }, "otro nombre")).toEqual([]);
    expect(parecidas({ lat: 19.44, lng: -99.2 }, "LA GUERA")).toEqual([]); // mismo nombre pero lejos
  });

  it("sabe si cubre una zona y vuelve a bajar solo si cambió la versión", async () => {
    expect(cubre({ lat: 19.43, lng: -99.13 })).toBe(true);
    expect(cubre({ lat: 25, lng: -100 })).toBe(false);
    h.respuesta = () => ({ sinCambios: true, version: "v1" });
    expect(await descargarEstado("09")).toBe(false);
    expect(h.llamadas.at(-1)!.ruta).toContain("?version=v1");
    await quitarEstado("09");
    expect(cubre({ lat: 19.43, lng: -99.13 })).toBe(false);
  });
});

describe("C19: 'ya no funciona' y tipo de elaboración", () => {
  const columnas = ["id", "nombre", "domicilio", "lat", "lng", "estatus", "municipio_clave", "razon_social", "tiene_fiscal", "ultima_negativa", "elaboracion"];
  const filas = [
    ["i1", "LA GUERA", "CALLE 5 10", 19.43, -99.13, 0, "09015", null, 1, null, "mano"],
    ["i2", "EL MAIZ", "AV JUAREZ 3", 19.44, -99.14, 0, "09015", null, 1, null, null],
  ];
  const de = (id: string, nombre: string) => ({ id, nombre, domicilio: null, lat: 19.43, lng: -99.13 });

  beforeEach(async () => {
    h.respuesta = () => ({ version: "v1", columnas, filas });
    await descargarEstado("09", "CIUDAD DE MEXICO");
    h.llamadas = []; // lo que cuenta es lo que se envíe en cada prueba, no la descarga del catálogo
  });

  it("el catálogo local trae el tipo de elaboración (para preseleccionarlo sin conexión); la que no lo tiene queda sin dato", () => {
    expect(porId("i1")?.elaboracion).toBe("mano");
    expect(porId("i2")?.elaboracion).toBeNull();
  });

  it("el paquete de baja se envía sin foto ni precios, quita la tortillería del catálogo local y queda enviado", async () => {
    expect(porId("i2")).toBeDefined();
    h.respuesta = () => ({});
    await guardarPaquete(paquete({ tortilleria: de("i2", "EL MAIZ"), precios: [], baja: { motivo: "cerro", idCliente: nuevoId() }, gps: { lat: 19.44, lng: -99.14, precision: 9 } }));
    await sincronizar();
    expect(rutas()).toEqual(["/tortillerias/i2/baja"]); // sin foto, sin precios
    expect(h.llamadas[0].cuerpo).toMatchObject({ motivo: "cerro", lat: 19.44, lng: -99.14, precisionGps: 9 });
    expect(h.llamadas[0].cuerpo.idCliente).toBeTruthy(); // un reintento no duplica la baja
    expect(porId("i2")).toBeUndefined(); // ya no aparece en este teléfono
    expect(porId("i1")).toBeDefined();
    const [p] = await listarPaquetes("u1");
    expect(p.estado).toBe("enviado");
  });

  it("guardar la baja la quita del catálogo local al instante (aunque no haya señal) y un reintento no la envía dos veces", async () => {
    await quitarLocal("i1");
    expect(porId("i1")).toBeUndefined();
    h.respuesta = () => new ApiError(0, "sin red");
    await guardarPaquete(paquete({ tortilleria: de("i2", "EL MAIZ"), precios: [], baja: { motivo: "otro", motivoOtro: "Ahora es una papelería", idCliente: nuevoId() } }));
    await sincronizar();
    expect((await listarPaquetes("u1"))[0].estado).toBe("por_enviar"); // se conserva para cuando haya señal
    h.respuesta = () => ({});
    await sincronizar({ forzar: true });
    await sincronizar({ forzar: true });
    expect(rutas().filter((r) => r.endsWith("/baja"))).toHaveLength(2); // el primero falló por la red; luego una sola vez
    expect(h.llamadas.at(-1)?.cuerpo.motivoOtro).toBe("Ahora es una papelería");
  });

  it("la elaboración se envía antes que los precios y el catálogo local la recuerda para la próxima visita", async () => {
    h.respuesta = () => ({});
    await guardarPaquete(paquete({ tortilleria: de("i2", "EL MAIZ"), elaboracion: { valor: "ambas", idCliente: nuevoId() } }));
    await sincronizar();
    expect(rutas()).toEqual(["/tortillerias/i2/elaboracion", "/precios"]);
    expect(h.llamadas[0].cuerpo).toMatchObject({ elaboracion: "ambas" });
    expect(h.llamadas[0].cuerpo.capturadoEn).toBeTruthy(); // un paquete enviado tarde no pisa algo más nuevo
    expect(porId("i2")?.elaboracion).toBe("ambas");
  });

  it("si otro censador ya dio de baja la tortillería, el precio queda en conflicto con ese aviso y sale del catálogo", async () => {
    h.respuesta = (ruta) => (ruta === "/precios" ? new ApiError(409, "Esta tortillería se dio de baja", { baja: { motivo: "cerro", fecha: "2026-11-10" } }) : {});
    await guardarPaquete(paquete({ tortilleria: de("i2", "EL MAIZ") }));
    await sincronizar();
    const [p] = await listarPaquetes("u1");
    expect(p.estado).toBe("conflicto");
    expect(p.precios[0].mensaje).toMatch(/dado de baja/);
    expect(porId("i2")).toBeUndefined();
  });
});
