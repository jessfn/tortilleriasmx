import { useEffect, useState } from "react";
import { ClipboardCheck, ClipboardX, History, Lock, Loader2 } from "lucide-react";
import {
  aplicaB6, aplicaB7, respuestaHigiene, APOYOS, CONOCE_ACUERDO, DECLARACION_ANUAL, HIGIENE_PUNTOS, IMSS, INSUMO, LICENCIA, MOTIVO_NO_ADHESION, NUM_TRABAJADORES, PREGUNTAS,
  PROPIEDAD, textoB2, textoDe, textoMotivoNoAplica, UBICACION_TIPO, VOLUMEN_SEMANAL, type Respuestas,
} from "@tortillerias/shared";
import { api } from "./api";
import { Aviso } from "./ui";

type Registro = {
  id: string; estatus: "aplicado" | "no_aplicado"; version: string; fecha: string; motivo: string | null; motivoOtro: string | null;
  censador: string | null; respuestas: Respuestas | null;
};
type Datos = { vigente: Registro | null; ultimo: Registro | null; historial: Registro[] };

const cuando = (s: string) => new Date(s).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const lista = (l: readonly { clave: string; texto: string }[], v?: readonly string[]) => (v?.length ? v.map((c) => textoDe(l, c)).join(" · ") : "—");

/**
 * C21 · Cuestionario de una tortillería en el detalle. SOLO lo usa el rol admin (DGTIC): la API responde 403 a cualquier otro,
 * y abrirlo queda en la bitácora (ver_cuestionario). Se muestran los textos, nunca los códigos.
 */
