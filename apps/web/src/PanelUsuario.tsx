import { AvisoCuenta } from "./AvisoCuenta";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronRight, ClipboardCheck, ClipboardList, ClipboardPen, Clock, Home, MapPin, PackageOpen, Plus, RefreshCw, Store, UserRound, Wheat, XCircle, Layers, Loader2, WifiOff } from "lucide-react";
import { textoMotivoNoAplica } from "@tortillerias/shared";
import { api, ApiError, type Sesion } from "./api";
import Perfil from "./Perfil";
import { CLAVES, usePersistente } from "./persist";
import { Boton, Dato, HojaModal, Insignia, PanelShell, Tarjeta, Vacio } from "./ui";
import { TarjetaBandeja, useBandeja } from "./BandejaPendientes";
import { TarjetaDescargaEstado } from "./Arranque";
import { diaMexico, type Paquete } from "./bd";
import { guardarMisTortillerias, idReal, leerMisTortillerias, pideAtencion } from "./bandeja";
import type { Punto } from "./MapaTortillerias";

type Resumen = { registros: number; pendientes: number; aprobados: number; rechazados: number; tortillerias: number };
type Ultimo = { precio: number; fecha: string } | null;
type MiTortilleria = {
  id: string; nombre: string; domicilio: string | null; estatus: string; origen: string; municipio: string | null; estado: string | null;
  lat: number | null; lng: number | null; ultimo_maiz: Ultimo; ultima_masa: Ultimo; maiz_hoy: boolean; masa_hoy: boolean;
  /** tiene capturas guardadas en este teléfono que todavía no llegan al servidor */
  porEnviar?: boolean;
  /** "inactiva" = se dio de baja (ya no lleva cuestionario) */
  operacion?: string;
  /** C21: solo el estatus del cuestionario (nunca respuestas). null = falta */
  cuestionario?: { estatus: "aplicado" | "no_aplicado"; fecha: string; motivo?: string | null } | null;
};

/** ¿Le falta el cuestionario? (no aplica a las dadas de baja) */
const faltaCuest = (t: MiTortilleria) => t.operacion !== "inactiva" && t.cuestionario?.estatus !== "aplicado";
type Registro = {
  tortilleria_id: string;
  id: string; producto: "maiz" | "harina" | "masa"; precio_kg: string; fecha: string; creado_en: string; estatus: string; alerta: boolean;
  nombre: string; domicilio: string | null; municipio: string | null; estado: string | null;
};

