import { useCallback, useEffect, useState } from "react";
import { Check, CheckCircle2, ClipboardList, Clock, Home, MapPin, PackageOpen, Plus, RefreshCw, Store, UserRound, Wheat, XCircle, Layers, Loader2 } from "lucide-react";
import { api, type Sesion } from "./api";
import Perfil from "./Perfil";
import { CLAVES, usePersistente } from "./persist";
import { Boton, Dato, HojaModal, Insignia, PanelShell, Tarjeta, Vacio } from "./ui";
import type { Punto } from "./MapaTortillerias";

type Resumen = { registros: number; pendientes: number; aprobados: number; rechazados: number; tortillerias: number };
type Ultimo = { precio: number; fecha: string } | null;
type MiTortilleria = {
  id: string; nombre: string; domicilio: string | null; estatus: string; origen: string; municipio: string | null; estado: string | null;
  lat: number | null; lng: number | null; ultimo_maiz: Ultimo; ultima_masa: Ultimo; maiz_hoy: boolean; masa_hoy: boolean;
};
type Registro = {
  tortilleria_id: string;
  id: string; producto: "maiz" | "harina" | "masa"; precio_kg: string; fecha: string; creado_en: string; estatus: string; alerta: boolean;
  nombre: string; domicilio: string | null; municipio: string | null; estado: string | null;
};

