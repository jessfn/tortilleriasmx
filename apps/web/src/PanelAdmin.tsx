import { formatearTelefono, permisosEfectivos, type Permiso } from "@tortillerias/shared";
import { NegativasFiscales } from "./NegativasFiscales";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowUpDown, Banknote, BarChart3, LineChart, Map as MapaIcono, CalendarDays, Check, ClipboardCheck, ExternalLink, FileText, Fingerprint, Hash, ChevronDown, ChevronLeft, ChevronRight, Clock, Eye, History, Loader2, Search, Mail, MapPin, Navigation, Phone, Store, TriangleAlert,
  UserRound, Users, Wheat, X, PackageOpen, Layers, Building2, KeyRound, Copy, Landmark, ShieldCheck, Camera, ClipboardList, CheckCheck, UserCog,
} from "lucide-react";
import { api, type Sesion } from "./api";
import FotoAuth from "./FotoAuth";
import Perfil from "./Perfil";
import { CLAVES, usePersistente } from "./persist";
import { Aviso, Boton, HojaModal, Insignia, Tarjeta, Vacio } from "./ui";
import MiniMapa from "./MiniMapa";
import { Paginacion, POR_PAGINA, type Pagina } from "./Paginacion";
import { Buscador, SelectorFiltro } from "./Filtros";
import AdminAuditoria from "./AdminAuditoria";
import AdminUsuarios from "./AdminUsuarios";
import { distanciaM } from "./catalogo";
import AdminBarra from "./AdminBarra";
import AdminResumen, { type Resumen } from "./AdminResumen";
import AdminMapa, { type FocoMapa } from "./AdminMapa";
import AdminEstadisticas from "./AdminEstadisticas";
import { useVivo } from "./AdminVivo";

export type TortilleriaAdm = {
  id: string; nombre: string; domicilio: string | null; estatus: string; origen: string; creado_en: string; lat: number | null; lng: number | null;
  municipio: string | null; estado: string | null; creador: string | null; n_fotos: number;
  localidad: string | null; tipo_vial: string | null; calle: string | null; numero_ext: string | null; numero_int: string | null; colonia: string | null;
  codigo_postal: string | null; telefono: string | null; correo: string | null; personal_ocupado: string | null; codigo_scian: string | null;
  fecha_alta: string | null; tiene_fiscal: boolean;
};
export type CapturaAdm = {
  id: string; producto: "maiz" | "harina" | "masa"; precio_kg: string; fecha: string; estatus: string; alerta: boolean; tortilleria_id: string;
  nombre: string; municipio: string | null; estado: string | null; capturista: string | null;
  /** dónde y cuándo se hizo la captura (el GPS puede faltar) */
  precision_gps?: number | null; captura_lat?: number | null; captura_lng?: number | null; capturado_en?: string | null;
  /** mediana del municipio al capturar, con cuántos precios se calculó, y cómo se aprobó */
  mediana_ref?: number | null; n_ref?: number | null; aprobacion?: string | null;
};
/** Datos fiscales de la tortillería; si solo hay un registro viejo de responsable, llega con legado = true */
export type Fiscal = { tipoPersona: string; razonSocial: string; rfc: string; celular: string | null; legado?: boolean; responsable?: { nombre: string; apellidos: string } };

const PRODUCTO = { maiz: { t: "Tortilla", i: Wheat }, harina: { t: "Harina", i: PackageOpen }, masa: { t: "Masa", i: Layers } };
const fecha = (s: string) => new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
/** Día de una captura ("AAAA-MM-DD", día de México): se arma sin pasar por UTC para que no se corra un día */
const dia = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
};