export default function CuestionarioAdmin({ tortilleriaId }: { tortilleriaId: string }) {
  const [d, setD] = useState<Datos | null>();
  const [error, setError] = useState("");
  const [verHistorial, setVerHistorial] = useState(false);

  useEffect(() => {
    let vigente = true;
    setD(undefined);
    setVerHistorial(false);
    api<Datos>(`/admin/cuestionarios/tortilleria/${tortilleriaId}`)
      .then((r) => vigente && setD(r))
      .catch((e) => vigente && (setError(e.message), setD(null)));
    return () => {
      vigente = false;
    };
  }, [tortilleriaId]);

  if (d === undefined) return <p className="flex items-center gap-2 py-4 text-sm text-stone-400"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>;
  if (d === null) return <Aviso>{error || "No se pudo cargar el cuestionario"}</Aviso>;
  if (!d.historial.length) return <p className="py-3 text-sm text-stone-500">Todavía no tiene cuestionario. Se aplica una sola vez, después de capturar el precio.</p>;

  const ultNo = d.ultimo?.estatus === "no_aplicado" ? d.ultimo : null;
  return (
    <div className="space-y-3 py-2">
      {ultNo && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <ClipboardX className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <b>Último intento: no se pudo aplicar</b> · {ultNo.motivo === "OTRO" && ultNo.motivoOtro ? `Otro: ${ultNo.motivoOtro}` : textoMotivoNoAplica(ultNo.motivo)}
            <span className="block text-xs text-amber-800/80">{cuando(ultNo.fecha)}{ultNo.censador ? ` · ${ultNo.censador}` : ""}</span>
          </span>
        </div>
      )}

      {d.vigente?.respuestas ? (
        <>
          <p className="flex items-center gap-1.5 text-xs text-stone-500">
            <ClipboardCheck className="h-4 w-4 text-emerald-600" aria-hidden /> Aplicado el {cuando(d.vigente.fecha)}{d.vigente.censador ? ` · ${d.vigente.censador}` : ""} · versión {d.vigente.version}
          </p>
          <Respuestas r={d.vigente.respuestas} />
        </>
      ) : (
        <p className="text-sm text-stone-500">No tiene un cuestionario aplicado.</p>
      )}

      {d.historial.length > 1 && (
        <div>
          <button onClick={() => setVerHistorial((v) => !v)} className="flex items-center gap-1.5 text-sm font-semibold text-guinda">
            <History className="h-4 w-4" aria-hidden /> {verHistorial ? "Ocultar historial" : `Ver historial (${d.historial.length} registros)`}
          </button>
          {verHistorial && (
            <ul className="mt-2 space-y-1.5">
              {d.historial.map((h) => (
                <li key={h.id} className="rounded-xl bg-stone-50 px-3 py-2 text-xs ring-1 ring-stone-100">
                  <span className={`font-semibold ${h.estatus === "aplicado" ? "text-emerald-700" : "text-amber-700"}`}>{h.estatus === "aplicado" ? "Aplicado" : "No se pudo aplicar"}</span>
                  {h.estatus === "no_aplicado" && <> · {h.motivo === "OTRO" && h.motivoOtro ? `Otro: ${h.motivoOtro}` : textoMotivoNoAplica(h.motivo)}</>}
                  {h.id === d.vigente?.id && <span className="ml-1 rounded-full bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700">vigente</span>}
                  <span className="block text-stone-400">{cuando(h.fecha)}{h.censador ? ` · ${h.censador}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Respuestas({ r }: { r: Respuestas }) {
  return (
    <div className="space-y-2">
      <Bloque titulo="A · Lo que observó el censador">
        <Fila p={`A1. ${PREGUNTAS.a1}`} v={textoDe(UBICACION_TIPO, r.a1) + (r.a1Otro ? `: ${r.a1Otro}` : "")} />
        <div className="py-1.5">
          <p className="text-[11px] font-medium text-stone-500">A2. Higiene</p>
          <ul className="mt-1 space-y-0.5">
            {HIGIENE_PUNTOS.map((h) => (
              <li key={h.clave} className="flex items-start justify-between gap-2 text-[13px]">
                <span className="text-stone-700">{h.pregunta}</span>
                {/* verde = buena higiene; la palabra es la respuesta a la pregunta */}
                <b className={`shrink-0 ${r.a2[h.clave] ? "text-emerald-700" : "text-red-700"}`}>{respuestaHigiene(h, r.a2[h.clave]) ? "Sí" : "No"}</b>
              </li>
            ))}
          </ul>
        </div>
      </Bloque>
      <Bloque titulo="B · Preguntas al encargado">
        <Fila p={`B1. ${PREGUNTAS.b1}`} v={textoDe(INSUMO, r.b1) + (r.b1Otro ? `: ${r.b1Otro}` : "")} />
        <Fila p={`B2. ${textoB2(r.b1)}`} v={textoDe(VOLUMEN_SEMANAL, r.b2)} />
        <Fila p={`B3. ${PREGUNTAS.b3}`} v={textoDe(PROPIEDAD, r.b3) + (r.b3Otro ? `: ${r.b3Otro}` : "")} />
        <Fila p={`B4. ${PREGUNTAS.b4}`} v={textoDe(NUM_TRABAJADORES, r.b4)} />
        <Fila p={`B5. ${PREGUNTAS.b5}`} v={textoDe(CONOCE_ACUERDO, r.b5)} />
        {aplicaB6(r.b5) && <Fila p={`B6. ${PREGUNTAS.b6}`} v={lista(MOTIVO_NO_ADHESION, r.b6) + (r.b6Otro ? ` (${r.b6Otro})` : "")} />}
        {aplicaB7(r.b5) && <Fila p={`B7. ${PREGUNTAS.b7}`} v={r.b7 ? "Sí" : "No"} />}
        <Fila p={`B8. ${PREGUNTAS.b8}`} v={lista(APOYOS, r.b8) + (r.b8Otro ? ` (${r.b8Otro})` : "")} />
      </Bloque>
      <Bloque titulo="C · Licencia, IMSS y SAT" sensible>
        <Fila p={`C1. ${PREGUNTAS.c1}`} v={textoDe(LICENCIA, r.c1)} />
        <Fila p={`C2. ${PREGUNTAS.c2}`} v={textoDe(IMSS, r.c2)} />
        <Fila p={`C3. ${PREGUNTAS.c3}`} v={textoDe(DECLARACION_ANUAL, r.c3)} />
      </Bloque>
    </div>
  );
}

function Bloque({ titulo, sensible, children }: { titulo: string; sensible?: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white px-3 py-2 ring-1 ring-stone-200">
      <h4 className="flex items-center gap-1.5 border-b border-stone-100 pb-1.5 text-xs font-bold uppercase tracking-wide text-guinda">
        {sensible && <Lock className="h-3.5 w-3.5" aria-hidden />} {titulo}
      </h4>
      <div className="divide-y divide-stone-100">{children}</div>
    </section>
  );
}

function Fila({ p, v }: { p: string; v: string }) {
  return (
    <div className="py-1.5">
      <p className="text-[11px] font-medium leading-snug text-stone-500">{p}</p>
      <p className="text-[13px] font-semibold text-stone-900">{v}</p>
    </div>
  );
}
