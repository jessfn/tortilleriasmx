import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Building2, CalendarDays, Camera, Check, ChevronLeft, ChevronRight, ExternalLink, FileText, Hash, Layers, Loader2, Mail, MapPin, Phone, ShieldCheck, UserRound, Users, Wheat, X,
} from "lucide-react";
import { api } from "./api";
import FotoAuth from "./FotoAuth";
import { Aviso, Insignia } from "./ui";
import { dinero } from "./AdminVivo";
import type { PuntoAdm } from "./MapaAdmin";
import type { CapturaAdm, Fiscal, TortilleriaAdm } from "./PanelAdmin";

type Pestaña = "resumen" | "datos" | "fiscal" | "historial";
const PESTAÑAS: [Pestaña, string][] = [["resumen", "Resumen"], ["datos", "Datos"], ["fiscal", "Fiscal"], ["historial", "Historial"]];

const NOMBRE_PRODUCTO = { maiz: "Tortilla", harina: "Harina", masa: "Masa" } as const;
const fechaLarga = (s: string) => new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
/** Las fechas de captura vienen como "AAAA-MM-DD" (día de México): se arman sin pasar por UTC */
const diaCorto = (s: string) => {
  const [a, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
};
const hace = (s: string) => {
  const [a, m, d] = s.slice(0, 10).split("-").map(Number);
  const dias = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(a, m - 1, d).getTime()) / 86400000);
  return dias <= 0 ? "hoy" : dias === 1 ? "hace 1 día" : `hace ${dias} días`;
};

function Fila({ i: I, k, v }: { i: typeof MapPin; k: string; v: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-stone-100 py-2 last:border-0">
      <I className="h-4 w-4 shrink-0 text-guinda" aria-hidden />
      <div className="min-w-0 leading-tight">
        <div className="text-[11px] uppercase tracking-wide text-stone-400">{k}</div>
        <div className="break-words text-sm font-medium">{v}</div>
      </div>
    </div>
  );
}

function Precio({ icono: I, titulo, p }: { icono: typeof Wheat; titulo: string; p: { precio: number; fecha: string } | null | undefined }) {
  return (
    <div className="rounded-xl bg-stone-100/80 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-stone-500">
        <I className="h-3.5 w-3.5 text-guinda" aria-hidden /> {titulo}
      </div>
      {p ? (
        <>
          <div className="text-xl font-bold leading-tight">{dinero(p.precio)}</div>
          <div className="text-[11px] text-stone-400">
            {diaCorto(p.fecha)} · {hace(p.fecha)}
          </div>
        </>
      ) : (
        <div className="py-1 text-sm text-stone-400">Sin precio</div>
      )}
    </div>
  );
}

/**
 * Detalle de una tortillería elegida en el mapa: un panel lateral que no tapa el mapa (en teléfono, una hoja inferior).
 * Foto, precios, pestañas con datos, fiscales e historial, y las acciones de revisión siempre visibles abajo.
 */
