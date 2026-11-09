import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Banknote, BarChart3, LineChart, Map as MapaIcono, CalendarDays, Check, ClipboardCheck, ExternalLink, FileText, Fingerprint, Hash, Loader2, Mail, MapPin, Phone, Store, TriangleAlert,
  UserRound, Users, Wheat, X, PackageOpen, Layers, Building2, Landmark, ShieldCheck, Camera, ClipboardList, CheckCheck, UserCog,
} from "lucide-react";
import { api, type Sesion } from "./api";
import FotoAuth from "./FotoAuth";
import Perfil from "./Perfil";
import { CLAVES, usePersistente } from "./persist";
import { Aviso, Boton, HojaModal, Insignia, PanelShell, Tarjeta, Vacio } from "./ui";
import AdminResumen, { type Resumen } from "./AdminResumen";
import AdminMapa, { type FocoMapa } from "./AdminMapa";
import AdminEstadisticas from "./AdminEstadisticas";
import { EnVivo, useVivo } from "./AdminVivo";

type TortilleriaAdm = {
  id: string; nombre: string; domicilio: string | null; estatus: string; origen: string; creado_en: string; lat: number | null; lng: number | null;
  municipio: string | null; estado: string | null; creador: string | null; n_fotos: number;
  localidad: string | null; tipo_vial: string | null; calle: string | null; numero_ext: string | null; numero_int: string | null; colonia: string | null;
  codigo_postal: string | null; telefono: string | null; correo: string | null; personal_ocupado: string | null; codigo_scian: string | null;
  fecha_alta: string | null; tiene_fiscal: boolean;
};
type CapturaAdm = {
  id: string; producto: "maiz" | "harina" | "masa"; precio_kg: string; fecha: string; estatus: string; alerta: boolean; tortilleria_id: string;
  nombre: string; municipio: string | null; estado: string | null; capturista: string | null;
};
type UsuarioAdm = { id: string; correo: string | null; usuario: string; nombre: string; apellidos: string; rol: string; activo: boolean; creado_en: string; capturas: number };
/** Datos fiscales de la tortillería; si solo hay un registro viejo de responsable, llega con legado = true */
type Fiscal = { tipoPersona: string; razonSocial: string; rfc: string; celular: string | null; legado?: boolean; responsable?: { nombre: string; apellidos: string } };

const PRODUCTO = { maiz: { t: "Maíz", i: Wheat }, harina: { t: "Harina", i: PackageOpen }, masa: { t: "Masa", i: Layers } };
const fecha = (s: string) => new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

