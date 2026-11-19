import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { textoMotivoSinFoto } from "@tortillerias/shared";
import { api } from "./api";

type Negativa = { id: string; motivo: string; motivo_otro: string | null; fecha: string; censador: string | null };

/** Veces que un censador visitó la tortillería y no pudo tomar su foto, con el motivo (solo administración) */
export function NegativasFoto({ tortilleriaId }: { tortilleriaId: string }) {
  const [lista, setLista] = useState<Negativa[]>();
  useEffect(() => {
    let vigente = true;
    setLista(undefined);
    api<Negativa[]>(`/admin/tortillerias/${tortilleriaId}/negativas-foto`)
      .then((r) => vigente && setLista(r))
      .catch(() => vigente && setLista([]));
    return () => {
      vigente = false;
    };
  }, [tortilleriaId]);

  if (!lista?.length) return null;
  return (
    <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
      <p className="flex items-center gap-2 text-xs font-bold text-amber-900">
        <ImageOff className="h-4 w-4" aria-hidden /> Intentos sin foto ({lista.length})
      </p>
      <ul className="mt-2 space-y-2">
        {lista.map((n) => (
          <li key={n.id} className="text-xs text-amber-950">
            <span className="font-semibold">{n.fecha}</span> · {textoMotivoSinFoto(n.motivo)}
            {n.motivo === "otro" && n.motivo_otro ? <span className="block text-amber-800">“{n.motivo_otro}”</span> : null}
            {n.censador && <span className="block text-[11px] text-amber-700">Registró: {n.censador}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