export default function PanelAdmin({
  sesion, alActualizarSesion, alSalir, alInicio,
}: { sesion: Sesion; alActualizarSesion: (s: Sesion) => void; alSalir: () => void; alInicio?: () => void }) {
  const esAdmin = sesion.usuario.rol === "admin";
  const [tabGuardada, setTab] = usePersistente(CLAVES.tabAdmin, "resumen");
  const [resumen, setResumen] = useState<Resumen>();
  const [foco, setFoco] = useState<FocoMapa>();

  // Qué pantallas y acciones tiene esta cuenta (un administrador, todas). Es lo que muestra la pantalla; el servidor lo exige en cada petición.
  const permisos = new Set<string>(sesion.usuario.permisos ?? permisosEfectivos(sesion.usuario.rol, null));
  const puede = (c: Permiso) => permisos.has(c);
  const pestañasDisponibles = [
    ...(puede("ver_resumen") ? [{ id: "resumen", texto: "Resumen", icono: BarChart3 }] : []),
    ...(puede("ver_mapa") ? [{ id: "mapa", texto: "Mapa", icono: MapaIcono }] : []),
    ...(puede("ver_estadisticas") ? [{ id: "estadisticas", texto: "Estadísticas", icono: LineChart }] : []),
    ...(puede("ver_revision") ? [{ id: "revision", texto: "Revisión", icono: ClipboardCheck, insignia: undefined as number | undefined }] : []),
    ...(puede("ver_usuarios_app") || esAdmin ? [{ id: "usuarios", texto: "Usuarios", icono: Users }] : []),
    ...(esAdmin ? [{ id: "auditoria", texto: "Auditoría", icono: History }] : []),
    { id: "perfil", texto: "Perfil", icono: UserRound },
  ];
  const tab = pestañasDisponibles.some((p) => p.id === tabGuardada) ? tabGuardada : pestañasDisponibles[0].id; // por si cambiaron sus permisos

  // El resumen y el contador de pendientes se actualizan solos
  const vivo = useVivo(async () => {
    if (puede("ver_resumen")) setResumen(await api<Resumen>("/admin/resumen"));
  }, 20_000);
  const cargarResumen = useCallback(() => (permisos.has("ver_resumen") ? api<Resumen>("/admin/resumen").then(setResumen).catch(() => {}) : Promise.resolve()), []); // eslint-disable-line react-hooks/exhaustive-deps

  const alMapa = useCallback((f?: FocoMapa) => {
    if (f) setFoco({ ...f }); // objeto nuevo: vuelve a acercar aunque sea la misma zona
    setTab("mapa");
  }, [setTab]);

  const pendientes = (resumen?.tortillerias_pendientes ?? 0) + (resumen?.capturas_pendientes ?? 0);

  return (
    <AdminBarra
      usuario={sesion.usuario}
      pendientes={pendientes}
      alInicio={alInicio}
      alSalir={alSalir}
      plano={tab === "mapa" || tab === "revision" || tab === "usuarios" || tab === "auditoria"}
      titulo={esAdmin ? "Administración" : "Supervisión"}
      vivo={vivo}
      pestañas={pestañasDisponibles.map((p) => (p.id === "revision" ? { ...p, insignia: pendientes } : p))}
      activa={tab}
      alCambiar={setTab}
    >
      {tab === "resumen" && (
        <AdminResumen
          r={resumen}
          ultima={vivo.ultima}
          fallo={vivo.fallo}
          alRevisar={() => puede("ver_revision") && setTab("revision")}
          alEstadisticas={() => puede("ver_estadisticas") && setTab("estadisticas")}
          alMapa={(f) => puede("ver_mapa") && alMapa(f)}
          puedeEstadisticas={puede("ver_estadisticas")}
          puedeMapa={puede("ver_mapa")}
          puedeRevision={puede("ver_revision")}
        />
      )}
      {tab === "mapa" && <AdminMapa foco={foco} alCambio={cargarResumen} puedeValidar={puede("validar_tortillerias")} />}
      {tab === "estadisticas" && <AdminEstadisticas alMapa={(f) => puede("ver_mapa") && alMapa(f)} puedeExportar={puede("exportar_capturas")} />}
      {tab === "revision" && <VistaRevision alCambio={cargarResumen} puedeRevisar={puede("revisar_precios")} puedeValidar={puede("validar_tortillerias")} />}
      {tab === "usuarios" && (puede("ver_usuarios_app") || esAdmin) && (
        <AdminUsuarios miId={sesion.usuario.id} esAdmin={esAdmin} puedeVerApp={puede("ver_usuarios_app")} puedeGestionarApp={puede("gestionar_usuarios_app")} />
      )}
      {tab === "auditoria" && esAdmin && <AdminAuditoria />}
      {tab === "perfil" && <Perfil sesion={sesion} alActualizar={alActualizarSesion} alSalir={alSalir} />}
    </AdminBarra>
  );
}

/* ---------------- Revisión ---------------- */