const PRODUCTO = { maiz: { t: "Maíz", i: Wheat }, harina: { t: "Harina", i: PackageOpen }, masa: { t: "Masa", i: Layers } };
const fecha = (s: string) => new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
/** Las fechas de captura vienen como "AAAA-MM-DD" (día en hora de México): se arman sin pasar por UTC para no recorrer el día */
const fechaDia = (s: string) => {
  const [a, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
};

/** Una tortillería del censador, con su último precio de cada producto y el botón para actualizarlo */
function TarjetaTortilleria({ t, alActualizar, alAbrir }: { t: MiTortilleria; alActualizar: (t: MiTortilleria) => void; alAbrir: (t: MiTortilleria) => void }) {
  const hoy = t.maiz_hoy && t.masa_hoy;
  const linea = (I: typeof Wheat, texto: string, u: Ultimo, yaHoy: boolean) => (
    <span className="flex items-center gap-1.5 text-stone-600">
      <I className="h-4 w-4 shrink-0 text-guinda" aria-hidden /> {texto}
      {u ? (
        <>
          <b className="text-stone-900">${Number(u.precio).toFixed(2)}</b> <span className="text-xs text-stone-400">· {fechaDia(u.fecha)}</span>
        </>
      ) : (
        <span className="text-xs text-stone-400">sin capturar</span>
      )}
      {yaHoy && <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={3} aria-label="Capturado hoy" />}
    </span>
  );
  return (
    <Tarjeta className="space-y-2.5">
      <button onClick={() => alAbrir(t)} className="flex w-full items-start gap-3 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-guinda/10 text-guinda">
          <Store className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate font-semibold leading-tight">{t.nombre}</span>
            <Insignia estatus={t.estatus} />
          </span>
          <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-stone-500">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden /> {t.domicilio || [t.municipio, t.estado].filter(Boolean).join(", ") || "Sin domicilio"}
          </span>
        </span>
      </button>
      <div className="space-y-1 pl-[3.25rem] text-sm">
        {linea(Wheat, "Maíz", t.ultimo_maiz, t.maiz_hoy)}
        {linea(Layers, "Masa", t.ultima_masa, t.masa_hoy)}
      </div>
      <Boton onClick={() => alActualizar(t)} disabled={hoy} variante={hoy ? "secundario" : "primario"} icono={hoy ? Check : RefreshCw} className="!min-h-11">
        {hoy ? "Capturado hoy" : "Actualizar precio"}
      </Boton>
    </Tarjeta>
  );
}

export default function PanelUsuario({
  sesion, alCapturar, alActualizarPrecio, alActualizarSesion, alSalir,
}: { sesion: Sesion; alCapturar: () => void; alActualizarPrecio: (t: Punto) => void; alActualizarSesion: (s: Sesion) => void; alSalir: () => void }) {
  const [tab, setTab] = usePersistente(CLAVES.tabUsuario, "inicio");
  const [resumen, setResumen] = useState<Resumen>();
  const [registros, setRegistros] = useState<Registro[]>();
  const [tortillerias, setTortillerias] = useState<MiTortilleria[]>();
  const [detalle, setDetalle] = useState<MiTortilleria>();
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    Promise.all([api<Resumen>("/mis/resumen"), api<Registro[]>("/mis/registros"), api<MiTortilleria[]>("/mis/tortillerias")])
      .then(([a, b, c]) => {
        setResumen(a);
        setRegistros(b);
        setTortillerias(c);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(cargar, [cargar]);

  const actualizar = (t: MiTortilleria) =>
    alActualizarPrecio({ id: t.id, nombre: t.nombre, domicilio: t.domicilio, estatus: t.estatus, lat: t.lat ?? 0, lng: t.lng ?? 0, razon_social: null });

  const u = sesion.usuario;
  const nombre = u.nombre ? u.nombre.split(" ")[0] : u.correo.split("@")[0];

  return (
    <PanelShell
      titulo={`Hola, ${nombre}`}
      subtitulo={tab === "inicio" ? "Este es tu panel" : tab === "registros" ? "Tus tortillerías y sus precios" : "Tu cuenta"}
      pestañas={[
        { id: "inicio", texto: "Inicio", icono: Home },
        { id: "registros", texto: "Mis tortillerías", icono: Store, insignia: resumen?.pendientes },
        { id: "perfil", texto: "Perfil", icono: UserRound },
      ]}
      activa={tab}
      alCambiar={setTab}
    >
      {error && <Tarjeta className="text-sm text-red-600">{error}</Tarjeta>}

      {tab === "inicio" && (
        <>
          <button
            onClick={alCapturar}
            className="relative flex w-full items-center gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-guinda to-guinda-oscuro p-5 text-left text-white shadow-lg shadow-guinda/30 transition active:scale-[.98]"
          >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15">
              <Plus className="h-8 w-8 text-dorado" aria-hidden />
            </span>
            <span>
              <span className="block text-lg font-bold leading-tight">Registrar tortillería</span>
              <span className="block text-sm text-white/80">Captura el precio de la tortilla</span>
            </span>
          </button>

          <div className="grid grid-cols-3 gap-2">
            <Dato icono={ClipboardList} etiqueta="Registros" valor={resumen?.registros ?? "–"} />
            <Dato icono={Clock} etiqueta="En revisión" valor={resumen?.pendientes ?? "–"} tono="dorado" />
            <Dato icono={CheckCircle2} etiqueta="Aprobados" valor={resumen?.aprobados ?? "–"} tono="verde" />
          </div>

          <div className="flex items-center justify-between pt-1">
            <h2 className="text-sm font-bold">Últimas tortillerías</h2>
            {!!tortillerias?.length && (
              <button onClick={() => setTab("registros")} className="text-xs font-semibold text-guinda">
                Ver todos
              </button>
            )}
          </div>
          {!tortillerias ? (
            <div className="grid place-items-center py-8 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : tortillerias.length === 0 ? (
            <Vacio icono={Store} titulo="Aún no tienes tortillerías" texto="Registra el precio de tu primera tortillería para empezar." />
          ) : (
            tortillerias.slice(0, 3).map((t) => <TarjetaTortilleria key={t.id} t={t} alActualizar={actualizar} alAbrir={setDetalle} />)
          )}
        </>
      )}

      {tab === "registros" && (
        <>
          {resumen && resumen.rechazados > 0 && (
            <Tarjeta className="flex items-center gap-2 text-sm text-red-700">
              <XCircle className="h-4 w-4 shrink-0" aria-hidden /> {resumen.rechazados} registro(s) fueron rechazados por revisión.
            </Tarjeta>
          )}
          {!tortillerias ? (
            <div className="grid place-items-center py-8 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : tortillerias.length === 0 ? (
            <Vacio icono={ClipboardList} titulo="Sin tortillerías todavía" texto="Cuando captures un precio aparecerá aquí, y podrás actualizarlo con un toque." />
          ) : (
            tortillerias.map((t) => <TarjetaTortilleria key={t.id} t={t} alActualizar={actualizar} alAbrir={setDetalle} />)
          )}
          <Boton onClick={alCapturar} icono={Plus}>
            Registrar otra tortillería
          </Boton>
        </>
      )}

      {tab === "perfil" && <Perfil sesion={sesion} alActualizar={alActualizarSesion} alSalir={alSalir} />}

      {detalle && (
        <HojaModal titulo={detalle.nombre} alCerrar={() => setDetalle(undefined)}>
          <div className="flex items-center justify-between">
            <Insignia estatus={detalle.estatus} />
            <span className="text-xs text-stone-400">{[detalle.municipio, detalle.estado].filter(Boolean).join(", ")}</span>
          </div>
          {detalle.domicilio && (
            <p className="flex items-center gap-1.5 text-sm text-stone-600">
              <MapPin className="h-4 w-4 shrink-0 text-guinda" aria-hidden /> {detalle.domicilio}
            </p>
          )}
          <h3 className="pt-1 text-sm font-bold">Historial de tus precios</h3>
          <div className="space-y-2">
            {(registros ?? []).filter((x) => x.tortilleria_id === detalle.id).map((x) => {
              const P = PRODUCTO[x.producto];
              return (
                <Tarjeta key={x.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-1.5 text-stone-600">
                    <P.i className="h-4 w-4 text-guinda" aria-hidden /> {P.t} · <b className="text-stone-900">${Number(x.precio_kg).toFixed(2)}</b> /kg
                    <span className="text-xs text-stone-400">· {fecha(x.creado_en)}</span>
                  </span>
                  <Insignia estatus={x.estatus} />
                </Tarjeta>
              );
            })}
          </div>
          <Boton onClick={() => { const t = detalle; setDetalle(undefined); actualizar(t); }} disabled={detalle.maiz_hoy && detalle.masa_hoy} icono={RefreshCw}>
            {detalle.maiz_hoy && detalle.masa_hoy ? "Capturado hoy" : "Actualizar precio"}
          </Boton>
        </HojaModal>
      )}
    </PanelShell>
  );
}
