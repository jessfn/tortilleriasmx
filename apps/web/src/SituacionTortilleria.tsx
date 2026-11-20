import { useEffect, useState } from "react";
import { Ban, CircleCheck, Cog, RotateCcw } from "lucide-react";
import { textoElaboracion, textoMotivoBaja } from "@tortillerias/shared";
import { api } from "./api";

type Situacion = {
  operacion: "activa" | "inactiva";
  elaboracion: string | null;
  bajas: { motivo: string; motivo_otro: string | null; fecha: string; censador: string | null; contradicciones: number; reactivada_en: string | null; reactivada_por: string | null }[];
  historial_elaboracion: { elaboracion: string; fecha: string; censador: string | null }[];
};
const dia = (s: string) => new Date(s).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

/** Detalle de una tortillería: si sigue funcionando (con su baja, quién y por qué) y cómo hacen la tortilla (con su historial). Solo lectura. */
export default function SituacionTortilleria({ tortilleriaId }: { tortilleriaId: string }) {
  const [s, setS] = useState<Situacion>();
  useEffect(() => {
    let vigente = true;
    setS(undefined);
    api<Situacion>(`/admin/tortillerias/${tortilleriaId}/situacion`)
      .then((r) => vigente && setS(r))
      .catch(() => vigente && setS(undefined));
    return () => { vigente = false; };
  }, [tortilleriaId]);

  if (!s) return null;
  const baja = s.bajas[0];
  const reciente = s.historial_elaboracion[0];
  return (
    <div className="mt-2 space-y-2">
      <div className={`rounded-xl p-3 text-xs ring-1 ${s.operacion === "inactiva" ? "bg-red-50 text-red-900 ring-red-200" : "bg-stone-50 text-stone-700 ring-stone-200"}`}>
        <p className="flex items-center gap-2 text-xs font-bold">
          {s.operacion === "inactiva" ? <Ban className="h-4 w-4 text-red-700" aria-hidden /> : <CircleCheck className="h-4 w-4 text-emerald-600" aria-hidden />}
          Operación: {s.operacion === "inactiva" ? "dada de baja" : "activa"}
        </p>
        {baja && (
          <ul className="mt-1.5 space-y-1">
            <li>
              <b>{textoMotivoBaja(baja.motivo).split(" (")[0]}</b>
              {baja.motivo === "otro" && baja.motivo_otro ? ` — “${baja.motivo_otro}”` : ""} · {dia(baja.fecha)}
              {baja.censador && <span className="block text-[11px] opacity-80">Reportó: {baja.censador}</span>}
            </li>
            {baja.contradicciones > 0 && <li className="font-semibold text-amber-800">Se intentó capturar un precio después de la baja ({baja.contradicciones}).</li>}
            {baja.reactivada_en && (
              <li className="flex items-center gap-1.5 font-semibold text-emerald-700"><RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reactivada el {dia(baja.reactivada_en)}{baja.reactivada_por ? ` por ${baja.reactivada_por}` : ""}</li>
            )}
          </ul>
        )}
      </div>
      <div className="rounded-xl bg-stone-50 p-3 text-xs text-stone-700 ring-1 ring-stone-200">
        <p className="flex items-center gap-2 text-xs font-bold"><Cog className="h-4 w-4 text-guinda" aria-hidden /> Elaboración: {s.elaboracion ? textoElaboracion(s.elaboracion) : "sin dato"}</p>
        {reciente && s.elaboracion && <p className="mt-0.5 text-[11px] text-stone-500">Registrado el {dia(reciente.fecha)}{reciente.censador ? ` por ${reciente.censador}` : ""}</p>}
        {s.historial_elaboracion.length > 1 && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[11px] font-semibold text-guinda">Historial ({s.historial_elaboracion.length})</summary>
            <ul className="mt-1 space-y-0.5">
              {s.historial_elaboracion.map((h, i) => (
                <li key={i} className="text-[11px]">{dia(h.fecha)} · <b>{textoElaboracion(h.elaboracion)}</b>{h.censador ? ` · ${h.censador}` : ""}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
