import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Banknote, Briefcase, Building2, Camera, Check, CircleCheck, CloudOff, TriangleAlert, Eye, EyeOff, FileText, Hash, ImagePlus, KeyRound, Landmark, Layers, ListChecks,
  Loader2, LocateFixed, Mail, MapPin, Minus, Phone, Plus, RotateCcw, Route, Send, ShieldCheck, Store, UserPlus, Users, Wheat, type LucideIcon,
} from "lucide-react";
import {
  fiscalSchema, nuevaTortilleriaSchema, normalizarTexto, PASSWORD_MIN, PERSONAL_OCUPADO, PRECIO_MAX, PRECIO_MIN, registroSchema, TIPOS_VIAL,
} from "@tortillerias/shared";
import { api, ApiError, guardarSesion, leerSesion, type Sesion } from "./api";
import { buscarLugar } from "./geocoder";
import { comprimirFoto } from "./imagen";
import { borrarBorrador, guardarBorrador } from "./borrador";
import { diaMexico, nuevoId, type Paquete } from "./bd";
import { capturadoHoyLocal, esTemporal, guardarPaquete, idTemporal, listarPaquetes, sincronizar } from "./bandeja";
import { delMunicipio, listaEstados, listaMunicipios, marcarFiscalLocal, masCercana, parecidas, porId, type Item as ItemCat } from "./catalogo";
import type { Local } from "./bd";
import PasoTortilleria from "./PasoTortilleria";
import type { Punto } from "./MapaTortillerias";
import { Aviso, Barra, Boton, Buscador, Cabecera, Campo, Hoja, Opcion, Selector } from "./ui";
import { TelefonoCampo } from "./TelefonoCampo";

type Item = { clave: string; nombre: string };
type Pos = { lat: number; lng: number; precision?: number };
type Producto = "maiz" | "masa";
type Caso = "mapa" | "actualizar";

const PRODUCTOS: { id: Producto; clave: "precioMaiz" | "precioMasa"; texto: string; icono: LucideIcon }[] = [
  { id: "maiz", clave: "precioMaiz", texto: "Tortilla de maíz", icono: Wheat },
  { id: "masa", clave: "precioMasa", texto: "Masa", icono: Layers },
];

const NV_VACIO = {
  nombre: "", telefono: "", correo: "", personalOcupado: "", localidad: "", tipoVial: "CALLE", calle: "", numeroExt: "", sinNumero: false,
  numeroInt: "", colonia: "", codigoPostal: "",
};

type Datos = {
  estado?: Item;
  municipio?: Item;
  zonaManual: boolean;
  tortilleria?: Punto;
  nueva: boolean;
  pin?: Pos;
  nv: typeof NV_VACIO;
  foto?: Blob;
  fotoUrl?: string;
  fiscal: { tipoPersona: "fisica" | "moral"; rfc: string; razonSocial: string; celular: string; aviso: boolean };
  /** Solo se pide si la persona aún no tiene cuenta: se crea al enviar el registro */
  cuenta: { correo: string; password: string; confirmar: string };
  precioMaiz: string;
  precioMasa: string;
};

const inicial: Datos = {
  zonaManual: false,
  nueva: false,
  nv: NV_VACIO,
  fiscal: { tipoPersona: "fisica", rfc: "", razonSocial: "", celular: "", aviso: false },
  cuenta: { correo: "", password: "", confirmar: "" },
  precioMaiz: "",
  precioMasa: "",
};

/**
 * Pasos del asistente según el caso:
 *  A) tortillería existente:  [estado → municipio, solo sin GPS] → tortilleria (mapa) → [fiscal, si no los tiene] → precio → [cuenta] → resumen
 *  B) tortillería nueva:      [estado → municipio] → tortilleria (mapa + pin) → nueva → foto → fiscal → precio → [cuenta] → resumen
 *  C) actualizar precio:      [fiscal, si no los tiene] → precio → resumen
 */
function armarPasos(o: { caso: Caso; zonaManual: boolean; nueva: boolean; faltaFiscal: boolean; conCuenta: boolean }): string[] {
  if (o.caso === "actualizar") return [...(o.faltaFiscal ? ["fiscal"] : []), "precio", "resumen"];
  return [
    ...(o.zonaManual ? ["estado", "municipio"] : []),
    "tortilleria",
    ...(o.nueva ? ["nueva", "foto", "fiscal"] : o.faltaFiscal ? ["fiscal"] : []),
    "precio",
    ...(o.conCuenta ? ["cuenta"] : []),
    "resumen",
  ];
}

const META: Record<string, { titulo: string; sub: string; icono: LucideIcon }> = {
  estado: { titulo: "Estado", sub: "¿En qué estado estás?", icono: Landmark },
  municipio: { titulo: "Municipio", sub: "¿En qué municipio?", icono: Building2 },
  tortilleria: { titulo: "Tortillería", sub: "Toca un punto y elígela", icono: Store },
  nueva: { titulo: "Nueva tortillería", sub: "Los campos marcados con * son obligatorios", icono: Plus },
  foto: { titulo: "Foto", sub: "Foto de la tortillería nueva", icono: Camera },
  fiscal: { titulo: "Datos fiscales", sub: "De la tortillería (la empresa)", icono: FileText },
  cuenta: { titulo: "Tu cuenta", sub: "Con ella entrarás a tu panel", icono: UserPlus },
  precio: { titulo: "Precio", sub: "Precio por kilo al público", icono: Banknote },
  resumen: { titulo: "Resumen", sub: "Revisa y envía", icono: ListChecks },
};

/** Lo que ya se hizo (la cuenta se crea con conexión; lo demás pasa por la bandeja de pendientes) */
type Creada = { cuenta?: boolean };
export type Borrador = {
  v: 3;
  d: Omit<Datos, "foto" | "fotoUrl">; // la contraseña NUNCA se guarda
  pasoId: string;
  creada: Creada;
  /** la foto se guarda como archivo en IndexedDB */
  foto?: Blob;
  caso: Caso;
  tieneFiscal?: boolean;
};

/** Cómo terminó el envío: enviado al servidor, guardado en el teléfono (sin señal) o con un problema que el censador debe ver */
type Resultado = { tipo: "enviado" | "guardado" | "conflicto" | "error"; mensaje?: string; pendientes: number };

type Props = {
  /** null = aún no tiene cuenta: el asistente le pedirá correo y contraseña al final */
  sesion: Sesion | null;
  alSesion: (s: Sesion) => void;
  /** Salir sin terminar (regresa a la bienvenida o al panel) */
  alSalir: () => void;
  /** Registro terminado: entrar al panel */
  alTerminar: () => void;
  /** Caso C: actualizar el precio de una tortillería ya visitada (desde el panel) */
  tortilleriaInicial?: Punto;
  /** Registro a medias que se guardó en el teléfono (lo carga App antes de abrir el asistente) */
  borrador?: Borrador | null;
};

