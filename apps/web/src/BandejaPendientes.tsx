import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Inbox, Loader2, RefreshCw, Send, Store, Trash2 } from "lucide-react";
import type { Paquete } from "./bd";
import { descartar, enviarDeTodosModos, estadoSync, listarPaquetes, NOMBRE_PRODUCTO, pideAtencion, reintentar, sincronizar, usarExistente } from "./bandeja";
import { Boton, HojaModal, Tarjeta } from "./ui";

/** Los paquetes de la bandeja del usuario; se actualizan solos cuando cambia la bandeja (`avisar()` de bandeja.ts) */
export function useBandeja(usuarioId: string): Paquete[] {
  const [paquetes, setPaquetes] = useState<Paquete[]>([]);
  useEffect(() => {
    let vivo = true;
    const cargar = () => void listarPaquetes(usuarioId).then((p) => vivo && setPaquetes(p));
    cargar();
    window.addEventListener("bandeja", cargar);
    return () => {
      vivo = false;
      window.removeEventListener("bandeja", cargar);
    };
  }, [usuarioId]);
  return paquetes;
}

const ESTADO: Record<Paquete["estado"], [string, string]> = {
  por_enviar: ["Por enviar", "bg-slate-100 text-slate-700 ring-slate-300"],
  enviando: ["Enviando", "bg-sky-50 text-sky-700 ring-sky-200"],
  enviado: ["Enviado", "bg-emerald-50 text-emerald-700 ring-emerald-200"],
  conflicto: ["Conflicto", "bg-amber-50 text-amber-800 ring-amber-200"],
  error: ["Error", "bg-red-50 text-red-700 ring-red-200"],
};