export default function PanelAdmin({
  sesion, alActualizarSesion, alSalir,
}: { sesion: Sesion; alActualizarSesion: (s: Sesion) => void; alSalir: () => void }) {
  const esAdmin = sesion.usuario.rol === "admin";
  const [tabGuardada, setTab] = usePersistente(CLAVES.tabAdmin, "resumen");
  const tab = tabGuardada === "usuarios" && !esAdmin ? "resumen" : tabGuardada; // por si cambió su rol
  const [resumen, setResumen] = useState<Resumen>();
  const [foco, setFoco] = useState<FocoMapa>();
  const [detalleId, setDetalleId] = useState<string>();

  // El resumen y el contador de pendientes se actualizan solos
  const vivo = useVivo(async () => setResumen(await api<Resumen>("/admin/resumen")), 20_000);
  const cargarResumen = useCallback(() => api<Resumen>("/admin/resumen").then(setResumen).catch(() => {}), []);

  const alMapa = useCallback((f?: FocoMapa) => {
    if (f) setFoco({ ...f }); // objeto nuevo: vuelve a acercar aunque sea la misma zona
    setTab("mapa");
  }, [setTab]);

  const pendientes = (resumen?.tortillerias_pendientes ?? 0) + (resumen?.capturas_pendientes ?? 0);

  return (
    <PanelShell
      completo
      plano={tab === "mapa"}
      titulo={esAdmin ? "Administración" : "Supervisión"}
      subtitulo={{ resumen: "Resumen general", mapa: "Mapa de precios por tortillería", estadisticas: "Estadísticas por estado y municipio", revision: "Revisión de registros", usuarios: "Usuarios del sistema", perfil: "Tu cuenta" }[tab]}
      derecha={<span className="hidden sm:block"><EnVivo oscuro ultima={vivo.ultima} fallo={vivo.fallo} /></span>}
      pestañas={[
        { id: "resumen", texto: "Resumen", icono: BarChart3 },
        { id: "mapa", texto: "Mapa", icono: MapaIcono },
        { id: "estadisticas", texto: "Estadísticas", icono: LineChart },
        { id: "revision", texto: "Revisión", icono: ClipboardCheck, insignia: pendientes },
        ...(esAdmin ? [{ id: "usuarios", texto: "Usuarios", icono: Users }] : []),
        { id: "perfil", texto: "Perfil", icono: UserRound },
      ]}
      activa={tab}
      alCambiar={setTab}
    >
      {tab === "resumen" && <AdminResumen r={resumen} ultima={vivo.ultima} fallo={vivo.fallo} alRevisar={() => setTab("revision")} alEstadisticas={() => setTab("estadisticas")} alMapa={alMapa} />}
      {tab === "mapa" && <AdminMapa foco={foco} alDetalle={setDetalleId} />}
      {tab === "estadisticas" && <AdminEstadisticas alMapa={alMapa} />}
      {tab === "revision" && <VistaRevision alCambio={cargarResumen} />}
      {tab === "usuarios" && esAdmin && <VistaUsuarios miId={sesion.usuario.id} />}
      {tab === "perfil" && <Perfil sesion={sesion} alActualizar={alActualizarSesion} alSalir={alSalir} />}
      {detalleId && <DetalleDesdeMapa id={detalleId} alCerrar={() => setDetalleId(undefined)} alCambio={cargarResumen} />}
    </PanelShell>
  );
}

/** Abre el detalle de una tortillería elegida en el mapa (con foto, datos fiscales y botones de revisión) */
function DetalleDesdeMapa({ id, alCerrar, alCambio }: { id: string; alCerrar: () => void; alCambio: () => void }) {
  const [t, setT] = useState<TortilleriaAdm | null>();
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api<TortilleriaAdm>(`/admin/tortillerias/${id}`).then(setT).catch((e) => { setError(e.message); setT(null); });
  }, [id]);

  async function resolver(tid: string, estatus: "validada" | "rechazada") {
    setTrabajando(true);
    try {
      await api(`/tortillerias/${tid}/estatus`, { metodo: "PATCH", json: { estatus } });
      alCambio();
      alCerrar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTrabajando(false);
    }
  }

  if (t === undefined)
    return (
      <HojaModal titulo="Tortillería" alCerrar={alCerrar}>
        <div className="grid place-items-center py-10 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      </HojaModal>
    );
  if (t === null)
    return (
      <HojaModal titulo="Tortillería" alCerrar={alCerrar}>
        <Aviso>{error || "No se pudo cargar la tortillería."}</Aviso>
      </HojaModal>
    );
  return <DetalleTortilleria t={t} trabajando={trabajando} alCerrar={alCerrar} alResolver={resolver} />;
}