const precioNumero = (s: string) => Number(s.replace(",", "."));
/** Solo números y un punto, con máximo 2 decimales (centavos): al teclear 15.125 se queda en 15.12 */
const limpiarPrecio = (v: string) => {
  const [ent, ...resto] = v.replace(",", ".").replace(/[^0-9.]/g, "").split(".");
  return (resto.length ? `${ent.slice(0, 2)}.${resto.join("").slice(0, 2)}` : ent.slice(0, 2)).slice(0, 5);
};
const precioValido = (s: string) => s !== "" && precioNumero(s) >= PRECIO_MIN && precioNumero(s) <= PRECIO_MAX;
const dinero = (n: number) => `$${n.toFixed(2)}`;

export default function Captura({ sesion, alSesion, alSalir, alTerminar, tortilleriaInicial, borrador: borradorGuardado }: Props) {
  const [conCuenta, setConCuenta] = useState(!sesion); // se fija al entrar: los pasos no cambian aunque se cree la cuenta a mitad del envío
  const [verPass, setVerPass] = useState(false);
  const [borrador] = useState(() => {
    const b = borradorGuardado;
    // El borrador de un formato anterior no se puede restaurar; el de actualizar precio no aplica a otra tortillería
    if (!b || b.v !== 3) return null;
    if (tortilleriaInicial && (b.caso !== "actualizar" || b.d.tortilleria?.id !== tortilleriaInicial.id)) return null;
    if (!tortilleriaInicial && b.caso === "actualizar") return null;
    return b;
  });
  const [caso, setCaso] = useState<Caso>(tortilleriaInicial ? "actualizar" : "mapa");
  const [d, setD] = useState<Datos>(() =>
    borrador ? { ...inicial, ...borrador.d, cuenta: { ...borrador.d.cuenta, password: "", confirmar: "" } } : { ...inicial, tortilleria: tortilleriaInicial },
  );
  const [tieneFiscal, setTieneFiscal] = useState<boolean | undefined>(borrador?.tieneFiscal);
  const [pasoId, setPasoId] = useState<string>(() => borrador?.pasoId ?? (tortilleriaInicial ? "precio" : "tortilleria"));
  const [preparando, setPreparando] = useState(!!tortilleriaInicial && !borrador); // caso C: se averigua si faltan los datos fiscales
  const [estados, setEstados] = useState<Item[]>([]);
  const [resultado, setResultado] = useState<Resultado>();
  const [parecidasLocal, setParecidasLocal] = useState<Local[] | null>(null);
  const [municipios, setMunicipios] = useState<Item[]>([]);
  const [filtro, setFiltro] = useState("");
  const [centro, setCentro] = useState<{ lat: number; lng: number }>();
  const [gps, setGps] = useState<{ estado: "pidiendo" | "ok" | "error"; pos?: Pos }>({ estado: "pidiendo" });
  const [modoMapa, setModoMapa] = useState<"elegir" | "marcar">(borrador?.pasoId === "tortilleria" && borrador.d.nueva ? "marcar" : "elegir");
  const [hoy, setHoy] = useState<{ maiz: number | null; masa: number | null }>();
  const [error, setError] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [creada, setCreada] = useState<Creada>(() => borrador?.creada ?? {});
  const inputCamara = useRef<HTMLInputElement>(null);
  const inputGaleria = useRef<HTMLInputElement>(null);

  const set = (p: Partial<Datos>) => setD((x) => ({ ...x, ...p }));
  const setNv = (p: Partial<Datos["nv"]>) => setD((x) => ({ ...x, nv: { ...x.nv, ...p } }));
  const setFiscal = (p: Partial<Datos["fiscal"]>) => setD((x) => ({ ...x, fiscal: { ...x.fiscal, ...p } }));

  const faltaFiscal = d.nueva ? true : tieneFiscal === false;
  const pasos = useMemo(
    () => armarPasos({ caso, zonaManual: d.zonaManual, nueva: d.nueva, faltaFiscal, conCuenta }),
    [caso, d.zonaManual, d.nueva, faltaFiscal, conCuenta],
  );
  const id = pasos.includes(pasoId) ? pasoId : pasos[0];
  const paso = pasos.indexOf(id);

  useEffect(() => setFiltro(""), [id]);

  /* ---------------- GPS: se pide al entrar; con él se brincan estado y municipio ---------------- */
  const gpsResuelto = useRef(false);
  function pedirGps() {
    if (!navigator.geolocation) {
      setGps({ estado: "error" });
      return;
    }
    setGps((g) => ({ ...g, estado: g.pos ? "ok" : "pidiendo" }));
    navigator.geolocation.getCurrentPosition(
      (p) => setGps({ estado: "ok", pos: { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy } }),
      () => setGps((g) => ({ estado: g.pos ? "ok" : "error", pos: g.pos })),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 },
    );
  }
  useEffect(pedirGps, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sin GPS (negado o sin señal): se piden estado y municipio, y el mapa se centra ahí
  useEffect(() => {
    if (gps.estado !== "error" || gpsResuelto.current || caso !== "mapa") return;
    gpsResuelto.current = true;
    if (d.municipio) return;
    setD((x) => ({ ...x, zonaManual: true }));
    if (pasoId === "tortilleria") setPasoId("estado");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps.estado, caso]);

  /* ---------------- catálogos ---------------- */
  useEffect(() => {
    if (id !== "estado" && id !== "nueva") return;
    if (estados.length) return;
    listaEstados().then(setEstados).catch((e) => setError(e.message));
  }, [id, estados.length]);

  useEffect(() => {
    if (!d.estado) return setMunicipios([]);
    listaMunicipios(d.estado.clave).then(setMunicipios).catch((e) => setError(e.message));
  }, [d.estado?.clave]); // eslint-disable-line react-hooks/exhaustive-deps

  // Centro del mapa cuando la zona se eligió a mano
  useEffect(() => {
    if (!d.zonaManual || !d.municipio || !d.estado) return;
    let vigente = true;
    buscarLugar(`${d.municipio.nombre}, ${d.estado.nombre}`)
      .then((r) => {
        if (!vigente) return;
        if (r[0]) return setCentro({ lat: r[0].lat, lng: r[0].lng });
        throw new Error("sin resultado");
      })
      .catch(() => {
        // sin internet (o sin resultado): se mira hacia una tortillería del catálogo guardado en el teléfono
        const loc = delMunicipio(d.municipio!.clave, "", undefined, 1)[0];
        if (loc) return vigente && setCentro({ lat: loc.lat, lng: loc.lng });
        return api<{ lat: number; lng: number }[]>(`/tortillerias?municipio=${d.municipio!.clave}&limite=1`)
          .then((r) => vigente && r[0] && setCentro({ lat: r[0].lat, lng: r[0].lng }))
          .catch(() => {});
      });
    return () => {
      vigente = false;
    };
  }, [d.zonaManual, d.municipio?.clave]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tortillería nueva: estado y municipio se precargan con los del punto marcado (editables)
  useEffect(() => {
    if (id !== "nueva" || d.estado || !d.pin) return;
    const pon = (r: { estado: Item | null; municipio: Item | null }) => r.estado && r.municipio && setD((x) => (x.estado ? x : { ...x, estado: r.estado!, municipio: r.municipio! }));
    // Primero con el catálogo del teléfono (funciona sin internet); si no hay, con el servidor
    const cerca = masCercana(d.pin);
    if (cerca) {
      Promise.all([listaEstados(), listaMunicipios(cerca.estado)])
        .then(([es, ms]) => pon({ estado: es.find((e) => e.clave === cerca.estado) ?? null, municipio: ms.find((m) => m.clave === cerca.municipio) ?? null }))
        .catch(() => {});
      return;
    }
    api<{ estado: Item | null; municipio: Item | null }>(`/ubicacion/cercana?lat=${d.pin.lat}&lng=${d.pin.lng}`)
      .then(pon)
      .catch(() => {});
  }, [id, d.estado, d.pin?.lat, d.pin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- ¿ya tiene datos fiscales? Con internet se pregunta al servidor; sin él se usa lo guardado en el teléfono ---------------- */
  async function tieneFiscalDe(tortilleriaId: string): Promise<boolean> {
    const local = porId(tortilleriaId)?.tiene_fiscal;
    if (esTemporal(tortilleriaId)) return local ?? false; // tortillería nueva de este teléfono: el servidor aún no la conoce
    if (navigator.onLine) {
      try {
        return (await api<{ tiene: boolean }>(`/tortillerias/${tortilleriaId}/fiscal/existe`)).tiene;
      } catch (e) {
        if (e instanceof ApiError && e.status > 0) throw e;
      }
    }
    // Sin señal: si estaba desactualizado no pasa nada, el servidor no sobrescribe datos fiscales ya capturados
    return local ?? false;
  }

  /* ---------------- caso C: ¿faltan los datos fiscales? ---------------- */
  useEffect(() => {
    if (!tortilleriaInicial || !preparando) return;
    tieneFiscalDe(tortilleriaInicial.id)
      .then((tiene) => {
        setTieneFiscal(tiene);
        setPasoId(tiene ? "precio" : "fiscal");
      })
      .catch((e) => setError(e.message))
      .finally(() => setPreparando(false));
  }, [tortilleriaInicial, preparando]);

  /* ---------------- precio: lo que este censador ya capturó hoy ---------------- */
  useEffect(() => {
    if (id !== "precio") return;
    // sin cuenta todavía (se crea al enviar) no hay nada capturado hoy
    if (!d.tortilleria?.id || d.nueva || !sesion) return setHoy({ maiz: null, masa: null });
    let vigente = true;
    const tid = d.tortilleria.id;
    // Lo que el teléfono ya sabe (bandeja de pendientes + última copia del servidor) cuenta igual que lo que diga el servidor
    capturadoHoyLocal(tid, sesion.usuario.id).then(async (loc) => {
      let r = loc;
      if (navigator.onLine && !esTemporal(tid)) {
        try {
          const s = await api<{ maiz: number | null; masa: number | null }>(`/tortillerias/${tid}/mis-precios-hoy`);
          r = { maiz: s.maiz ?? loc.maiz, masa: s.masa ?? loc.masa };
        } catch {
          /* se queda con lo del teléfono */
        }
      }
      if (vigente) setHoy(r);
    });
    return () => {
      vigente = false;
    };
  }, [id, d.tortilleria?.id, d.nueva, sesion]);

  // Razón social: se precarga con la del DENUE, si la trae (editable)
  useEffect(() => {
    if (id !== "fiscal" || d.fiscal.razonSocial || !d.tortilleria?.razon_social || d.nueva) return;
    setFiscal({ razonSocial: normalizarTexto(d.tortilleria.razon_social) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ---------------- foto y borrador ---------------- */
  useEffect(() => {
    if (!borrador?.foto) return;
    setD((x) => (x.foto ? x : { ...x, foto: borrador.foto, fotoUrl: URL.createObjectURL(borrador.foto!) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El registro a medias se guarda en el teléfono (IndexedDB): sobrevive aunque se cierre la app
  useEffect(() => {
    if (listo || preparando) return;
    const t = setTimeout(() => {
      const { foto, fotoUrl: _u, ...resto } = d;
      const sinClave = { ...resto, cuenta: { correo: d.cuenta.correo, password: "", confirmar: "" } };
      const base: Borrador = { v: 3, d: sinClave, pasoId: id, creada, caso, tieneFiscal, foto };
      void guardarBorrador(sesion?.usuario.id ?? null, base);
    }, 400);
    return () => clearTimeout(t);
  }, [d, id, creada, listo, preparando, caso, tieneFiscal, sesion]);

  // Registro nuevo terminado: entrar solo al panel después de un momento
  useEffect(() => {
    if (!listo || !conCuenta) return;
    const t = setTimeout(alTerminar, 4500);
    return () => clearTimeout(t);
  }, [listo, conCuenta, alTerminar]);

  /* ---------------- validaciones ---------------- */
  const pedirNv = () => ({
    nombre: d.nv.nombre, estadoClave: d.estado?.clave ?? "", municipioClave: d.municipio?.clave ?? "", localidad: d.nv.localidad,
    tipoVial: d.nv.tipoVial, calle: d.nv.calle, numeroExt: d.nv.sinNumero ? "SN" : d.nv.numeroExt, numeroInt: d.nv.numeroInt, colonia: d.nv.colonia,
    codigoPostal: d.nv.codigoPostal, telefono: d.nv.telefono, correo: d.nv.correo, personalOcupado: d.nv.personalOcupado,
    lat: d.pin?.lat ?? NaN, lng: d.pin?.lng ?? NaN,
  });
  const resNv = nuevaTortilleriaSchema.safeParse(pedirNv());
  const errNv = (campo: string) => {
    if (resNv.success) return undefined;
    const e = resNv.error.flatten().fieldErrors as Record<string, string[] | undefined>;
    return e[campo]?.[0];
  };
  const tocadoNv = (valor: string) => valor.trim() !== "";

  const resFiscal = fiscalSchema.safeParse({ tipoPersona: d.fiscal.tipoPersona, rfc: d.fiscal.rfc, razonSocial: d.fiscal.razonSocial, celular: d.fiscal.celular });
  const errFiscal = (campo: string) => {
    if (resFiscal.success) return undefined;
    const valor = campo === "rfc" ? d.fiscal.rfc : campo === "razonSocial" ? d.fiscal.razonSocial : d.fiscal.celular;
    return valor ? (resFiscal.error.flatten().fieldErrors as Record<string, string[] | undefined>)[campo]?.[0] : undefined;
  };
  const resCuenta = registroSchema.safeParse(d.cuenta);
  const errCuenta = (campo: "correo" | "password" | "confirmar") =>
    d.cuenta[campo] && !resCuenta.success ? (resCuenta.error.flatten().fieldErrors[campo] as string[] | undefined)?.[0] : undefined;

  const bloqueado = (p: Producto) => hoy?.[p] != null; // ya lo capturó hoy
  const activo = (p: (typeof PRODUCTOS)[number]) => !bloqueado(p.id);
  // los dos precios son obligatorios (el que ya se capturó hoy no se vuelve a pedir)
  const preciosListos = PRODUCTOS.every((p) => !activo(p) || (d[p.clave] !== "" && precioValido(d[p.clave])));
  const faltan = PRODUCTOS.filter((p) => activo(p) && !(d[p.clave] !== "" && precioValido(d[p.clave])));
  const todoCapturado = hoy != null && !activo(PRODUCTOS[0]) && !activo(PRODUCTOS[1]);

  const puede: Record<string, boolean> = {
    estado: !!d.estado,
    municipio: !!d.municipio,
    tortilleria: false, // se avanza con "Elegir esta tortillería" o "Confirmar ubicación"
    nueva: resNv.success,
    foto: !!d.foto,
    fiscal: resFiscal.success && d.fiscal.aviso,
    cuenta: resCuenta.success,
    precio: hoy != null && preciosListos && !todoCapturado,
    resumen: true,
  };

  /* ---------------- navegación ---------------- */
  function ir(delta: number) {
    setError("");
    const i = Math.min(Math.max(paso + delta, 0), pasos.length - 1);
    // Volver desde la ficha de la tortillería nueva regresa al mapa, con el pin donde estaba
    if (delta < 0 && pasos[i] === "tortilleria" && d.nueva) setModoMapa("marcar");
    setPasoId(pasos[i]);
  }

  /** Mapa → tortillería existente elegida. Antes de seguir se averigua si ya tiene datos fiscales. */
  async function elegirTortilleria(punto: Punto) {
    const tiene = await tieneFiscalDe(punto.id);
    const r = { tiene };
    setTieneFiscal(r.tiene);
    setHoy(undefined);
    setD((x) => ({
      ...x, tortilleria: punto, nueva: false, foto: undefined, fotoUrl: undefined,
      fiscal: x.tortilleria?.id === punto.id ? x.fiscal : { ...inicial.fiscal },
      precioMaiz: x.tortilleria?.id === punto.id ? x.precioMaiz : "", precioMasa: x.tortilleria?.id === punto.id ? x.precioMasa : "",
    }));
    setCreada((c) => ({ cuenta: c.cuenta }));
    setModoMapa("elegir");
    // el siguiente paso depende del resultado: fiscal si faltan, si no el precio
    setPasoId(r.tiene ? "precio" : "fiscal");
  }

  function confirmarPin() {
    setD((x) => ({ ...x, nueva: true, tortilleria: undefined }));
    setTieneFiscal(false);
    setPasoId("nueva");
  }

  function otraZona() {
    setD((x) => ({ ...x, zonaManual: true }));
    setPasoId("estado");
  }

  async function recibirFoto(archivo?: File) {
    if (!archivo) return;
    try {
      const blob = await comprimirFoto(archivo);
      if (d.fotoUrl) URL.revokeObjectURL(d.fotoUrl);
      set({ foto: blob, fotoUrl: URL.createObjectURL(blob) });
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  /* ---------------- envío: todo pasa por la bandeja de pendientes, con o sin conexión ---------------- */
  const domicilioLocal = () =>
    normalizarTexto(`${d.nv.tipoVial} ${d.nv.calle} ${d.nv.sinNumero ? "SN" : d.nv.numeroExt}${d.nv.numeroInt ? ` INT. ${d.nv.numeroInt}` : ""}, COL. ${d.nv.colonia}, C.P. ${d.nv.codigoPostal}`);

  function armarPaquete(usuarioId: string, confirmoNoDuplicado: boolean): Paquete {
    const precios = PRODUCTOS.filter((p) => activo(p) && d[p.clave] !== "").map((p) => ({
      producto: p.id, precioKg: precioNumero(d[p.clave]), idCliente: nuevoId(), estado: "pendiente" as const,
    }));
    const base = {
      id: nuevoId(), usuarioId, capturadoEn: new Date().toISOString(), estado: "por_enviar" as const, intentos: 0, hecho: {}, precios,
      ...(gps.pos ? { gps: { lat: gps.pos.lat, lng: gps.pos.lng, precision: gps.pos.precision } } : {}),
      ...(faltaFiscal
        ? { fiscal: { tipoPersona: d.fiscal.tipoPersona, rfc: d.fiscal.rfc, razonSocial: d.fiscal.razonSocial, celular: d.fiscal.celular || undefined, aceptoAviso: d.fiscal.aviso } }
        : {}),
    };
    if (d.nueva) {
      const idCliente = nuevoId();
      return {
        ...base,
        tortilleria: { id: idTemporal(idCliente), nombre: normalizarTexto(d.nv.nombre), domicilio: domicilioLocal(), lat: d.pin!.lat, lng: d.pin!.lng },
        nueva: { idCliente, datos: pedirNv(), fotoIdCliente: nuevoId(), foto: d.foto, ...(confirmoNoDuplicado ? { confirmoNoDuplicado: true } : {}) },
      };
    }
    const t = d.tortilleria!;
    return { ...base, tortilleria: { id: t.id, nombre: t.nombre, domicilio: t.domicilio, lat: t.lat, lng: t.lng } };
  }

  async function enviar(confirmoNoDuplicado = false) {
    setEnviando(true);
    setError("");
    setAvisos([]);
    let etapa = "";
    try {
      // 0) Cuenta nueva: se crea con el mismo formulario y la sesión inicia sola. Requiere conexión.
      let usuarioId = sesion?.usuario.id ?? leerSesion()?.usuario.id;
      if (conCuenta && !creada.cuenta) {
        etapa = "cuenta";
        if (!navigator.onLine) throw new Error("Necesitas conexión para crear tu cuenta o iniciar sesión. Hazlo antes de salir a campo.");
        const s = await api<Sesion>("/auth/registro", { json: d.cuenta });
        guardarSesion(s); // desde aquí las llamadas siguientes ya van con la sesión
        alSesion(s);
        usuarioId = s.usuario.id;
        setCreada((c) => ({ ...c, cuenta: true }));
      }
      etapa = "guardar";
      if (!usuarioId) throw new Error("Necesitas conexión para crear tu cuenta o iniciar sesión. Hazlo antes de salir a campo.");

      // Tortillería nueva: si el catálogo del teléfono ya tiene una parecida a 50 m, se le pregunta al censador
      if (d.nueva && !confirmoNoDuplicado && d.pin) {
        const par = parecidas(d.pin, d.nv.nombre);
        if (par.length) {
          setParecidasLocal(par);
          return;
        }
      }

      const paquete = armarPaquete(usuarioId, confirmoNoDuplicado);
      await guardarPaquete(paquete);
      if (paquete.fiscal && !esTemporal(paquete.tortilleria.id)) await marcarFiscalLocal(paquete.tortilleria.id);
      await borrarBorrador();

      // Con señal se envía en seguida; sin ella queda guardado y sale solo cuando regrese
      if (navigator.onLine) await sincronizar({ forzar: true });
      const p = (await listarPaquetes(usuarioId)).find((x) => x.id === paquete.id);
      const pendientes = (await listarPaquetes(usuarioId)).filter((x) => x.estado !== "enviado").length;
      const dia = (n: string) => n;
      void dia;
      setResultado(
        p?.estado === "enviado"
          ? { tipo: "enviado", pendientes }
          : p?.estado === "conflicto" || p?.estado === "error"
            ? { tipo: p.estado, mensaje: p.mensaje, pendientes }
            : { tipo: "guardado", pendientes },
      );
      setAvisos(p?.precios.filter((x) => x.estado === "conflicto").map((x) => `${x.mensaje ?? ""} Podrás actualizarla mañana.`) ?? []);
      setListo(true);
    } catch (e) {
      if (etapa === "cuenta") {
        setPasoId("cuenta");
        setError(e instanceof ApiError && e.status === 429 ? "Demasiados intentos. Inténtalo más tarde." : (e as Error).message);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setEnviando(false);
    }
  }

  /** "Sí, usar esa": la parecida del catálogo es la misma; se sigue con ella en lugar de dar de alta otra */
  function usarParecida(t: Local) {
    setParecidasLocal(null);
    setD((x) => ({
      ...x, nueva: false, tortilleria: { id: t.id, nombre: t.nombre, domicilio: t.domicilio, estatus: t.estatus, lat: t.lat, lng: t.lng, razon_social: t.razon_social },
      foto: undefined, fotoUrl: undefined, precioMaiz: "", precioMasa: "",
    }));
    setTieneFiscal(esTemporal(t.id) ? t.tiene_fiscal : t.tiene_fiscal);
    setHoy(undefined);
    setPasoId(t.tiene_fiscal ? "precio" : "fiscal");
  }

  function otra() {
    if (d.fotoUrl) URL.revokeObjectURL(d.fotoUrl);
    setD({ ...inicial, estado: d.estado, municipio: d.municipio, zonaManual: d.zonaManual });
    setCreada((c) => ({ cuenta: c.cuenta }));
    setTieneFiscal(undefined);
    setHoy(undefined);
    setFiltro("");
    setConCuenta(false); // la cuenta ya existe
    setCaso("mapa");
    setModoMapa("elegir");
    setAvisos([]);
    setResultado(undefined);
    setListo(false);
    setPasoId("tortilleria");
    pedirGps();
  }

  /* ---------------- pantallas ---------------- */
  if (preparando)
    return (
      <div className="marco-pc mx-auto flex h-dvh max-w-xl flex-col items-center justify-center gap-3 bg-gradient-to-b from-guinda-oscuro to-guinda p-8 text-center text-white lg:max-w-2xl">
        <Loader2 className="h-9 w-9 animate-spin text-dorado" aria-hidden />
        <p className="text-sm text-white/80">Un momento…</p>
        {error && <Aviso>{error}</Aviso>}
      </div>
    );

  if (listo)
    return (
      <div className="marco-pc mx-auto flex h-dvh max-w-xl flex-col items-center justify-center gap-5 bg-gradient-to-b from-guinda-oscuro to-guinda p-8 text-center text-white lg:max-w-2xl">
        <div className="paso grid h-24 w-24 place-items-center rounded-full bg-white/15 ring-8 ring-white/10">
          {resultado?.tipo === "guardado" ? <CloudOff className="h-14 w-14 text-dorado" aria-hidden /> : resultado?.tipo === "conflicto" || resultado?.tipo === "error" ? <TriangleAlert className="h-14 w-14 text-dorado" aria-hidden /> : <CircleCheck className="h-14 w-14 text-dorado" aria-hidden />}
        </div>
        <div className="paso">
          <h1 className="text-2xl font-bold">
            {conCuenta ? "¡Registro completo!" : resultado?.tipo === "guardado" ? "Guardado en tu teléfono" : resultado?.tipo === "conflicto" || resultado?.tipo === "error" ? "Revisa tu captura" : "¡Captura enviada!"}
          </h1>
          <p className="mt-1.5 text-sm text-white/80">
            {resultado?.tipo === "guardado"
              ? `Se enviará sola cuando haya señal.${resultado.pendientes > 0 ? ` Tienes ${resultado.pendientes} ${resultado.pendientes === 1 ? "captura por enviar" : "capturas por enviar"}.` : ""}`
              : resultado?.tipo === "conflicto" || resultado?.tipo === "error"
                ? `${resultado.mensaje ?? "El servidor no pudo aceptarla todavía."} La encuentras en tu panel para resolverla.`
                : conCuenta
              ? "Creamos tu cuenta, iniciaste sesión y registramos el precio. Entrando a tu panel…"
              : d.nueva
                ? "Gracias por tu aportación. La tortillería nueva quedó por validar y los precios serán revisados."
                : "Gracias por tu aportación. Los precios quedaron registrados y serán revisados."}
          </p>
          {avisos.map((a) => (
            <p key={a} className="mx-auto mt-2 max-w-sm rounded-xl bg-white/10 px-3 py-2 text-xs text-white/90">{a}</p>
          ))}
        </div>
        <div className="mt-2 w-full max-w-sm space-y-2">
          <Boton onClick={otra} icono={RotateCcw} className="!bg-white !bg-none !text-guinda !shadow-xl">
            Registrar otra tortillería
          </Boton>
          <Boton variante="fantasma" onClick={alTerminar} className="!text-white/80 hover:!bg-white/10">
            {conCuenta ? "Entrar a mi panel" : "Ir a mi panel"}
          </Boton>
        </div>
      </div>
    );

  const m = META[id];
  const buscaEn: Record<string, string> = { estado: "Buscar estado", municipio: "Buscar municipio" };
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const filtrar = (items: Item[]) => items.filter((i) => norm(i.nombre).includes(norm(filtro)));
  const llena = id === "foto";

  // El mapa trae su propia cabecera y no usa el botón "Continuar"
  if (id === "tortilleria")
    return (
      <div className="marco-pc mx-auto flex h-dvh max-w-xl flex-col overflow-hidden bg-guinda-oscuro lg:max-w-2xl">
        <PasoTortilleria
          cab={{
            paso: paso + 1,
            // marcando una tortillería nueva, el recorrido ya es el del caso B
            total: modoMapa === "marcar" ? armarPasos({ caso, zonaManual: d.zonaManual, nueva: true, faltaFiscal: true, conCuenta }).length : pasos.length,
            atras: paso > 0 ? () => ir(-1) : alSalir,
          }}
          zona={{ estado: d.estado, municipio: d.municipio, centro, manual: d.zonaManual }}
          gps={gps}
          alMiUbicacion={pedirGps}
          alOtraZona={otraZona}
          alElegir={elegirTortilleria}
          modo={modoMapa}
          setModo={(x) => {
            setModoMapa(x);
            if (x === "elegir") setD((v) => ({ ...v, nueva: false }));
          }}
          pin={d.pin}
          setPin={(pn) => set({ pin: pn })}
          alConfirmarPin={confirmarPin}
        />
      </div>
    );

  const numeroOk = d.nv.sinNumero || d.nv.numeroExt.trim() !== "";
  const Req = ({ children }: { children: ReactNode }) => <>{children} *</>;

  return (
    <div className="marco-pc mx-auto flex h-dvh max-w-xl flex-col overflow-hidden bg-guinda-oscuro lg:max-w-2xl">
      <Cabecera paso={paso + 1} total={pasos.length} titulo={m.titulo} subtitulo={m.sub} icono={m.icono} atras={paso > 0 ? () => ir(-1) : alSalir}>
        {buscaEn[id] && <Buscador value={filtro} onChange={setFiltro} placeholder={buscaEn[id]} />}
      </Cabecera>

      <Hoja>
        <div
          key={id}
          className={`paso min-h-0 flex-1 overscroll-contain px-3 pb-2 pt-5 ${llena ? "flex flex-col gap-2 overflow-hidden" : "space-y-2 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,#000_20px,#000_calc(100%-8px),transparent)]"}`}
        >
          {id === "estado" &&
            filtrar(estados).map((e) => (
              <Opcion key={e.clave} icono={Landmark} activo={d.estado?.clave === e.clave} onClick={() => set({ estado: e, municipio: undefined })}>
                <span className="font-medium">{e.nombre}</span>
              </Opcion>
            ))}

          {id === "municipio" &&
            filtrar(municipios).slice(0, 120).map((mu) => (
              <Opcion key={mu.clave} icono={Building2} activo={d.municipio?.clave === mu.clave} onClick={() => set({ municipio: mu })}>
                <span className="font-medium">{mu.nombre}</span>
              </Opcion>
            ))}

          {id === "nueva" && (
            <>
              <h2 className="flex items-center gap-2 px-1 text-sm font-bold text-guinda"><Store className="h-4 w-4" aria-hidden /> Negocio</h2>
              <Campo etiqueta="Nombre de la tortillería *" icono={Store} value={d.nv.nombre} autoComplete="off" onChange={(e) => setNv({ nombre: normalizarTexto(e.target.value) })} placeholder="Ej. TORTILLERIA LA GUADALUPE" error={tocadoNv(d.nv.nombre) ? errNv("nombre") : undefined} valido={!errNv("nombre")} />
              <TelefonoCampo etiqueta="Teléfono de la tortillería *" name="telefono-tortilleria" value={d.nv.telefono} onChange={(v) => setNv({ telefono: v })} error={tocadoNv(d.nv.telefono) ? errNv("telefono") : undefined} ayuda="10 dígitos con lada; toca +52 si es de otro país" />
              <Campo etiqueta="Correo electrónico de la tortillería (opcional)" icono={Mail} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" autoComplete="off" name="correo-tortilleria" value={d.nv.correo} onChange={(e) => setNv({ correo: e.target.value })} placeholder="Ej. tortilleria@correo.com" error={tocadoNv(d.nv.correo) ? errNv("correo") : undefined} valido={tocadoNv(d.nv.correo) && !errNv("correo")} ayuda="Es el correo del negocio, no el tuyo (no es con el que te registraste)." />
              <Selector etiqueta="Personal ocupado *" icono={Users} value={d.nv.personalOcupado} onChange={(e) => setNv({ personalOcupado: e.target.value })} placeholder="Elige un rango" opciones={PERSONAL_OCUPADO.map((v) => ({ valor: v, texto: v }))} />

              <h2 className="flex items-center gap-2 px-1 pt-3 text-sm font-bold text-guinda"><MapPin className="h-4 w-4" aria-hidden /> Dirección</h2>
              <Selector etiqueta="Estado *" icono={Landmark} value={d.estado?.clave ?? ""} onChange={(e) => set({ estado: estados.find((x) => x.clave === e.target.value), municipio: undefined })} placeholder="Elige el estado" opciones={estados.map((x) => ({ valor: x.clave, texto: x.nombre }))} />
              <Selector etiqueta="Municipio *" icono={Building2} value={d.municipio?.clave ?? ""} disabled={!d.estado} onChange={(e) => set({ municipio: municipios.find((x) => x.clave === e.target.value) })} placeholder={d.estado ? "Elige el municipio" : "Primero el estado"} opciones={municipios.map((x) => ({ valor: x.clave, texto: x.nombre }))} />
              <Campo etiqueta="Localidad *" icono={Landmark} value={d.nv.localidad} autoComplete="off" onChange={(e) => setNv({ localidad: normalizarTexto(e.target.value) })} placeholder="Ej. CIUDAD DE MEXICO" error={tocadoNv(d.nv.localidad) ? errNv("localidad") : undefined} valido={!errNv("localidad")} />
              <Selector etiqueta="Tipo de vialidad *" icono={Route} value={d.nv.tipoVial} onChange={(e) => setNv({ tipoVial: e.target.value })} opciones={TIPOS_VIAL.map((v) => ({ valor: v, texto: v }))} />
              <Campo etiqueta="Nombre de la vialidad (calle) *" icono={Route} value={d.nv.calle} autoComplete="off" onChange={(e) => setNv({ calle: normalizarTexto(e.target.value) })} placeholder="Ej. HIDALGO" error={tocadoNv(d.nv.calle) ? errNv("calle") : undefined} valido={!errNv("calle")} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Campo etiqueta="Núm. exterior *" icono={Hash} value={d.nv.sinNumero ? "SN" : d.nv.numeroExt} disabled={d.nv.sinNumero} autoComplete="off" onChange={(e) => setNv({ numeroExt: normalizarTexto(e.target.value) })} placeholder="Ej. 123" valido={numeroOk} />
                  <label className="mt-1.5 flex cursor-pointer items-center gap-2 px-1 text-xs text-stone-600">
                    <input type="checkbox" className="h-4 w-4 accent-guinda" checked={d.nv.sinNumero} onChange={(e) => setNv({ sinNumero: e.target.checked, numeroExt: "" })} />
                    Sin número (SN)
                  </label>
                </div>
                <Campo etiqueta="Núm. interior (opcional)" icono={Hash} value={d.nv.numeroInt} autoComplete="off" onChange={(e) => setNv({ numeroInt: normalizarTexto(e.target.value) })} placeholder="Ej. 2" />
              </div>
              <Campo etiqueta="Colonia *" icono={Building2} value={d.nv.colonia} autoComplete="off" onChange={(e) => setNv({ colonia: normalizarTexto(e.target.value) })} placeholder="Ej. CENTRO" error={tocadoNv(d.nv.colonia) ? errNv("colonia") : undefined} valido={!errNv("colonia")} />
              <Campo etiqueta="Código postal *" icono={Hash} value={d.nv.codigoPostal} inputMode="numeric" maxLength={5} autoComplete="off" onChange={(e) => setNv({ codigoPostal: e.target.value.replace(/\D/g, "").slice(0, 5) })} placeholder="Ej. 09700" error={tocadoNv(d.nv.codigoPostal) ? errNv("codigoPostal") : undefined} valido={!errNv("codigoPostal")} />
              <p className="flex items-center gap-1.5 px-1 pt-1 text-xs text-stone-500">
                <MapPin className="h-3.5 w-3.5 text-dorado" aria-hidden /> La ubicación es el punto que marcaste en el mapa.
              </p>
            </>
          )}

          {id === "foto" && (
            <>
              <div className="min-h-0 flex-1 overflow-hidden rounded-2xl">
                {d.fotoUrl ? (
                  <img src={d.fotoUrl} alt="Vista previa de la tortillería" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center rounded-2xl border-2 border-dashed border-stone-300 bg-white text-stone-400">
                    <div className="text-center">
                      <Camera className="mx-auto h-12 w-12" aria-hidden />
                      <p className="mt-2 text-sm">Aún no hay foto</p>
                      <p className="mt-0.5 text-xs">Es obligatoria para las tortillerías nuevas</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-2">
                <Boton onClick={() => inputCamara.current?.click()} icono={Camera}>{d.foto ? "Otra foto" : "Tomar foto"}</Boton>
                <Boton variante="secundario" onClick={() => inputGaleria.current?.click()} icono={ImagePlus}>Galería</Boton>
              </div>
              <input ref={inputCamara} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { recibirFoto(e.target.files?.[0]); e.target.value = ""; }} />
              <input ref={inputGaleria} type="file" accept="image/*" className="sr-only" onChange={(e) => { recibirFoto(e.target.files?.[0]); e.target.value = ""; }} />
            </>
          )}

          {id === "fiscal" && (
            <>
              <p className="px-1 text-xs leading-snug text-stone-500">
                Son datos de la empresa, no tuyos. Se piden una sola vez por tortillería: después ya no se vuelven a pedir.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Chip activo={d.fiscal.tipoPersona === "fisica"} onClick={() => setFiscal({ tipoPersona: "fisica", rfc: "" })}>Persona física</Chip>
                <Chip activo={d.fiscal.tipoPersona === "moral"} onClick={() => setFiscal({ tipoPersona: "moral", rfc: "" })}>Persona moral</Chip>
              </div>
              <Campo
                etiqueta={d.fiscal.tipoPersona === "moral" ? "Razón social *" : "Nombre del titular del RFC *"}
                icono={d.fiscal.tipoPersona === "moral" ? Building2 : Briefcase}
                value={d.fiscal.razonSocial}
                autoCapitalize="characters"
                autoComplete="off"
                onChange={(e) => setFiscal({ razonSocial: normalizarTexto(e.target.value) })}
                error={errFiscal("razonSocial")}
                valido={!errFiscal("razonSocial")}
                placeholder={d.fiscal.tipoPersona === "moral" ? "Ej. TORTILLERIA LA GUADALUPE SA DE CV" : "Ej. JOSE ANGEL NUÑEZ PEREZ"}
                ayuda={d.tortilleria?.razon_social && !d.nueva ? "Viene del catálogo del DENUE: corrígela si no es la correcta" : undefined}
              />
              <Campo
                etiqueta="RFC *"
                icono={FileText}
                value={d.fiscal.rfc}
                maxLength={d.fiscal.tipoPersona === "fisica" ? 13 : 12}
                autoCapitalize="characters"
                autoComplete="off"
                onChange={(e) => setFiscal({ rfc: e.target.value.toUpperCase().replace(/[^A-ZÑ&0-9]/g, "") })}
                error={errFiscal("rfc")}
                valido={!errFiscal("rfc")}
                placeholder={d.fiscal.tipoPersona === "fisica" ? "Ej. NUPJ850101AB1" : "Ej. TGU100101AB1"}
                ayuda={d.fiscal.tipoPersona === "fisica" ? "13 caracteres" : "12 caracteres"}
              />
              <TelefonoCampo etiqueta="Celular de contacto (opcional)" value={d.fiscal.celular} onChange={(v) => setFiscal({ celular: v })} error={errFiscal("celular")} ayuda="10 dígitos con lada; toca +52 si es de otro país" />
              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-guinda" checked={d.fiscal.aviso} onChange={(e) => setFiscal({ aviso: e.target.checked })} />
                <span className="text-xs leading-snug">
                  <ShieldCheck className="mr-1 inline h-4 w-4 text-verde" aria-hidden />
                  Acepto el aviso de privacidad para el tratamiento de estos datos. El RFC y el celular se guardan cifrados.
                </span>
              </label>
            </>
          )}

          {id === "cuenta" && (
            <>
              <p className="text-sm leading-snug text-stone-600">
                Con tu correo y contraseña entrarás a tu panel para ver tus tortillerías, actualizar precios y registrar más. Tu cuenta se crea al enviar.
              </p>
              <Campo
                etiqueta="Correo electrónico"
                icono={Mail}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                value={d.cuenta.correo}
                onChange={(e) => set({ cuenta: { ...d.cuenta, correo: e.target.value } })}
                error={errCuenta("correo")}
                valido={!errCuenta("correo")}
                placeholder="Ej. tucorreo@ejemplo.com"
              />
              <Campo
                etiqueta="Contraseña"
                icono={KeyRound}
                type={verPass ? "text" : "password"}
                autoComplete="new-password"
                value={d.cuenta.password}
                onChange={(e) => set({ cuenta: { ...d.cuenta, password: e.target.value } })}
                error={errCuenta("password")}
                ayuda={`Mínimo ${PASSWORD_MIN} caracteres`}
                derecha={
                  <button type="button" onClick={() => setVerPass(!verPass)} aria-label={verPass ? "Ocultar contraseña" : "Mostrar contraseña"} className="grid h-10 w-10 place-items-center rounded-full text-stone-400 hover:text-stone-700">
                    {verPass ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                }
              />
              <Campo
                etiqueta="Confirmar contraseña"
                icono={KeyRound}
                type={verPass ? "text" : "password"}
                autoComplete="new-password"
                value={d.cuenta.confirmar}
                onChange={(e) => set({ cuenta: { ...d.cuenta, confirmar: e.target.value } })}
                error={errCuenta("confirmar")}
                placeholder="Repite tu contraseña"
              />
            </>
          )}

          {id === "precio" && (
            <>
              <div className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-stone-200">
                <Store className="h-4 w-4 shrink-0 text-guinda" aria-hidden />
                <span className="min-w-0 truncate font-semibold">{d.nueva ? d.nv.nombre || "Tortillería nueva" : d.tortilleria?.nombre}</span>
              </div>
              {hoy === undefined ? (
                <div className="grid place-items-center py-8 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : (
                <>
                  <p className="px-1 text-xs text-stone-500">Anota el precio por kilo de la tortilla y de la masa. Los dos son obligatorios.</p>
                  {PRODUCTOS.map((p) => {
                    const ya = hoy[p.id];
                    const valor = d[p.clave];
                    const malo = valor !== "" && !precioValido(valor);
                    const num = precioNumero(valor);
                    const mover = (delta: number) => {
                      const base = valor === "" || malo ? 20 : num;
                      const nuevoValor = Math.min(PRECIO_MAX, Math.max(PRECIO_MIN, Math.round((base + delta) * 100) / 100));
                      set({ [p.clave]: nuevoValor.toFixed(2) } as Partial<Datos>);
                    };
                    return (
                      <div key={p.id} className={`rounded-2xl bg-white p-3.5 shadow-sm ring-1 ${ya != null ? "ring-emerald-200" : malo ? "ring-red-300" : valor !== "" ? "ring-emerald-300" : "ring-stone-200"}`}>
                        <div className="mb-2 flex items-center gap-2.5">
                          <span className="grid h-9 w-9 place-items-center rounded-xl bg-guinda/10 text-guinda"><p.icono className="h-5 w-5" aria-hidden /></span>
                          <div className="min-w-0 flex-1 leading-tight">
                            <p className="text-sm font-bold">{p.texto}</p>
                            <p className="text-xs text-stone-500">Precio por kilo (MXN)</p>
                          </div>
                          {ya != null || (valor !== "" && !malo) ? (
                            <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white"><Check className="h-4 w-4" strokeWidth={3} aria-hidden /></span>
                          ) : (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Obligatorio</span>
                          )}
                        </div>
                        {ya != null ? (
                          <p className="rounded-xl bg-emerald-50 px-3 py-3 text-center text-sm font-medium text-emerald-800">
                            Ya capturaste hoy: <b className="text-lg">{dinero(ya)}</b>
                            <span className="block text-xs font-normal">Podrás actualizarlo mañana.</span>
                          </p>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <button type="button" onClick={() => mover(-0.5)} aria-label={`Bajar 50 centavos el precio de ${p.texto}`} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-700 active:scale-95 active:bg-stone-200">
                                <Minus className="h-5 w-5" aria-hidden />
                              </button>
                              <span className={`flex min-w-0 flex-1 items-center rounded-xl bg-stone-50 px-3 ring-1 transition focus-within:ring-4 ${malo ? "ring-red-300 focus-within:ring-red-100" : "ring-stone-200 focus-within:ring-guinda/15"}`}>
                                <span className="text-2xl font-bold text-stone-300">$</span>
                                <input
                                  inputMode="decimal"
                                  value={valor}
                                  onChange={(e) => set({ [p.clave]: limpiarPrecio(e.target.value) } as Partial<Datos>)}
                                  placeholder="0.00"
                                  aria-label={`Precio por kilo de ${p.texto}`}
                                  className="w-full min-w-0 bg-transparent px-1 py-2.5 text-center text-3xl font-bold outline-none placeholder:text-stone-200"
                                />
                              </span>
                              <button type="button" onClick={() => mover(0.5)} aria-label={`Subir 50 centavos el precio de ${p.texto}`} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-guinda text-white active:scale-95 active:brightness-90">
                                <Plus className="h-5 w-5" aria-hidden />
                              </button>
                            </div>
                            {malo && <p className="mt-2 text-center text-xs text-red-600">Debe estar entre ${PRECIO_MIN} y ${PRECIO_MAX}.</p>}
                          </>
                        )}
                      </div>
                    );
                  })}
                  {!todoCapturado && faltan.length > 0 && (
                    <p className="px-1 text-center text-xs text-amber-700">Falta el precio de {faltan.map((f) => (f.id === "maiz" ? "la tortilla" : "la masa")).join(" y ")}.</p>
                  )}
                  {todoCapturado && <Aviso tipo="info">Ya capturaste hoy la tortilla y la masa de esta tortillería. Podrás volver a capturarlos mañana.</Aviso>}
                </>
              )}
            </>
          )}

          {id === "resumen" && (
            <div className="divide-y divide-stone-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200">
              <Fila icono={Store} k="Tortillería" v={d.nueva ? `${d.nv.nombre} (nueva)` : d.tortilleria?.nombre ?? ""} />
              <Fila icono={MapPin} k="Dirección" v={d.nueva ? [d.nv.tipoVial, d.nv.calle, d.nv.sinNumero ? "SN" : d.nv.numeroExt, d.nv.numeroInt && `INT. ${d.nv.numeroInt}`, `COL. ${d.nv.colonia}`, `C.P. ${d.nv.codigoPostal}`].filter(Boolean).join(" ") : d.tortilleria?.domicilio ?? "Sin dirección"} />
              {PRODUCTOS.filter((p) => activo(p) && d[p.clave] !== "").map((p) => (
                <Fila key={p.id} icono={p.icono} k={p.texto} v={`${dinero(precioNumero(d[p.clave]))} por kilo`} />
              ))}
              {d.nueva && <Fila icono={Camera} k="Foto" v="Incluida" />}
              {pasos.includes("fiscal") && (
                <>
                  <Fila icono={FileText} k={`RFC (${d.fiscal.tipoPersona === "fisica" ? "persona física" : "persona moral"})`} v={d.fiscal.rfc} />
                  <Fila icono={d.fiscal.tipoPersona === "moral" ? Building2 : Briefcase} k={d.fiscal.tipoPersona === "moral" ? "Razón social" : "Titular del RFC"} v={d.fiscal.razonSocial} />
                </>
              )}
              {conCuenta && <Fila icono={Mail} k="Tu cuenta" v={d.cuenta.correo} />}
            </div>
          )}

          {error && <Aviso>{error}</Aviso>}
        </div>
      </Hoja>

      <Barra>
        {id === "resumen" ? (
          <Boton onClick={() => enviar()} disabled={enviando} icono={enviando ? Loader2 : Send}>
            {enviando ? "Enviando…" : conCuenta ? "Crear cuenta y enviar" : "Enviar captura"}
          </Boton>
        ) : (
          <Boton onClick={() => ir(1)} disabled={!puede[id]} icono={Check}>
            Continuar
          </Boton>
        )}
      </Barra>
    </div>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition active:scale-[.97] ${activo ? "bg-guinda text-white shadow-md shadow-guinda/25" : "bg-white text-stone-600 ring-1 ring-stone-200"}`}
    >
      {children}
    </button>
  );
}

function Fila({ icono: Icono, k, v }: { icono: LucideIcon; k: string; v: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-guinda/10 text-guinda">
        <Icono className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 leading-tight">
        <div className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{k}</div>
        <div className="truncate text-[15px] font-semibold">{v}</div>
      </div>
    </div>
  );
}
