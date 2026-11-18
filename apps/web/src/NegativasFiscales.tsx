import { useEffect, useState } from "react";
import { FileX } from "lucide-react";
import { textoMotivoSinFiscal } from "@tortillerias/shared";
import { api } from "./api";

type Negativa = { id: string; motivo: string; motivo_otro: string | null; fecha: string; censador: string | null };

/** Historial de las veces que no se obtuvieron los datos fiscales de una tortillería (solo administración) */
export function NegativasFiscales({ tortilleriaId }: { tortilleriaId: string }) {
  const [lista, setLista] = useState<Negativa[]>();
  useEffect(() => {
    let vigente = true;
    setLista(undefined);
    api<Negativa[]>(`/admin/tortillerias/${tortilleriaId}/negativas`)
      .then((r) => vigente && setLista(r))
      .catch(() => vigente && setLista([]));
    return () => {
      vigente = false;
    };
  }, [tortilleriaId]);

  if (!lista?.length) return null;
  return (
    <div className="mt-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
      <p className="flex items-center gap-2 text-xs font-bold text-amber-900">
        <FileX className="h-4 w-4" aria-hidden /> Intentos sin datos fiscales ({lista.length})
      </p>
      <ul className="mt-2 space-y-2">
        {lista.map((n) => (
          <li key={n.id} className="text-xs text-amber-950">
            <span className="font-semibold">{n.fecha}</span> · {textoMotivoSinFiscal(n.motivo)}
            {n.motivo === "otro" && n.motivo_otro ? <span className="block text-amber-800">“{n.motivo_otro}”</span> : null}
            {n.censador && <span className="block text-[11px] text-amber-700">Registró: {n.censador}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