function VistaRevision({ alCambio, puedeRevisar, puedeValidar }: { alCambio: () => void; puedeRevisar: boolean; puedeValidar: boolean }) {
  const [seccion, setSeccion] = useState<"tortillerias" | "precios">("tortillerias");
  const [estatus, setEstatus] = useState<"pendiente" | "validada" | "rechazada">("pendiente");
  const [pagina, setPagina] = useState(1);
  const [limite, setLimite] = useState(50);
  const [tortillerias, setTortillerias] = useState<Pagina<TortilleriaAdm>>();
  const [capturas, setCapturas] = useState<Pagina<CapturaAdm>>();
  /** cuántas hay de cada una (sin filtros de búsqueda): es el número de cada pestaña */
  const [totales, setTotales] = useState<{ tortillerias?: number; precios?: number }>({});
  /** buscar, ordenar y filtrar: se aplican en el servidor, sobre TODA la lista y no solo la página que se ve */
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [orden, setOrden] = useState("recientes");
  const [foto, setFoto] = useState(""); //      tortillerías nuevas: con o sin foto
  const [producto, setProducto] = useState(""); // precios: tortilla o masa
  const [detalle, setDetalle] = useState<TortilleriaAdm>();
  /** "Ver más detalles" de un precio por revisar: la tortillería completa y la captura que se está revisando */
  const [detalleCaptura, setDetalleCaptura] = useState<{ t: TortilleriaAdm; c: CapturaAdm }>();
  const [abriendo, setAbriendo] = useState<string>();
  const [trabajando, setTrabajando] = useState<string>();
  const [error, setError] = useState("");
  const zona = useRef<HTMLDivElement>(null);
  /** precios atípicos marcados para aprobar o rechazar de un jalón */
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [masivo, setMasivo] = useState<"validada" | "rechazada">();

  // "Tortillerías nuevas" = solo las que dieron de alta los censadores (las del DENUE no se revisan aquí)
  const ruta = (s: "tortillerias" | "precios") => (s === "tortillerias" ? "/admin/tortillerias?origen=nueva" : "/admin/capturas?v=1");
  const actual = seccion === "tortillerias" ? tortillerias : capturas;
  const total = actual?.total ?? 0;
  const paginas = actual?.paginas ?? 1;

  const cargar = useCallback(() => {
    const filtros = new URLSearchParams();
    if (q) filtros.set("q", q);
    if (orden !== "recientes") filtros.set("orden", orden);
    if (seccion === "tortillerias" && foto) filtros.set("foto", foto);
    if (seccion === "precios" && producto) filtros.set("producto", producto);
    Promise.all([
      api<Pagina<TortilleriaAdm | CapturaAdm>>(`${ruta(seccion)}&estatus=${estatus}&pagina=${pagina}&limite=${limite}&${filtros}`),
      api<Pagina<unknown>>(`${ruta("tortillerias")}&estatus=${estatus}&pagina=1&limite=1`),
      api<Pagina<unknown>>(`${ruta("precios")}&estatus=${estatus}&pagina=1&limite=1`),
    ])
      .then(([a, t, c]) => {
        // si se vació la última página (p. ej. al aprobar el único registro de ella), se retrocede
        if (!a.filas.length && pagina > 1) return setPagina(Math.max(1, a.paginas));
        if (seccion === "tortillerias") setTortillerias(a as Pagina<TortilleriaAdm>);
        else setCapturas(a as Pagina<CapturaAdm>);
        setTotales({ tortillerias: t.total, precios: c.total });
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [seccion, estatus, pagina, limite, q, orden, foto, producto]);
  useEffect(() => {
    if (seccion === "tortillerias") setTortillerias(undefined);
    else setCapturas(undefined);
    cargar();
  }, [cargar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    zona.current?.scrollTo({ top: 0 });
    setMarcados(new Set());
  }, [seccion, estatus, pagina, limite, q, orden, foto, producto]);
  // el texto de búsqueda se envía un momento después de escribir
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(busqueda.trim());
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [busqueda]);

  // cada sección tiene sus propios órdenes y filtros: al cambiar de sección se empieza de cero
  const cambiarSeccion = (s: typeof seccion) => {
    setSeccion(s);
    setPagina(1);
    setOrden("recientes");
    setFoto("");
    setProducto("");
    setBusqueda("");
    setQ("");
  };
  const cambiarEstatus = (e: typeof estatus) => { setEstatus(e); setPagina(1); };

  async function resolverCaptura(id: string, nuevo: "validada" | "rechazada") {
    setTrabajando(id);
    try {
      await api(`/admin/capturas/${id}`, { metodo: "PATCH", json: { estatus: nuevo } });
      alCambio();
      cargar(); // la lista se rellena con el siguiente registro de la página
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTrabajando(undefined);
    }
  }

  /** Aprobar o rechazar varios precios a la vez (máximo 200 por petición) */
  async function resolverVarios(nuevo: "validada" | "rechazada") {
    const ids = [...marcados];
    if (!ids.length) return;
    setMasivo(nuevo);
    try {
      await api("/admin/capturas", { metodo: "PATCH", json: { ids, estatus: nuevo } });
      setMarcados(new Set());
      alCambio();
      cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setMasivo(undefined);
    }
  }
  const alternar = (id: string) =>
    setMarcados((m) => {
      const n = new Set(m);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  async function verCaptura(c: CapturaAdm) {
    setAbriendo(c.id);
    setError("");
    try {
      setDetalleCaptura({ t: await api<TortilleriaAdm>(`/admin/tortillerias/${c.tortilleria_id}`), c });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAbriendo(undefined);
    }
  }

  async function resolverTortilleria(id: string, nuevo: "validada" | "rechazada") {
    setTrabajando(id);
    try {
      await api(`/tortillerias/${id}/estatus`, { metodo: "PATCH", json: { estatus: nuevo } });
      setDetalle(undefined);
      alCambio();
      cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTrabajando(undefined);
    }
  }

  const chip = (activo: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${activo ? "bg-guinda text-white shadow" : "bg-white text-stone-600 ring-1 ring-stone-200"}`;
  const desde = total === 0 ? 0 : (pagina - 1) * limite + 1;
  const hasta = Math.min(pagina * limite, total);
  const vacio = (txt: string) => <Vacio icono={CheckCheck} titulo={estatus === "pendiente" ? "Todo al día" : "Sin resultados"} texto={estatus === "pendiente" ? txt : undefined} />;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[92rem] flex-col gap-2.5 px-3 pb-3 pt-4 lg:px-6 lg:pb-5">
      <div className="flex shrink-0 flex-col gap-2 md:flex-row md:items-center md:gap-4">
        {/* Qué se revisa: tortillerías nuevas o precios capturados, cada una con su cuenta */}
        <div role="tablist" aria-label="Qué revisar" className="grid w-full grid-cols-2 gap-1 rounded-2xl bg-stone-200/70 p-1 md:w-[30rem]">
          {(["tortillerias", "precios"] as const).map((s) => {
            const on = seccion === s;
            const Icono = s === "tortillerias" ? Store : Banknote;
            const n = totales[s];
            return (
              <button
                key={s}
                role="tab"
                aria-selected={on}
                onClick={() => cambiarSeccion(s)}
                className={`flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-xl px-2 text-[13px] font-semibold transition sm:text-sm ${on ? "bg-white text-guinda shadow" : "text-stone-500 hover:text-stone-700"}`}
              >
                <span className={`hidden h-7 w-7 shrink-0 place-items-center rounded-full sm:grid ${on ? "bg-guinda/10" : "bg-stone-300/50"}`}><Icono className="h-4 w-4" aria-hidden /></span>
                <span className="min-w-0 text-center leading-tight">{s === "tortillerias" ? "Tortillerías nuevas" : estatus === "pendiente" ? "Precios atípicos por revisar" : "Precios capturados"}</span>
                {n !== undefined && (
                  <span className={`grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-bold ${on ? "bg-guinda text-white" : "bg-stone-300/70 text-stone-600"}`}>{n}</span>
                )}
              </button>
            );
          })}
        </div>
        {/* Estatus: en el celular reparten el ancho; en pantallas grandes van en una fila */}
        <div role="tablist" aria-label="Estatus" className="grid grid-cols-3 gap-1.5 md:flex">
          {([["pendiente", "Por revisar"], ["validada", "Aprobadas"], ["rechazada", "Rechazadas"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={estatus === k} className={`${chip(estatus === k)} min-h-9 text-center`} onClick={() => cambiarEstatus(k)}>{t}</button>
          ))}
        </div>
      </div>

      {/* Buscar, ordenar y filtrar la lista según lo que se esté revisando */}
      <div className="flex shrink-0 flex-col gap-2 md:flex-row md:items-center">
        <Buscador
          valor={busqueda}
          alCambiar={setBusqueda}
          etiqueta="Buscar"
          placeholder={seccion === "tortillerias" ? "Buscar nombre, municipio o quién la registró" : "Buscar tortillería, municipio o censador"}
        />
        <div className="grid grid-cols-2 gap-2 md:flex md:shrink-0">
          <div className="md:w-56">
            <SelectorFiltro
              icono={ArrowUpDown}
              etiqueta="Ordenar por"
              valor={orden}
              activo={orden !== "recientes"}
              alCambiar={(v) => { setOrden(v); setPagina(1); }}
              opciones={
                seccion === "tortillerias"
                  ? [{ valor: "recientes", texto: "Más recientes" }, { valor: "antiguas", texto: "Más antiguas" }, { valor: "nombre", texto: "Nombre (A–Z)" }, { valor: "fotos", texto: "Con más fotos" }]
                  : [
                      { valor: "recientes", texto: "Más recientes" },
                      { valor: "antiguas", texto: "Más antiguos" },
                      { valor: "diferencia", texto: "Mayor diferencia" },
                      { valor: "precio_alto", texto: "Precio más alto" },
                      { valor: "precio_bajo", texto: "Precio más bajo" },
                    ]
              }
            />
          </div>
          <div className="md:w-52">
            {seccion === "tortillerias" ? (
              <SelectorFiltro
                icono={Camera}
                etiqueta="Filtrar por foto"
                valor={foto}
                activo={!!foto}
                alCambiar={(v) => { setFoto(v); setPagina(1); }}
                opciones={[{ valor: "", texto: "Con y sin foto" }, { valor: "con", texto: "Solo con foto" }, { valor: "sin", texto: "Solo sin foto" }]}
              />
            ) : (
              <SelectorFiltro
                icono={Wheat}
                etiqueta="Filtrar por producto"
                valor={producto}
                activo={!!producto}
                alCambiar={(v) => { setProducto(v); setPagina(1); }}
                opciones={[{ valor: "", texto: "Tortilla y masa" }, { valor: "maiz", texto: "Solo tortilla" }, { valor: "masa", texto: "Solo masa" }]}
              />
            )}
          </div>
        </div>
      </div>

      {error && <Aviso>{error}</Aviso>}

      {puedeRevisar && seccion === "precios" && estatus === "pendiente" && !!capturas?.filas.length && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-sm ring-1 ring-stone-200">
          <label className="flex min-h-9 cursor-pointer items-center gap-2 text-xs font-semibold text-stone-600">
            <input
              type="checkbox"
              className="h-5 w-5 accent-guinda"
              checked={marcados.size > 0 && marcados.size === capturas.filas.length}
              onChange={(e) => setMarcados(e.target.checked ? new Set(capturas.filas.map((c) => c.id)) : new Set())}
            />
            {marcados.size ? `${marcados.size} seleccionado${marcados.size === 1 ? "" : "s"}` : "Seleccionar todos"}
          </label>
          <div className="ml-auto flex gap-2">
            <Boton variante="peligro" className="!min-h-9 !px-3 !text-xs" disabled={!marcados.size || !!masivo} icono={masivo === "rechazada" ? Loader2 : X} onClick={() => resolverVarios("rechazada")}>Rechazar seleccionados</Boton>
            <Boton className="!min-h-9 !px-3 !text-xs" disabled={!marcados.size || !!masivo} icono={masivo === "validada" ? Loader2 : Check} onClick={() => resolverVarios("validada")}>Aprobar seleccionados</Boton>
          </div>
        </div>
      )}

      {/* El recuadro ocupa lo que queda de la pantalla: la lista se desplaza dentro de él y la paginación queda siempre a la vista */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200" aria-label={seccion === "tortillerias" ? "Tortillerías nuevas" : estatus === "pendiente" ? "Precios atípicos por revisar" : "Precios capturados"}>
        <div ref={zona} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-stone-50/70 p-2.5">
          {!actual ? (
            <div className="grid place-items-center py-16 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : actual.filas.length === 0 ? (
            vacio(seccion === "tortillerias" ? "No hay tortillerías nuevas por revisar." : "No hay precios atípicos por revisar: los demás se aprueban solos.")
          ) : seccion === "tortillerias" ? (
            <div className="grid content-start gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {(tortillerias?.filas ?? []).map((t) => (
                <button key={t.id} onClick={() => setDetalle(t)} className="block w-full text-left">
                  <Tarjeta className="flex h-full items-start gap-3 transition active:scale-[.98]">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-guinda/10 text-guinda"><Store className="h-5 w-5" aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="[display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden break-words font-semibold leading-tight">{t.nombre}</p>
                        <Insignia estatus={t.estatus} />
                      </div>
                      <p className="truncate text-xs text-stone-500">{[t.municipio, t.estado].filter(Boolean).join(", ") || "Sin ubicación"}</p>
                      <p className="mt-1 flex items-center gap-3 text-xs text-stone-400">
                        <span className="flex items-center gap-1"><Camera className="h-3 w-3" aria-hidden /> {t.n_fotos}</span>
                        <span className="truncate">{t.creador ?? "DENUE"}</span>
                        <span className="ml-auto shrink-0">{fecha(t.creado_en)}</span>
                      </p>
                    </div>
                  </Tarjeta>
                </button>
              ))}
            </div>
          ) : (
            <div className="grid content-start gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {(capturas?.filas ?? []).map((c) => {
                const P = PRODUCTO[c.producto];
                return (
                  <Tarjeta key={c.id} className={`space-y-2 ${marcados.has(c.id) ? "ring-2 ring-guinda" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      {puedeRevisar && c.estatus === "pendiente" && (
                        <input type="checkbox" aria-label={`Seleccionar el precio de ${c.nombre}`} className="mt-0.5 h-5 w-5 shrink-0 accent-guinda" checked={marcados.has(c.id)} onChange={() => alternar(c.id)} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="[display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden break-words font-semibold leading-tight">{c.nombre}</p>
                        <p className="truncate text-xs text-stone-500">{[c.municipio, c.estado].filter(Boolean).join(", ")}</p>
                      </div>
                      <Insignia estatus={c.estatus} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm text-stone-600"><P.i className="h-4 w-4" aria-hidden /> {P.t}</span>
                      <span className="text-xl font-bold">${Number(c.precio_kg).toFixed(2)}<span className="text-xs font-medium text-stone-400"> /kg</span></span>
                    </div>
                    {c.alerta && <AvisoAtipico c={c} />}
                    <p className="truncate text-xs text-stone-400">{c.capturista ?? "Sin usuario"} · {dia(c.fecha)}</p>
                    <Boton variante="secundario" className="!min-h-10 !text-sm" disabled={abriendo === c.id} icono={abriendo === c.id ? Loader2 : Eye} onClick={() => verCaptura(c)}>
                      Ver más detalles
                    </Boton>
                    {puedeRevisar && c.estatus === "pendiente" && (
                      <div className="grid grid-cols-2 gap-2">
                        <Boton variante="peligro" className="!min-h-10" disabled={trabajando === c.id} icono={X} onClick={() => resolverCaptura(c.id, "rechazada")}>Rechazar</Boton>
                        <Boton className="!min-h-10" disabled={trabajando === c.id} icono={trabajando === c.id ? Loader2 : Check} onClick={() => resolverCaptura(c.id, "validada")}>Aprobar</Boton>
                      </div>
                    )}
                  </Tarjeta>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-stone-200 bg-white px-3 py-2 text-xs text-stone-500">
          <span>{total === 0 ? "Sin registros" : <>Mostrando <b className="text-stone-700">{desde}–{hasta}</b> de <b className="text-stone-700">{total}</b></>}</span>
          <div className="flex items-center gap-3">
            <label className="hidden items-center gap-1.5 sm:flex">
              Por página
              <select value={limite} onChange={(e) => { setLimite(Number(e.target.value)); setPagina(1); }} className="rounded-lg border border-stone-200 bg-white px-1.5 py-1 text-xs text-stone-700">
                {POR_PAGINA.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-1">
              <button onClick={() => setPagina(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior" className="grid h-8 w-8 place-items-center rounded-lg bg-stone-100 text-stone-700 transition active:scale-95 disabled:opacity-40">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[5.5rem] text-center font-medium text-stone-700">Página {pagina} de {paginas}</span>
              <button onClick={() => setPagina(pagina + 1)} disabled={pagina >= paginas} aria-label="Página siguiente" className="grid h-8 w-8 place-items-center rounded-lg bg-stone-100 text-stone-700 transition active:scale-95 disabled:opacity-40">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </footer>
      </section>

      {detalleCaptura && (
        <DetalleTortilleria
          t={detalleCaptura.t}
          captura={detalleCaptura.c}
          puedeRevisar={puedeRevisar}
          puedeValidar={puedeValidar}
          trabajando={trabajando === detalleCaptura.c.id}
          alCerrar={() => setDetalleCaptura(undefined)}
          alResolver={resolverTortilleria}
          alResolverCaptura={async (id, nuevo) => {
            await resolverCaptura(id, nuevo);
            setDetalleCaptura(undefined);
          }}
        />
      )}
      {detalle && <DetalleTortilleria t={detalle} puedeRevisar={puedeRevisar} puedeValidar={puedeValidar} trabajando={trabajando === detalle.id} alCerrar={() => setDetalle(undefined)} alResolver={resolverTortilleria} />}
    </div>
  );
}

function DetalleTortilleria({
  t, captura, trabajando, alCerrar, alResolver, alResolverCaptura, puedeRevisar, puedeValidar,
}: {
  /** qué acciones tiene permitidas esta cuenta */
  puedeRevisar: boolean; puedeValidar: boolean;
  t: TortilleriaAdm; trabajando: boolean; alCerrar: () => void; alResolver: (id: string, e: "validada" | "rechazada") => void;
  /** Si viene, es la revisión de un precio: se muestra la captura arriba y los botones aprueban o rechazan ese precio */
  captura?: CapturaAdm; alResolverCaptura?: (id: string, e: "validada" | "rechazada") => void;
}) {
  const [fotos, setFotos] = useState<{ id: string }[]>();
  const [fiscal, setFiscal] = useState<Fiscal | null>();
  const [foto, setFoto] = useState(0);
  const [historial, setHistorial] = useState<CapturaAdm[]>();
  const sinFoto = t.origen === "nueva" && (fotos === undefined ? t.n_fotos === 0 : fotos.length === 0);

  useEffect(() => {
    api<{ id: string }[]>(`/admin/tortillerias/${t.id}/fotos`).then(setFotos).catch(() => setFotos([]));
    api<Fiscal>(`/tortillerias/${t.id}/fiscal`).then(setFiscal).catch(() => setFiscal(null));
    api<CapturaAdm[]>(`/admin/capturas?tortilleria=${t.id}`).then(setHistorial).catch(() => setHistorial([]));
  }, [t.id]);

  const Fila = ({ i: I, k, v }: { i: typeof Store; k: string; v: string }) => (
    <div className="flex items-center gap-3 py-2">
      <I className="h-4 w-4 shrink-0 text-guinda" aria-hidden />
      <div className="min-w-0 leading-tight">
        <div className="text-[11px] uppercase tracking-wide text-stone-400">{k}</div>
        <div className="break-words text-[15px] font-medium">{v}</div>
      </div>
    </div>
  );

  return (
    <HojaModal titulo={captura ? "Revisión del precio" : t.nombre} alCerrar={alCerrar}>
      {captura ? (
        <TarjetaCaptura c={captura} t={t} />
      ) : (
        <div className="flex items-center justify-between">
          <Insignia estatus={t.estatus} />
          <span className="text-xs text-stone-400">{fecha(t.creado_en)}</span>
        </div>
      )}

      {fotos === undefined ? (
        <div className="aspect-[4/3] animate-pulse rounded-2xl bg-stone-200" />
      ) : fotos.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-stone-100 py-5 text-sm text-stone-400"><Camera className="h-5 w-5" aria-hidden /> Esta tortillería no tiene foto</div>
      ) : (
        <>
          <FotoAuth id={fotos[foto].id} className="aspect-[4/3] w-full rounded-2xl" />
          {fotos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {fotos.map((f, i) => (
                <button key={f.id} onClick={() => setFoto(i)} className={`shrink-0 overflow-hidden rounded-lg ring-2 ${i === foto ? "ring-guinda" : "ring-transparent"}`}>
                  <FotoAuth id={f.id} miniatura className="h-14 w-14" />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {t.lat != null && t.lng != null && (
        <div className="space-y-1.5">
          <MiniMapa tortilleria={{ lat: t.lat, lng: t.lng }} captura={captura?.captura_lat != null && captura.captura_lng != null ? { lat: captura.captura_lat, lng: captura.captura_lng } : null} />
          <p className="flex items-center gap-3 px-1 text-[11px] text-stone-500">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-[#7a1b3f]" aria-hidden /> Tortillería</span>
            {captura?.captura_lat != null && <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-[#2563eb]" aria-hidden /> Dónde se capturó</span>}
          </p>
        </div>
      )}
      {t.lat != null && t.lng != null && (
        <a
          href={`https://www.openstreetmap.org/?mlat=${t.lat}&mlon=${t.lng}#map=18/${t.lat}/${t.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white text-sm font-semibold text-guinda ring-1 ring-stone-200"
        >
          <ExternalLink className="h-4 w-4" aria-hidden /> Ver ubicación en el mapa
        </a>
      )}

      <Tarjeta className="divide-y divide-stone-100 !py-1">
        <Fila i={Building2} k="Ubicación" v={[t.municipio, t.estado].filter(Boolean).join(", ") || "—"} />
        <Fila i={MapPin} k="Dirección" v={t.domicilio ?? "—"} />
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center gap-1.5 text-sm font-semibold text-guinda">
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden /> <span className="group-open:hidden">Ver todos los datos</span><span className="hidden group-open:inline">Ocultar datos</span>
          </summary>
          <div className="divide-y divide-stone-100">
        {t.localidad && <Fila i={Building2} k="Localidad" v={t.localidad} />}
        {(t.tipo_vial || t.calle) && <Fila i={MapPin} k="Vialidad" v={[t.tipo_vial, t.calle].filter(Boolean).join(" ")} />}
        {(t.numero_ext || t.numero_int) && <Fila i={Hash} k="Número" v={[t.numero_ext && `Ext. ${t.numero_ext}`, t.numero_int && `Int. ${t.numero_int}`].filter(Boolean).join(" · ")} />}
        {t.colonia && <Fila i={Building2} k="Colonia" v={t.colonia} />}
        {t.codigo_postal && <Fila i={Hash} k="Código postal" v={t.codigo_postal} />}
        {t.telefono && <Fila i={Phone} k="Teléfono de la tortillería" v={formatearTelefono(t.telefono)} />}
        {t.correo && <Fila i={Mail} k="Correo de la tortillería" v={t.correo} />}
        {t.personal_ocupado && <Fila i={Users} k="Personal ocupado" v={t.personal_ocupado} />}
        {t.fecha_alta && <Fila i={CalendarDays} k="Fecha de alta" v={t.fecha_alta} />}
        <Fila i={UserRound} k="Registrada por" v={t.creador ?? "DENUE"} />
          </div>
        </details>
      </Tarjeta>

      <Tarjeta className="!py-2">
        <h3 className="flex items-center gap-2 py-1 text-sm font-bold"><Banknote className="h-4 w-4 text-guinda" aria-hidden /> Precios de esta tortillería</h3>
        {historial === undefined ? (
          <p className="py-2 text-sm text-stone-400">Cargando…</p>
        ) : historial.length === 0 ? (
          <p className="py-2 text-sm text-stone-500">Todavía no tiene precios capturados.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {historial.slice(0, 10).map((h) => {
              const P = PRODUCTO[h.producto];
              const actual = h.id === captura?.id;
              return (
                <li key={h.id} className={`flex items-center justify-between gap-2 py-2 text-sm ${actual ? "-mx-2 rounded-lg bg-guinda/5 px-2 ring-1 ring-guinda/20" : ""}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <P.i className="h-4 w-4 shrink-0 text-guinda" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{P.t}{actual ? " · este precio" : ""}</span>
                      <span className="block truncate text-[11px] text-stone-400">{dia(h.fecha)} · {h.capturista ?? "Sin usuario"}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <b>${Number(h.precio_kg).toFixed(2)}</b>
                    <Insignia estatus={h.estatus} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>

      <Tarjeta className="!py-2">
        <h3 className="flex items-center gap-2 py-1 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-verde" aria-hidden /> Datos fiscales</h3>
        {fiscal === undefined ? (
          <p className="py-2 text-sm text-stone-400">Cargando…</p>
        ) : fiscal === null ? (
          <>
<p className="py-2 text-sm text-stone-500">Aún no tiene datos fiscales: se piden la primera vez que se captura su precio.</p>
<NegativasFiscales tortilleriaId={t.id} />
</>
        ) : (
          <div className="divide-y divide-stone-100">
            <Fila i={FileText} k={`RFC (${fiscal.tipoPersona === "fisica" ? "persona física" : "persona moral"})`} v={fiscal.rfc} />
            <Fila i={Building2} k={fiscal.tipoPersona === "moral" ? "Razón social" : "Titular del RFC"} v={fiscal.razonSocial} />
            {fiscal.celular && <Fila i={Phone} k="Celular de contacto" v={formatearTelefono(fiscal.celular)} />}
            {fiscal.legado && fiscal.responsable && <Fila i={UserRound} k="Responsable (registro anterior)" v={`${fiscal.responsable.nombre} ${fiscal.responsable.apellidos}`} />}
          </div>
        )}
        <p className="pt-1 text-[11px] text-stone-400">La consulta de datos fiscales queda registrada en la auditoría.</p>
      </Tarjeta>

      {puedeRevisar && captura && alResolverCaptura && captura.estatus === "pendiente" && (
        <div className="sticky -bottom-4 -mx-4 -mb-4 grid grid-cols-2 gap-2 border-t border-stone-200 bg-stone-50/95 px-4 pb-[max(1rem,calc(var(--sb)*.35))] pt-3 backdrop-blur">
          <Boton variante="peligro" disabled={trabajando} icono={X} onClick={() => alResolverCaptura(captura.id, "rechazada")}>Rechazar precio</Boton>
          <Boton disabled={trabajando} icono={trabajando ? Loader2 : Check} onClick={() => alResolverCaptura(captura.id, "validada")}>Aprobar precio</Boton>
        </div>
      )}
      {puedeValidar && !captura && t.estatus === "pendiente" && (
        <div className="grid grid-cols-2 gap-2">
          <Boton variante="peligro" disabled={trabajando} icono={X} onClick={() => alResolver(t.id, "rechazada")}>Rechazar</Boton>
          <Boton disabled={trabajando || sinFoto} icono={trabajando ? Loader2 : Check} onClick={() => alResolver(t.id, "validada")}>Validar</Boton>
        </div>
      )}
      {puedeValidar && !captura && t.estatus === "pendiente" && sinFoto && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700">
          <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden /> Una tortillería nueva no se puede validar sin foto.
        </p>
      )}
    </HojaModal>
  );
}

/** Lo que se está revisando de un precio: cuánto, quién, cuándo, y qué tan lejos de la tortillería se capturó */
function TarjetaCaptura({ c, t }: { c: CapturaAdm; t: TortilleriaAdm }) {
  const P = PRODUCTO[c.producto];
  const lejos =
    c.captura_lat != null && c.captura_lng != null && t.lat != null && t.lng != null
      ? distanciaM({ lat: c.captura_lat, lng: c.captura_lng }, { lat: t.lat, lng: t.lng })
      : null;
  const distancia = lejos == null ? null : lejos < 1000 ? `${Math.round(lejos)} m` : `${(lejos / 1000).toFixed(1)} km`;
  return (
    <Tarjeta className="space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold leading-tight">{t.nombre}</p>
          <p className="truncate text-xs text-stone-500">{[t.municipio, t.estado].filter(Boolean).join(", ")}</p>
        </div>
        <Insignia estatus={c.estatus} />
      </div>
      <div className="flex items-center justify-between rounded-xl bg-stone-100/80 px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm text-stone-600"><P.i className="h-4 w-4 text-guinda" aria-hidden /> {P.t}</span>
        <span className="text-2xl font-bold">${Number(c.precio_kg).toFixed(2)}<span className="text-xs font-medium text-stone-400"> /kg</span></span>
      </div>
      {c.alerta && <AvisoAtipico c={c} />}
      <ul className="space-y-1 text-xs text-stone-500">
        <li className="flex items-center gap-1.5"><UserRound className="h-3.5 w-3.5 text-guinda" aria-hidden /> {c.capturista ?? "Sin usuario"}</li>
        <li className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5 text-guinda" aria-hidden />
          {c.capturado_en ? new Date(c.capturado_en).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : dia(c.fecha)}
        </li>
        <li className="flex items-center gap-1.5">
          <Navigation className="h-3.5 w-3.5 text-guinda" aria-hidden />
          {distancia ? `Se capturó a ${distancia} de la tortillería${c.precision_gps ? ` (precisión del GPS ±${Math.round(c.precision_gps)} m)` : ""}` : "Esta captura no trae ubicación GPS"}
        </li>
      </ul>
    </Tarjeta>
  );
}

/** "+42 % sobre la mediana de $25.00 (calculada con 12 precios)": por qué un precio se considera atípico */
function AvisoAtipico({ c }: { c: CapturaAdm }) {
  const med = c.mediana_ref != null ? Number(c.mediana_ref) : null;
  const dif = med ? ((Number(c.precio_kg) - med) / med) * 100 : null;
  return (
    <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900">
      <p className="flex items-center gap-1.5"><TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden /> Precio atípico respecto a la mediana del municipio</p>
      {dif !== null && med !== null && (
        <p className="mt-0.5 pl-5 font-normal">
          <b className={dif > 0 ? "text-red-700" : "text-blue-700"}>{dif > 0 ? "+" : ""}{Math.round(dif)} %</b> sobre la mediana de <b>${med.toFixed(2)}</b>
          {c.n_ref ? ` (calculada con ${c.n_ref} precios)` : ""}
        </p>
      )}
    </div>
  );
}