/* ---------------- Revisión ---------------- */
function VistaRevision({ alCambio }: { alCambio: () => void }) {
  const [seccion, setSeccion] = useState<"tortillerias" | "precios">("tortillerias");
  const [estatus, setEstatus] = useState<"pendiente" | "validada" | "rechazada">("pendiente");
  const [tortillerias, setTortillerias] = useState<TortilleriaAdm[]>();
  const [capturas, setCapturas] = useState<CapturaAdm[]>();
  const [detalle, setDetalle] = useState<TortilleriaAdm>();
  const [trabajando, setTrabajando] = useState<string>();
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    setTortillerias(undefined);
    setCapturas(undefined);
    Promise.all([api<TortilleriaAdm[]>(`/admin/tortillerias?estatus=${estatus}`), api<CapturaAdm[]>(`/admin/capturas?estatus=${estatus}`)])
      .then(([t, c]) => { setTortillerias(t); setCapturas(c); setError(""); })
      .catch((e) => setError(e.message));
  }, [estatus]);
  useEffect(cargar, [cargar]);

  async function resolverCaptura(id: string, nuevo: "validada" | "rechazada") {
    setTrabajando(id);
    try {
      await api(`/admin/capturas/${id}`, { metodo: "PATCH", json: { estatus: nuevo } });
      setCapturas((l) => l?.filter((c) => c.id !== id));
      alCambio();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTrabajando(undefined);
    }
  }

  async function resolverTortilleria(id: string, nuevo: "validada" | "rechazada") {
    setTrabajando(id);
    try {
      await api(`/tortillerias/${id}/estatus`, { metodo: "PATCH", json: { estatus: nuevo } });
      setTortillerias((l) => l?.filter((t) => t.id !== id));
      setDetalle(undefined);
      alCambio();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTrabajando(undefined);
    }
  }

  const chip = (activo: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${activo ? "bg-guinda text-white shadow" : "bg-white text-stone-600 ring-1 ring-stone-200"}`;

  return (
    <>
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-stone-200/70 p-1">
        {(["tortillerias", "precios"] as const).map((s) => (
          <button key={s} onClick={() => setSeccion(s)} className={`rounded-xl py-2 text-sm font-semibold transition ${seccion === s ? "bg-white text-guinda shadow" : "text-stone-500"}`}>
            {s === "tortillerias" ? `Tortillerías${tortillerias ? ` (${tortillerias.length})` : ""}` : `Precios${capturas ? ` (${capturas.length})` : ""}`}
          </button>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        <button className={chip(estatus === "pendiente")} onClick={() => setEstatus("pendiente")}>Por revisar</button>
        <button className={chip(estatus === "validada")} onClick={() => setEstatus("validada")}>Aprobadas</button>
        <button className={chip(estatus === "rechazada")} onClick={() => setEstatus("rechazada")}>Rechazadas</button>
      </div>

      {error && <Aviso>{error}</Aviso>}

      {seccion === "tortillerias" &&
        (!tortillerias ? (
          <div className="grid place-items-center py-10 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : tortillerias.length === 0 ? (
          <Vacio icono={CheckCheck} titulo={estatus === "pendiente" ? "Todo al día" : "Sin resultados"} texto={estatus === "pendiente" ? "No hay tortillerías por revisar." : undefined} />
        ) : (
          tortillerias.map((t) => (
            <button key={t.id} onClick={() => setDetalle(t)} className="block w-full text-left">
              <Tarjeta className="flex items-start gap-3 transition active:scale-[.98]">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-guinda/10 text-guinda"><Store className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-semibold leading-tight">{t.nombre}</p>
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
          ))
        ))}

      {seccion === "precios" &&
        (!capturas ? (
          <div className="grid place-items-center py-10 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : capturas.length === 0 ? (
          <Vacio icono={CheckCheck} titulo={estatus === "pendiente" ? "Todo al día" : "Sin resultados"} texto={estatus === "pendiente" ? "No hay precios por revisar." : undefined} />
        ) : (
          capturas.map((c) => {
            const P = PRODUCTO[c.producto];
            return (
              <Tarjeta key={c.id} className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold leading-tight">{c.nombre}</p>
                    <p className="truncate text-xs text-stone-500">{[c.municipio, c.estado].filter(Boolean).join(", ")}</p>
                  </div>
                  <Insignia estatus={c.estatus} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-sm text-stone-600"><P.i className="h-4 w-4" aria-hidden /> {P.t}</span>
                  <span className="text-xl font-bold">${Number(c.precio_kg).toFixed(2)}<span className="text-xs font-medium text-stone-400"> /kg</span></span>
                </div>
                {c.alerta && (
                  <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Precio atípico respecto a la mediana del municipio
                  </div>
                )}
                <p className="truncate text-xs text-stone-400">{c.capturista ?? "Sin usuario"} · {fecha(c.fecha)}</p>
                {c.estatus === "pendiente" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Boton variante="peligro" className="!min-h-10" disabled={trabajando === c.id} icono={X} onClick={() => resolverCaptura(c.id, "rechazada")}>Rechazar</Boton>
                    <Boton className="!min-h-10" disabled={trabajando === c.id} icono={trabajando === c.id ? Loader2 : Check} onClick={() => resolverCaptura(c.id, "validada")}>Aprobar</Boton>
                  </div>
                )}
              </Tarjeta>
            );
          })
        ))}

      {detalle && <DetalleTortilleria t={detalle} trabajando={trabajando === detalle.id} alCerrar={() => setDetalle(undefined)} alResolver={resolverTortilleria} />}
    </>
  );
}

function DetalleTortilleria({
  t, trabajando, alCerrar, alResolver,
}: { t: TortilleriaAdm; trabajando: boolean; alCerrar: () => void; alResolver: (id: string, e: "validada" | "rechazada") => void }) {
  const [fotos, setFotos] = useState<{ id: string }[]>();
  const [fiscal, setFiscal] = useState<Fiscal | null>();
  const [foto, setFoto] = useState(0);
  const sinFoto = t.origen === "nueva" && (fotos === undefined ? t.n_fotos === 0 : fotos.length === 0);

  useEffect(() => {
    api<{ id: string }[]>(`/admin/tortillerias/${t.id}/fotos`).then(setFotos).catch(() => setFotos([]));
    api<Fiscal>(`/tortillerias/${t.id}/fiscal`).then(setFiscal).catch(() => setFiscal(null));
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
    <HojaModal titulo={t.nombre} alCerrar={alCerrar}>
      <div className="flex items-center justify-between">
        <Insignia estatus={t.estatus} />
        <span className="text-xs text-stone-400">{fecha(t.creado_en)}</span>
      </div>

      {fotos === undefined ? (
        <div className="aspect-[4/3] animate-pulse rounded-2xl bg-stone-200" />
      ) : fotos.length === 0 ? (
        <div className="grid aspect-[4/3] place-items-center rounded-2xl bg-stone-100 text-stone-400"><Camera className="h-8 w-8" aria-hidden /></div>
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

      <Tarjeta className="divide-y divide-stone-100 !py-1">
        <Fila i={Building2} k="Ubicación" v={[t.municipio, t.estado].filter(Boolean).join(", ") || "—"} />
        <Fila i={MapPin} k="Domicilio" v={t.domicilio ?? "—"} />
        {t.localidad && <Fila i={Building2} k="Localidad" v={t.localidad} />}
        {(t.tipo_vial || t.calle) && <Fila i={MapPin} k="Vialidad" v={[t.tipo_vial, t.calle].filter(Boolean).join(" ")} />}
        {(t.numero_ext || t.numero_int) && <Fila i={Hash} k="Número" v={[t.numero_ext && `Ext. ${t.numero_ext}`, t.numero_int && `Int. ${t.numero_int}`].filter(Boolean).join(" · ")} />}
        {t.colonia && <Fila i={Building2} k="Colonia" v={t.colonia} />}
        {t.codigo_postal && <Fila i={Hash} k="Código postal" v={t.codigo_postal} />}
        {t.telefono && <Fila i={Phone} k="Teléfono de la tortillería" v={t.telefono} />}
        {t.correo && <Fila i={Mail} k="Correo de la tortillería" v={t.correo} />}
        {t.personal_ocupado && <Fila i={Users} k="Personal ocupado" v={t.personal_ocupado} />}
        {t.fecha_alta && <Fila i={CalendarDays} k="Fecha de alta" v={t.fecha_alta} />}
        <Fila i={UserRound} k="Registrada por" v={t.creador ?? "DENUE"} />
      </Tarjeta>
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

      <Tarjeta className="!py-2">
        <h3 className="flex items-center gap-2 py-1 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-verde" aria-hidden /> Datos fiscales</h3>
        {fiscal === undefined ? (
          <p className="py-2 text-sm text-stone-400">Cargando…</p>
        ) : fiscal === null ? (
          <p className="py-2 text-sm text-stone-500">Aún no tiene datos fiscales: se piden la primera vez que se captura su precio.</p>
        ) : (
          <div className="divide-y divide-stone-100">
            <Fila i={FileText} k={`RFC (${fiscal.tipoPersona === "fisica" ? "persona física" : "persona moral"})`} v={fiscal.rfc} />
            <Fila i={Building2} k={fiscal.tipoPersona === "moral" ? "Razón social" : "Titular del RFC"} v={fiscal.razonSocial} />
            {fiscal.celular && <Fila i={Phone} k="Celular de contacto" v={fiscal.celular} />}
            {fiscal.legado && fiscal.responsable && <Fila i={UserRound} k="Responsable (registro anterior)" v={`${fiscal.responsable.nombre} ${fiscal.responsable.apellidos}`} />}
          </div>
        )}
        <p className="pt-1 text-[11px] text-stone-400">La consulta de datos fiscales queda registrada en la auditoría.</p>
      </Tarjeta>

      {t.estatus === "pendiente" && (
        <div className="grid grid-cols-2 gap-2">
          <Boton variante="peligro" disabled={trabajando} icono={X} onClick={() => alResolver(t.id, "rechazada")}>Rechazar</Boton>
          <Boton disabled={trabajando || sinFoto} icono={trabajando ? Loader2 : Check} onClick={() => alResolver(t.id, "validada")}>Validar</Boton>
        </div>
      )}
      {t.estatus === "pendiente" && sinFoto && (
        <p className="flex items-center gap-1.5 text-xs text-amber-700">
          <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden /> Una tortillería nueva no se puede validar sin foto.
        </p>
      )}
    </HojaModal>
  );
}

/* ---------------- Usuarios (solo administrador) ---------------- */
function VistaUsuarios({ miId }: { miId: string }) {
  const [usuarios, setUsuarios] = useState<UsuarioAdm[]>();
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState<string>();

  useEffect(() => {
    api<UsuarioAdm[]>("/admin/usuarios").then(setUsuarios).catch((e) => setError(e.message));
  }, []);

  async function cambiar(u: UsuarioAdm, cambio: Partial<Pick<UsuarioAdm, "rol" | "activo">>) {
    setTrabajando(u.id);
    setError("");
    try {
      await api(`/admin/usuarios/${u.id}`, { metodo: "PATCH", json: cambio });
      setUsuarios((l) => l?.map((x) => (x.id === u.id ? { ...x, ...cambio } : x)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTrabajando(undefined);
    }
  }

  if (!usuarios) return <div className="grid place-items-center py-12 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <>
      {error && <Aviso>{error}</Aviso>}
      <p className="px-1 text-xs text-stone-500">{usuarios.length} cuenta(s). Puedes cambiar el rol o desactivar el acceso.</p>
      {usuarios.map((u) => {
        const yo = u.id === miId;
        return (
          <Tarjeta key={u.id} className={`space-y-2 ${u.activo ? "" : "opacity-60"}`}>
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-guinda/10 font-bold text-guinda">
                {(u.nombre || u.correo || u.usuario).charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold leading-tight">{u.correo ?? u.usuario}</p>
                <p className="truncate text-xs text-stone-500">{[u.nombre, u.apellidos].filter(Boolean).join(" ") || "Sin nombre"} · {u.capturas} captura(s)</p>
              </div>
              {yo && <span className="rounded-full bg-verde/10 px-2 py-0.5 text-[11px] font-semibold text-verde">Tú</span>}
            </div>
            <div className="flex items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <UserCog className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                <select
                  value={u.rol}
                  disabled={yo || trabajando === u.id}
                  onChange={(e) => cambiar(u, { rol: e.target.value })}
                  aria-label={`Rol de ${u.correo ?? u.usuario}`}
                  className="h-10 min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-2 text-base disabled:opacity-60"
                >
                  <option value="capturista">Usuario</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <button
                role="switch"
                aria-checked={u.activo}
                aria-label={u.activo ? "Desactivar cuenta" : "Activar cuenta"}
                disabled={yo || trabajando === u.id}
                onClick={() => cambiar(u, { activo: !u.activo })}
                className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${u.activo ? "bg-verde" : "bg-stone-300"}`}
              >
                <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${u.activo ? "left-[1.4rem]" : "left-0.5"}`} />
              </button>
            </div>
          </Tarjeta>
        );
      })}
    </>
  );
}