const cuando = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function EtiquetaEstado({ estado }: { estado: Paquete["estado"] }) {
  const [t, c] = ESTADO[estado];
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${c}`}>{t}</span>;
}

/** Una captura de la bandeja, con lo que el censador puede hacer con ella */
function FilaPaquete({ p }: { p: Paquete }) {
  const [confirmando, setConfirmando] = useState(false);
  const precios = p.precios.map((x) => `${NOMBRE_PRODUCTO[x.producto]} $${x.precioKg.toFixed(2)}`).join(" · ");
  const duplicado = p.estado === "conflicto" && !!p.posibles?.length;
  const puedeDescartar = p.estado === "conflicto" || p.estado === "error";
  const puedeReintentar = p.estado === "error" || (p.estado === "por_enviar" && (p.intentos > 0 || !!p.proximoIntento));

  return (
    <Tarjeta className="space-y-2">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-guinda/10 text-guinda">
          <Store className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold leading-tight">{p.tortilleria.nombre}</p>
            <EtiquetaEstado estado={p.estado} />
          </div>
          <p className="mt-0.5 text-xs text-stone-500">
            {p.nueva && <b className="text-guinda">Tortillería nueva · </b>}
            {precios || "Sin precios"}
          </p>
          <p className="text-xs text-stone-400">Capturado el {cuando(p.capturadoEn)}</p>
        </div>
      </div>

      {p.mensaje && <p className={`rounded-lg px-2.5 py-1.5 text-xs ${p.estado === "error" ? "bg-red-50 text-red-700" : "bg-stone-100 text-stone-600"}`}>{p.mensaje}</p>}
      {p.precios.some((x) => x.estado === "conflicto") && p.estado === "conflicto" && !duplicado && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">Ya habías capturado este producto ese día. Puedes descartar esta captura.</p>
      )}

      {duplicado && (
        <div className="space-y-2 rounded-xl bg-amber-50 p-2.5 ring-1 ring-amber-200">
          <p className="text-xs font-semibold text-amber-900">Ya existe una tortillería parecida en ese lugar. ¿Es la misma?</p>
          {p.posibles!.map((x) => (
            <div key={x.id} className="flex items-center justify-between gap-2 rounded-lg bg-white p-2">
              <span className="min-w-0 text-xs">
                <b className="block truncate text-stone-900">{x.nombre}</b>
                <span className="block truncate text-stone-500">{x.domicilio ?? "Sin domicilio"}</span>
              </span>
              <button onClick={() => void usarExistente(p.id, x)} className="shrink-0 rounded-lg bg-guinda px-3 py-1.5 text-xs font-bold text-white active:scale-95">
                Era la misma
              </button>
            </div>
          ))}
          <Boton variante="secundario" className="!min-h-10 !text-sm" onClick={() => void enviarDeTodosModos(p.id)}>
            Es otra, enviar de todos modos
          </Boton>
        </div>
      )}

      {(puedeReintentar || puedeDescartar) && !confirmando && (
        <div className="grid grid-flow-col auto-cols-fr gap-2">
          {puedeReintentar && (
            <Boton variante="secundario" className="!min-h-10 !text-sm" icono={RefreshCw} onClick={() => void reintentar(p.id)}>
              Reintentar
            </Boton>
          )}
          {puedeDescartar && (
            <Boton variante="peligro" className="!min-h-10 !text-sm" icono={Trash2} onClick={() => setConfirmando(true)}>
              Descartar
            </Boton>
          )}
        </div>
      )}
      {confirmando && (
        <div className="space-y-2 rounded-xl bg-red-50 p-2.5 ring-1 ring-red-200">
          <p className="text-xs font-semibold text-red-800">¿Descartar esta captura? Se borrará de tu teléfono y no se enviará.</p>
          <div className="grid grid-cols-2 gap-2">
            <Boton variante="secundario" className="!min-h-10 !text-sm" onClick={() => setConfirmando(false)}>
              Cancelar
            </Boton>
            <Boton variante="peligro" className="!min-h-10 !text-sm" onClick={() => void descartar(p.id)}>
              Sí, descartar
            </Boton>
          </div>
        </div>
      )}
    </Tarjeta>
  );
}

/** Tarjeta de arriba en "Inicio": cuántas capturas faltan por enviar. Al tocarla se abre la lista completa. */
export function TarjetaBandeja({ paquetes }: { paquetes: Paquete[] }) {
  const [abierta, setAbierta] = useState(false);
  const pendientes = paquetes.filter(pideAtencion);
  const n = pendientes.length;
  const conProblema = pendientes.filter((p) => p.estado === "conflicto" || p.estado === "error").length;
  const sincronizando = estadoSync.sincronizando;
  const sinSesion = estadoSync.sinSesion && n > 0;

  // El detalle no tiene sentido si ya no queda nada que ver
  const hayLista = paquetes.length > 0;

  if (sinSesion)
    return (
      <Tarjeta className="flex items-start gap-3 !bg-amber-50 ring-amber-200">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
        <p className="text-sm font-semibold text-amber-900">
          Inicia sesión para enviar tus {n} {n === 1 ? "captura pendiente" : "capturas pendientes"}
        </p>
      </Tarjeta>
    );

  return (
    <>
      <Tarjeta className={`flex items-center gap-3 ${n ? "!bg-slate-50 ring-slate-300" : ""}`}>
        <button onClick={() => hayLista && setAbierta(true)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="Ver la bandeja de capturas">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${n ? "bg-guinda/10 text-guinda" : "bg-emerald-50 text-emerald-600"}`}>
            {n ? <Inbox className="h-5 w-5" aria-hidden /> : <CheckCircle2 className="h-5 w-5" aria-hidden />}
          </span>
          <span className="min-w-0">
            <span className="block font-bold leading-tight">{n ? `${n} ${n === 1 ? "captura por enviar" : "capturas por enviar"}` : "Todo enviado ✓"}</span>
            <span className="block text-xs text-stone-500">
              {sincronizando ? "Enviando…" : conProblema ? `${conProblema} necesita${conProblema === 1 ? "" : "n"} tu atención` : n ? "Se envían solas cuando hay señal" : "No tienes nada pendiente"}
            </span>
          </span>
        </button>
        {n > 0 && (
          <button
            onClick={() => void sincronizar({ forzar: true })}
            disabled={sincronizando}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-guinda px-3 text-sm font-bold text-white shadow-sm active:scale-95 disabled:opacity-50"
          >
            {sincronizando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Enviar ahora
          </button>
        )}
      </Tarjeta>

      {abierta && (
        <HojaModal titulo="Mis capturas" alCerrar={() => setAbierta(false)}>
          {paquetes.length === 0 ? (
            <p className="py-6 text-center text-sm text-stone-500">No hay capturas en la bandeja.</p>
          ) : (
            [...paquetes].reverse().map((p) => <FilaPaquete key={p.id} p={p} />)
          )}
          <p className="px-1 text-center text-[11px] text-stone-400">Las capturas ya enviadas se quitan de aquí después de 7 días.</p>
        </HojaModal>
      )}
    </>
  );
}
