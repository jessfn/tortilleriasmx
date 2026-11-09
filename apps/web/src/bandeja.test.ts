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
import { cercanas, descargarEstado, delMunicipio, distanciaM, masCercana, parecidas, buscar, cubre, quitarEstado, enCaja } from "./catalogo";

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
    expect(p.mensaje).toMatch(/Ya habías capturado maíz/);
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
