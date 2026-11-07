import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { buscarLugar, type Lugar } from "./geocoder";
import { Buscador } from "./ui";

/** Buscador de direcciones para la barra superior; los resultados flotan sobre el mapa */
export default function BuscadorLugar({ onElegir }: { onElegir: (l: Lugar) => void }) {
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Lugar[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [vacio, setVacio] = useState(false);

  useEffect(() => {
    setVacio(false);
    if (q.trim().length < 3) return setResultados([]);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await buscarLugar(q, ctrl.signal);
        setResultados(r);
        setVacio(r.length === 0);
      } catch {
        /* cancelada o sin red */
      } finally {
        setBuscando(false);
      }
    }, 450); // espera para respetar el uso razonable del servicio gratuito
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  return (
    <div className="relative">
      <Buscador value={q} onChange={setQ} placeholder="Buscar calle, colonia o lugar" cargando={buscando} />
      {(resultados.length > 0 || vacio) && (
        <ul className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[45dvh] overflow-y-auto rounded-xl bg-white py-1 text-stone-900 shadow-2xl ring-1 ring-black/5">
          {vacio && <li className="px-4 py-3 text-sm text-stone-500">Sin resultados. Prueba con otra palabra o toca el mapa.</li>}
          {resultados.map((l, i) => (
            <li key={i}>
              <button
                onClick={() => {
                  setQ("");
                  setResultados([]);
                  onElegir(l);
                }}
                className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-stone-100"
              >
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-guinda" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium">{l.nombre}</span>
                  <span className="block truncate text-xs text-stone-500">{l.detalle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