const PRODUCTO = { maiz: { t: "Tortilla", i: Wheat }, harina: { t: "Harina", i: PackageOpen }, masa: { t: "Masa", i: Layers } };
const fechaHora = (s: string) => (s.length <= 10 ? fechaDia(s) : new Date(s).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }));
const fecha = (s: string) => new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
/** Las fechas de captura vienen como "AAAA-MM-DD" (día en hora de México): se arman sin pasar por UTC para no recorrer el día */
const fechaDia = (s: string) => {
  const [a, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
};

/**
 * Mezcla lo que está en la bandeja del teléfono con la lista del servidor: lo pendiente cuenta para "Capturado hoy",
 * se marca "Por enviar" y las tortillerías nuevas que aún no llegan al servidor también aparecen.
 */
async function mezclarBandeja(filas: MiTortilleria[], paquetes: Paquete[]): Promise<MiTortilleria[]> {
  const hoy = diaMexico();
  const lista = filas.map((f) => ({ ...f }));
  const nuevas: MiTortilleria[] = [];
  // más antiguo primero: si hay dos precios del mismo producto, queda el más reciente
  for (const p of [...paquetes].sort((a, b) => a.capturadoEn.localeCompare(b.capturadoEn))) {
    if (!pideAtencion(p) || p.estado === "error") continue;
    const id = (await idReal(p.tortilleria.id)) ?? p.tortilleria.id;
    let f = lista.find((x) => x.id === id) ?? nuevas.find((x) => x.id === id);
    if (!f) {
      f = {
        id, nombre: p.tortilleria.nombre, domicilio: p.tortilleria.domicilio, estatus: "pendiente", origen: p.nueva ? "nueva" : "denue", municipio: null, estado: null,
        lat: p.tortilleria.lat, lng: p.tortilleria.lng, ultimo_maiz: null, ultima_masa: null, maiz_hoy: false, masa_hoy: false,
      };
      nuevas.push(f);
    }
    f.porEnviar = true;
    const dia = diaMexico(p.capturadoEn);
    // un cuestionario por enviar ya cuenta (un "no se pudo aplicar" no baja a uno aplicado)
    if (p.cuestionario && f.cuestionario?.estatus !== "aplicado") f.cuestionario = { estatus: p.cuestionario.estatus, fecha: dia, motivo: p.cuestionario.motivo ?? null };
    for (const pr of p.precios) {
      if (pr.estado === "conflicto") continue;
      const campo = pr.producto === "maiz" ? "ultimo_maiz" : "ultima_masa";
      const actual = f[campo];
      if (!actual || actual.fecha.slice(0, 10) <= dia) f[campo] = { precio: pr.precioKg, fecha: dia };
      if (dia === hoy) f[pr.producto === "maiz" ? "maiz_hoy" : "masa_hoy"] = true;
    }
  }
  // lo que tiene algo por enviar va primero
  return [...nuevas.reverse(), ...lista.filter((x) => x.porEnviar), ...lista.filter((x) => !x.porEnviar)];
}

/** Una tortillería del censador, con su último precio de cada producto y el botón para actualizarlo */
function TarjetaTortilleria({ t, alActualizar, alAbrir, alCuestionario }: { t: MiTortilleria; alActualizar: (t: MiTortilleria) => void; alAbrir: (t: MiTortilleria) => void; alCuestionario: (t: MiTortilleria) => void }) {
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
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-guinda/10 text-guinda">
          <Store className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate font-semibold leading-tight">{t.nombre}</span>
            <span className="flex shrink-0 items-center gap-1">
              {t.porEnviar && <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-300">Por enviar</span>}
              <Insignia estatus={t.estatus} />
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-stone-500">
            <MapPin className="h-3 w-3 shrink-0" aria-hidden /> {t.domicilio || [t.municipio, t.estado].filter(Boolean).join(", ") || "Sin dirección"}
          </span>
        </span>
      </button>
      <div className="space-y-1 pl-[3.25rem] text-sm">
        {linea(Wheat, "Tortilla", t.ultimo_maiz, t.maiz_hoy)}
        {linea(Layers, "Masa", t.ultima_masa, t.masa_hoy)}
      </div>
      {t.operacion !== "inactiva" && <EstadoCuestionario t={t} alCuestionario={alCuestionario} />}
      <Boton onClick={() => alActualizar(t)} disabled={hoy} variante={hoy ? "secundario" : "primario"} icono={hoy ? Check : RefreshCw} className="!min-h-11">
        {hoy ? "Capturado hoy" : "Actualizar precio"}
      </Boton>
    </Tarjeta>
  );
}

/** C21: estatus del cuestionario de la tortillería y el botón para aplicarlo o actualizarlo (sin pedir precio) */
function EstadoCuestionario({ t, alCuestionario }: { t: MiTortilleria; alCuestionario: (t: MiTortilleria) => void }) {
  const c = t.cuestionario;
  const aplicado = c?.estatus === "aplicado";
  return (
    <div className={`flex items-center gap-2 rounded-xl px-2.5 py-2 ${aplicado ? "bg-emerald-50 ring-1 ring-emerald-100" : "bg-dorado/10 ring-1 ring-dorado/30"}`}>
      {aplicado ? <ClipboardCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden /> : <ClipboardPen className="h-4 w-4 shrink-0 text-[#7a5a1f]" aria-hidden />}
      <span className="min-w-0 flex-1 text-xs leading-tight">
        {aplicado ? (
          <span className="font-semibold text-emerald-800">Cuestionario aplicado el {fechaDia(c!.fecha)}</span>
        ) : c?.estatus === "no_aplicado" ? (
          <>
            <span className="block font-semibold text-[#7a5a1f]">No se pudo aplicar</span>
            <span className="block truncate text-stone-500">{textoMotivoNoAplica(c.motivo)} · {fechaDia(c.fecha)}</span>
          </>
        ) : (
          <span className="font-semibold text-[#7a5a1f]">Falta cuestionario</span>
        )}
      </span>
      <button
        type="button"
        onClick={() => alCuestionario(t)}
        className={`flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-bold transition active:scale-95 ${aplicado ? "rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-md shadow-orange-500/30" : "rounded-lg bg-guinda text-white shadow-sm"}`}
      >
        {aplicado && <RefreshCw className="h-3.5 w-3.5" aria-hidden />}
        {aplicado ? "Actualizar cuestionario" : "Aplicar cuestionario"}
      </button>
    </div>
  );
}

export default function PanelUsuario({
  sesion, alCapturar, alActualizarPrecio, alAplicarCuestionario, alActualizarSesion, alSalir,
}: { sesion: Sesion; alCapturar: () => void; alActualizarPrecio: (t: Punto) => void; alAplicarCuestionario: (t: Punto) => void; alActualizarSesion: (s: Sesion) => void; alSalir: () => void }) {
  const estadoCuenta = sesion.usuario.estadoCuenta ?? "autorizado";
  const [tab, setTab] = usePersistente(CLAVES.tabUsuario, "inicio");
  const [resumen, setResumen] = useState<Resumen>();
  const [registros, setRegistros] = useState<Registro[]>();
  const [tortillerias, setTortillerias] = useState<MiTortilleria[]>();
  const [detalle, setDetalle] = useState<MiTortilleria>();
  const [error, setError] = useState("");
  // Copia guardada en el teléfono (cuando no hay señal): se muestra con la fecha en que se guardó
  const [guardadoEn, setGuardadoEn] = useState<string>();
  const [delServidor, setDelServidor] = useState<MiTortilleria[]>();
  const paquetes = useBandeja(sesion.usuario.id);

  const cargar = useCallback(() => {
    Promise.all([api<Resumen>("/mis/resumen"), api<Registro[]>("/mis/registros"), api<MiTortilleria[]>("/mis/tortillerias")])
      .then(([a, b, c]) => {
        setResumen(a);
        setRegistros(b);
        setDelServidor(c);
        setGuardadoEn(undefined);
        setError("");
        void guardarMisTortillerias(c); // sirve para verlas y para el límite diario sin conexión
      })
      .catch(async (e) => {
        if (e instanceof ApiError && e.status === 0) {
          const m = await leerMisTortillerias<MiTortilleria>();
          if (m) {
            setDelServidor(m.filas);
            setGuardadoEn(m.guardadoEn ?? m.fecha);
            return setError("");
          }
        }
        setError(e.message);
      });
  }, []);
  useEffect(cargar, [cargar]);

  // La lista que se ve = lo del servidor (o su última copia) + lo que hay en la bandeja
  useEffect(() => {
    if (!delServidor) return;
    let vigente = true;
    void mezclarBandeja(delServidor, paquetes).then((m) => vigente && setTortillerias(m));
    return () => {
      vigente = false;
    };
  }, [delServidor, paquetes]);

  // Cuando se envía algo de la bandeja, la lista del servidor se pone al día
  const enviados = paquetes.filter((p) => p.estado === "enviado").length;
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) return void (primeraVez.current = false);
    if (navigator.onLine) cargar();
  }, [enviados, cargar]);
  // Al volver la señal también
  useEffect(() => {
    window.addEventListener("online", cargar);
    return () => window.removeEventListener("online", cargar);
  }, [cargar]);

  const actualizar = (t: MiTortilleria) =>
    alActualizarPrecio({ id: t.id, nombre: t.nombre, domicilio: t.domicilio, estatus: t.estatus, lat: t.lat ?? 0, lng: t.lng ?? 0, razon_social: null });
  const cuestionario = (t: MiTortilleria) => {
    if (estadoCuenta !== "autorizado") return;
    alAplicarCuestionario({ id: t.id, nombre: t.nombre, domicilio: t.domicilio, estatus: t.estatus, lat: t.lat ?? 0, lng: t.lng ?? 0, razon_social: null });
  };
  // filtro rápido "Sin cuestionario" en Mis tortillerías
  const [soloSinCuest, setSoloSinCuest] = useState(false);
  const sinCuest = (tortillerias ?? []).filter(faltaCuest);
  const lista = soloSinCuest ? sinCuest : (tortillerias ?? []);

  const u = sesion.usuario;
  const nombre = (u.nombre ? u.nombre.split(" ")[0] : u.correo.split("@")[0]).toLowerCase().replace(/^./, (c) => c.toUpperCase());

  return (
    <PanelShell
      titulo={tab === "inicio" ? `Hola, ${nombre}` : tab === "registros" ? "Mis tortillerías" : "Tu perfil"}
      inicial={nombre.slice(0, 1)}
      pestañas={[
        { id: "inicio", texto: "Inicio", icono: Home, tono: "guinda" },
        { id: "registros", texto: "Mis tortillerías", icono: Store, insignia: resumen?.pendientes, tono: "dorado" },
        { id: "perfil", texto: "Perfil", icono: UserRound, tono: "verde" },
      ]}
      activa={tab}
      alCambiar={setTab}
    >
      {error && <Tarjeta className="text-sm text-red-600">{error}</Tarjeta>}

      {guardadoEn && (
        <Tarjeta className="flex items-center gap-2 text-xs text-stone-600">
          <WifiOff className="h-4 w-4 shrink-0 text-stone-400" aria-hidden /> Datos guardados el {fechaHora(guardadoEn)}
        </Tarjeta>
      )}

      {tab === "inicio" && (
        <>
          <TarjetaBandeja paquetes={paquetes} />
          <TarjetaDescargaEstado />
          {estadoCuenta !== "autorizado" ? <AvisoCuenta estado={estadoCuenta} /> : (
          <button
            onClick={alCapturar}
            className="relative flex w-full items-center gap-4 overflow-hidden rounded-3xl bg-gradient-to-br from-guinda to-guinda-oscuro p-5 text-left text-white shadow-lg shadow-guinda/30 transition active:scale-[.98]"
          >
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white/15">
              <Plus className="h-8 w-8 text-dorado" aria-hidden />
            </span>
            <span>
              <span className="block text-lg font-bold leading-tight">Registrar tortillería</span>
              <span className="block text-sm text-white/80">Captura el precio de la tortilla</span>
            </span>
          </button>
          )}

          {estadoCuenta === "autorizado" && sinCuest.length > 0 && (
            <button
              onClick={() => {
                setSoloSinCuest(true);
                setTab("registros");
              }}
              className="flex w-full items-center gap-3 rounded-2xl bg-dorado/10 p-3.5 text-left ring-1 ring-dorado/40 transition active:scale-[.98]"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-dorado/20 text-[#7a5a1f]"><ClipboardPen className="h-5 w-5" aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-stone-900">
                  Tienes {sinCuest.length} {sinCuest.length === 1 ? "tortillería" : "tortillerías"} sin cuestionario
                </span>
                <span className="block text-xs text-stone-600">Aplícalo en tu próxima visita; no necesitas volver a capturar el precio.</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-stone-400" aria-hidden />
            </button>
          )}

          <div className="grid grid-cols-3 gap-2">
            <Dato icono={ClipboardList} etiqueta="Registros" valor={resumen?.registros ?? "–"} />
            <Dato icono={Clock} etiqueta="Atípicos en revisión" valor={resumen?.pendientes ?? "–"} tono="dorado" />
            <Dato icono={CheckCircle2} etiqueta="Aprobados" valor={resumen?.aprobados ?? "–"} tono="verde" />
          </div>
          <p className="px-1 text-[11px] leading-snug text-stone-500">Un precio se revisa cuando es muy distinto al de la zona. Los demás se aprueban solos.</p>

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
            tortillerias.slice(0, 3).map((t) => <TarjetaTortilleria key={t.id} t={t} alActualizar={actualizar} alAbrir={setDetalle} alCuestionario={cuestionario} />)
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
          {!!tortillerias?.length && (
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-stone-200/70 p-1" role="tablist" aria-label="Filtrar">
              {([[false, "Todas", tortillerias.length], [true, "Sin cuestionario", sinCuest.length]] as const).map(([v, t, n]) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={soloSinCuest === v}
                  onClick={() => setSoloSinCuest(v)}
                  className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold transition ${soloSinCuest === v ? "bg-white text-guinda shadow" : "text-stone-500"}`}
                >
                  {t}
                  <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] ${soloSinCuest === v ? "bg-guinda text-white" : "bg-stone-300/70 text-stone-600"}`}>{n}</span>
                </button>
              ))}
            </div>
          )}
          {!tortillerias ? (
            <div className="grid place-items-center py-8 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : tortillerias.length === 0 ? (
            <Vacio icono={ClipboardList} titulo="Sin tortillerías todavía" texto="Cuando captures un precio aparecerá aquí, y podrás actualizarlo con un toque." />
          ) : lista.length === 0 ? (
            <Vacio icono={ClipboardCheck} titulo="¡Todas tienen cuestionario!" texto="Ninguna de tus tortillerías tiene el cuestionario pendiente." />
          ) : (
            lista.map((t) => <TarjetaTortilleria key={t.id} t={t} alActualizar={actualizar} alAbrir={setDetalle} alCuestionario={cuestionario} />)
          )}
          <Boton onClick={alCapturar} icono={Plus} disabled={estadoCuenta !== "autorizado"}>
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
          {detalle.operacion !== "inactiva" && <EstadoCuestionario t={detalle} alCuestionario={(t) => { setDetalle(undefined); cuestionario(t); }} />}
          <Boton onClick={() => { const t = detalle; setDetalle(undefined); actualizar(t); }} disabled={detalle.maiz_hoy && detalle.masa_hoy} icono={RefreshCw}>
            {detalle.maiz_hoy && detalle.masa_hoy ? "Capturado hoy" : "Actualizar precio"}
          </Boton>
        </HojaModal>
      )}
    </PanelShell>
  );
}