export default function DetalleLateral({
  id, resumen, alCerrar, alResuelta,
}: { id: string; resumen?: PuntoAdm; alCerrar: () => void; alResuelta: () => void }) {
  const [t, setT] = useState<TortilleriaAdm | null>();
  const [fotos, setFotos] = useState<{ id: string }[]>();
  const [fiscal, setFiscal] = useState<Fiscal | null>();
  const [capturas, setCapturas] = useState<CapturaAdm[]>();
  const [tab, setTab] = useState<Pestaña>("resumen");
  const [foto, setFoto] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");

  // Al elegir otra tortillería se vuelve a cargar todo, sin cerrar el panel
  useEffect(() => {
    let vigente = true;
    setT(undefined);
    setFotos(undefined);
    setFiscal(undefined);
    setCapturas(undefined);
    setTab("resumen");
    setFoto(0);
    setError("");
    api<TortilleriaAdm>(`/admin/tortillerias/${id}`).then((r) => vigente && setT(r)).catch((e) => vigente && (setError(e.message), setT(null)));
    api<{ id: string }[]>(`/admin/tortillerias/${id}/fotos`).then((r) => vigente && setFotos(r)).catch(() => vigente && setFotos([]));
    api<Fiscal>(`/tortillerias/${id}/fiscal`).then((r) => vigente && setFiscal(r)).catch(() => vigente && setFiscal(null));
    api<CapturaAdm[]>(`/admin/capturas?tortilleria=${id}`).then((r) => vigente && setCapturas(r)).catch(() => vigente && setCapturas([]));
    return () => {
      vigente = false;
    };
  }, [id]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && alCerrar();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [alCerrar]);

  // Los precios vienen del punto del mapa; si no hay, se sacan de las capturas
  const ultimo = useMemo(() => {
    const de = (prod: "maiz" | "masa") => {
      const c = capturas?.filter((x) => x.producto === prod && x.estatus !== "rechazada").sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
      return c ? { precio: Number(c.precio_kg), fecha: c.fecha.slice(0, 10) } : null;
    };
    return { maiz: resumen ? resumen.ultimo_maiz : de("maiz"), masa: resumen ? resumen.ultima_masa : de("masa") };
  }, [resumen, capturas]);

  const nombre = t?.nombre ?? resumen?.nombre ?? "Tortillería";
  const estatus = t?.estatus ?? resumen?.estatus ?? "pendiente";
  const sinFoto = t?.origen === "nueva" && (fotos === undefined ? t.n_fotos === 0 : fotos.length === 0);

  async function resolver(e: "validada" | "rechazada") {
    setTrabajando(true);
    setError("");
    try {
      await api(`/tortillerias/${id}/estatus`, { metodo: "PATCH", json: { estatus: e } });
      setT((x) => (x ? { ...x, estatus: e } : x));
      alResuelta();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTrabajando(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-stone-50">
      {/* Encabezado */}
      <div className="flex shrink-0 items-start gap-2 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-bold leading-tight">{nombre}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Insignia estatus={estatus} />
            {(t?.domicilio ?? resumen?.domicilio) && <span className="truncate text-xs text-stone-500">{t?.domicilio ?? resumen?.domicilio}</span>}
          </div>
        </div>
        <button onClick={alCerrar} aria-label="Cerrar detalle" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-stone-500 transition hover:bg-stone-200/70">
          <X className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
        {/* Fotos */}
        {fotos === undefined ? (
          <div className="aspect-[16/10] animate-pulse rounded-xl bg-stone-200" />
        ) : fotos.length === 0 ? (
          <div className="grid aspect-[16/10] place-items-center rounded-xl bg-stone-100 text-stone-400">
            <span className="flex flex-col items-center gap-1 text-xs"><Camera className="h-6 w-6" aria-hidden /> Sin foto</span>
          </div>
        ) : (
          <div>
            <div className="relative">
              <FotoAuth id={fotos[foto].id} className="aspect-[16/10] w-full rounded-xl" />
              {fotos.length > 1 && (
                <>
                  <button onClick={() => setFoto((foto - 1 + fotos.length) % fotos.length)} aria-label="Foto anterior" className="absolute left-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/60">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button onClick={() => setFoto((foto + 1) % fotos.length)} aria-label="Foto siguiente" className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/60">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white">{foto + 1} / {fotos.length}</span>
                </>
              )}
            </div>
            {fotos.length > 1 && (
              <div className="mt-1.5 flex gap-1.5 overflow-x-auto">
                {fotos.map((f, i) => (
                  <button key={f.id} onClick={() => setFoto(i)} aria-label={`Foto ${i + 1}`} className={`shrink-0 overflow-hidden rounded-lg ring-2 transition ${i === foto ? "ring-guinda" : "ring-transparent opacity-70 hover:opacity-100"}`}>
                    <FotoAuth id={f.id} miniatura className="h-10 w-10" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Precios */}
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <Precio icono={Wheat} titulo="Tortilla" p={ultimo.maiz} />
          <Precio icono={Layers} titulo="Masa" p={ultimo.masa} />
        </div>
        {resumen?.alerta && (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> Tiene una captura con alerta de precio.
          </p>
        )}

        {/* Pestañas */}
        <div role="tablist" className="mt-3 flex gap-1 border-b border-stone-200">
          {PESTAÑAS.map(([id2, texto]) => (
            <button
              key={id2}
              role="tab"
              aria-selected={tab === id2}
              onClick={() => setTab(id2)}
              className={`-mb-px border-b-2 px-2.5 py-2 text-[13px] font-medium transition ${tab === id2 ? "border-guinda text-guinda" : "border-transparent text-stone-500 hover:text-stone-800"}`}
            >
              {texto}
            </button>
          ))}
        </div>

        <div key={tab} className="paso pt-1">
          {tab === "resumen" && (
            <div>
              {resumen && <Fila i={Hash} k="Capturas en el periodo" v={String(resumen.n_capturas)} />}
              <Fila i={Building2} k="Ubicación" v={t ? [t.municipio, t.estado].filter(Boolean).join(", ") || "—" : "…"} />
              <Fila i={UserRound} k="Registrada por" v={t ? (t.creador ?? "DENUE") : "…"} />
              {t && <Fila i={CalendarDays} k="Fecha de registro" v={fechaLarga(t.creado_en)} />}
              {t?.lat != null && t.lng != null && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${t.lat}&mlon=${t.lng}#map=18/${t.lat}/${t.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold text-guinda ring-1 ring-stone-200 hover:bg-white"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Abrir ubicación en OpenStreetMap
                </a>
              )}
            </div>
          )}

          {tab === "datos" &&
            (t === undefined ? (
              <p className="py-4 text-sm text-stone-400">Cargando…</p>
            ) : t === null ? (
              <Aviso>{error || "No se pudo cargar la tortillería."}</Aviso>
            ) : (
              <div>
                <Fila i={MapPin} k="Dirección" v={t.domicilio ?? "—"} />
                {t.localidad && <Fila i={Building2} k="Localidad" v={t.localidad} />}
                {(t.tipo_vial || t.calle) && <Fila i={MapPin} k="Vialidad" v={[t.tipo_vial, t.calle].filter(Boolean).join(" ")} />}
                {(t.numero_ext || t.numero_int) && <Fila i={Hash} k="Número" v={[t.numero_ext && `Ext. ${t.numero_ext}`, t.numero_int && `Int. ${t.numero_int}`].filter(Boolean).join(" · ")} />}
                {t.colonia && <Fila i={Building2} k="Colonia" v={t.colonia} />}
                {t.codigo_postal && <Fila i={Hash} k="Código postal" v={t.codigo_postal} />}
                {t.telefono && <Fila i={Phone} k="Teléfono de la tortillería" v={t.telefono} />}
                {t.correo && <Fila i={Mail} k="Correo de la tortillería" v={t.correo} />}
                {t.personal_ocupado && <Fila i={Users} k="Personal ocupado" v={t.personal_ocupado} />}
                {t.fecha_alta && <Fila i={CalendarDays} k="Fecha de alta" v={t.fecha_alta} />}
              </div>
            ))}

          {tab === "fiscal" && (
            <div>
              {fiscal === undefined ? (
                <p className="py-4 text-sm text-stone-400">Cargando…</p>
              ) : fiscal === null ? (
                <p className="py-3 text-sm text-stone-500">Aún no tiene datos fiscales: se piden la primera vez que se captura su precio.</p>
              ) : (
                <>
                  <Fila i={FileText} k={`RFC (${fiscal.tipoPersona === "fisica" ? "persona física" : "persona moral"})`} v={fiscal.rfc} />
                  <Fila i={Building2} k={fiscal.tipoPersona === "moral" ? "Razón social" : "Titular del RFC"} v={fiscal.razonSocial} />
                  {fiscal.celular && <Fila i={Phone} k="Celular de contacto" v={fiscal.celular} />}
                  {fiscal.legado && fiscal.responsable && <Fila i={UserRound} k="Responsable (registro anterior)" v={`${fiscal.responsable.nombre} ${fiscal.responsable.apellidos}`} />}
                </>
              )}
              <p className="mt-1 flex items-center gap-1.5 pt-1 text-[11px] text-stone-400">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-verde" aria-hidden /> La consulta de datos fiscales queda registrada en la auditoría.
              </p>
            </div>
          )}

          {tab === "historial" &&
            (capturas === undefined ? (
              <p className="py-4 text-sm text-stone-400">Cargando…</p>
            ) : capturas.length === 0 ? (
              <p className="py-3 text-sm text-stone-500">Todavía no tiene precios capturados.</p>
            ) : (
              <ul>
                {capturas.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 border-b border-stone-100 py-2 last:border-0">
                    <span className="min-w-0 text-sm">
                      <span className="font-medium">{NOMBRE_PRODUCTO[c.producto]}</span> · <b>{dinero(Number(c.precio_kg))}</b>
                      <span className="block text-[11px] text-stone-400">{diaCorto(c.fecha)}{c.capturista ? ` · ${c.capturista}` : ""}{c.alerta ? " · ⚠ alerta" : ""}</span>
                    </span>
                    <Insignia estatus={c.estatus} />
                  </li>
                ))}
              </ul>
            ))}
        </div>
      </div>

      {/* Acciones de revisión: siempre a la vista */}
      {(estatus === "pendiente" || error) && (
        <div className="shrink-0 space-y-2 border-t border-stone-200 bg-white px-4 py-3">
          {error && t !== null && <Aviso>{error}</Aviso>}
          {estatus === "pendiente" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => resolver("rechazada")}
                  disabled={trabajando}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-white text-sm font-semibold text-red-600 ring-1 ring-red-200 transition hover:bg-red-50 active:scale-[.98] disabled:opacity-40"
                >
                  <X className="h-4 w-4" aria-hidden /> Rechazar
                </button>
                <button
                  onClick={() => resolver("validada")}
                  disabled={trabajando || !!sinFoto || !t}
                  className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-guinda to-guinda-oscuro text-sm font-semibold text-white shadow-sm transition active:scale-[.98] disabled:opacity-40"
                >
                  {trabajando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />} Validar
                </button>
              </div>
              {sinFoto && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700">
                  <Camera className="h-3.5 w-3.5 shrink-0" aria-hidden /> Una tortillería nueva no se puede validar sin foto.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
