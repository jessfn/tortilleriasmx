import { useState } from "react";
import { armarTelefono, formatearNacional, maxDigitos, PAISES, partirTelefono, type Pais } from "@tortillerias/shared";
import { Check, ChevronDown, Globe, Phone, Search } from "lucide-react";
import { HojaModal } from "./ui";

/**
 * Teléfono con país: botón con globo y la lada (+52) que abre la lista de países, y el número que se
 * va acomodando solo mientras se escribe. `value` y `onChange` usan la forma que se guarda
 * ("5512345678" para México, "+14155552671" para otro país).
 */
export function TelefonoCampo({
  etiqueta,
  value,
  onChange,
  error,
  ayuda,
  name,
}: {
  etiqueta: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  ayuda?: string;
  name?: string;
}) {
  const parte = partirTelefono(value);
  const [elegido, setElegido] = useState<Pais>(parte.pais);
  const [abierto, setAbierto] = useState(false);
  const [buscar, setBuscar] = useState("");
  // si el valor viene de fuera con otro país (p. ej. un borrador), manda el valor
  const pais = value && parte.pais.iso !== "??" && parte.pais.lada !== elegido.lada ? parte.pais : elegido;
  const digitos = value ? parte.digitos : "";
  const completo = digitos.length > 0 && !error;

  const q = buscar.trim().toLowerCase().replace(/^\+/, "");
  const lista = PAISES.filter((p) => !q || p.nombre.toLowerCase().includes(q) || p.lada.startsWith(q));

  return (
    <div>
      <span className="mb-1 block text-xs font-semibold text-stone-600">{etiqueta}</span>
      <div
        className={`flex h-12 items-stretch overflow-hidden rounded-xl border bg-white shadow-sm transition focus-within:ring-4 ${
          error ? "border-red-400 focus-within:ring-red-100" : completo ? "border-emerald-400 focus-within:ring-emerald-100" : "border-stone-200 focus-within:border-guinda focus-within:ring-guinda/10"
        }`}
      >
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="flex shrink-0 items-center gap-1.5 border-r border-stone-200 bg-stone-50 pl-3 pr-2 text-sm font-semibold text-stone-700 active:bg-stone-100"
          aria-label={`País: ${pais.nombre}, +${pais.lada}. Cambiar`}
        >
          <Globe className="h-[18px] w-[18px] text-guinda" aria-hidden />
          +{pais.lada}
          <ChevronDown className="h-4 w-4 text-stone-400" aria-hidden />
        </button>
        <span className="relative flex-1">
          <Phone className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-stone-400" aria-hidden />
          <input
            name={name}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={formatearNacional(digitos, pais)}
            onChange={(e) => onChange(armarTelefono(pais, e.target.value.replace(/\D/g, "").slice(0, maxDigitos(pais))))}
            placeholder={pais.iso === "MX" ? "55 1234 5678" : pais.lada === "1" ? "(415) 555-2671" : "Número"}
            className="h-full w-full bg-transparent pl-10 pr-9 text-base outline-none placeholder:text-stone-400"
          />
          {completo && <Check className="pointer-events-none absolute right-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-emerald-500" strokeWidth={3} aria-hidden />}
        </span>
      </div>
      {error ? <span className="mt-0.5 block text-xs text-red-600">{error}</span> : ayuda ? <span className="mt-0.5 block text-xs text-stone-500">{ayuda}</span> : null}

      {abierto && (
        <HojaModal titulo="País del teléfono" alCerrar={() => { setAbierto(false); setBuscar(""); }}>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-stone-400" aria-hidden />
            <input
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="Buscar país o código"
              className="h-11 w-full rounded-xl border border-stone-200 pl-10 pr-3 text-base outline-none focus:border-guinda"
            />
          </div>
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
            {lista.map((p) => {
              const activo = p.iso === pais.iso;
              return (
                <li key={p.iso}>
                  <button
                    type="button"
                    onClick={() => {
                      setElegido(p);
                      // al cambiar de país se conservan los dígitos que quepan
                      onChange(armarTelefono(p, digitos.slice(0, maxDigitos(p))));
                      setAbierto(false);
                      setBuscar("");
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${activo ? "bg-guinda/10 font-semibold text-guinda" : "active:bg-stone-100"}`}
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-stone-100 text-[11px] font-bold text-stone-600">{p.iso}</span>
                    <span className="flex-1">{p.nombre}</span>
                    <span className="text-stone-500">+{p.lada}</span>
                    {activo && <Check className="h-4 w-4" aria-hidden />}
                  </button>
                </li>
              );
            })}
            {lista.length === 0 && <li className="px-3 py-6 text-center text-sm text-stone-500">No hay países con ese nombre.</li>}
          </ul>
        </HojaModal>
      )}
    </div>
  );
}
