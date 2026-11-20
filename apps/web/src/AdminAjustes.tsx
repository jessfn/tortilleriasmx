import { useEffect, useState } from "react";
import { CalendarClock, Check, Loader2, Settings } from "lucide-react";
import { api } from "./api";
import { Aviso, Boton, Tarjeta } from "./ui";

type Ajustes = { corte: string; corteMx: string; zona: string; abierto: boolean; registro_abierto: number; por_autorizar: number };

const largo = (mx: string) => {
  const [f, h] = mx.split("T");
  const [a, m, d] = f.split("-").map(Number);
  return `${new Date(a, m - 1, d).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${h} h`;
};

/** Ajustes (solo administrador): fecha de corte del registro abierto. Se cambia aquí, sin publicar una versión nueva, y solo afecta a los registros que lleguen después. */
export default function AdminAjustes() {
  const [a, setA] = useState<Ajustes>();
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState("");

  useEffect(() => {
    api<Ajustes>("/admin/ajustes").then((r) => { setA(r); setValor(r.corteMx); }).catch((e) => setError(e.message));
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!valor) return;
    setGuardando(true);
    setError("");
    setHecho("");
    try {
      const r = await api<{ corteMx: string; abierto: boolean }>("/admin/ajustes/corte", { metodo: "PUT", json: { corteMx: valor } });
      setA((x) => (x ? { ...x, corteMx: r.corteMx, abierto: r.abierto } : x));
      setHecho("Fecha de corte guardada. Quedó en la bitácora.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-dorado/15 text-[#8a6a35]"><Settings className="h-[18px] w-[18px]" aria-hidden /></span>
        <div className="leading-tight">
          <h2 className="text-base font-bold">Ajustes</h2>
          <p className="text-xs text-stone-500">Opciones del sistema que se cambian sin publicar una versión nueva.</p>
        </div>
      </div>
      {error && <Aviso>{error}</Aviso>}

      <Tarjeta className="max-w-2xl space-y-4 !p-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-guinda" aria-hidden />
          <h3 className="text-sm font-bold">Fecha de corte del registro abierto</h3>
        </div>
        {!a ? (
          <div className="grid place-items-center py-6 text-stone-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <form onSubmit={guardar} className="space-y-3">
            <div className={`rounded-xl p-3 text-sm ring-1 ${a.abierto ? "bg-emerald-50 text-emerald-900 ring-emerald-200" : "bg-amber-50 text-amber-900 ring-amber-200"}`}>
              <p className="font-semibold">{a.abierto ? "El registro está abierto" : "El registro ya cerró"}</p>
              <p className="mt-0.5 text-xs">
                {a.abierto ? "Quien se registre ahora queda autorizado, con la marca de “registro abierto”." : "Quien se registre ahora queda por autorizar y no puede capturar hasta que lo autoricen."}
                {" "}Corte actual: <b>{largo(a.corteMx)}</b> (hora de México).
              </p>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-stone-600">Nueva fecha y hora de corte (hora de la Ciudad de México)</span>
              <input type="datetime-local" value={valor} onChange={(e) => setValor(e.target.value)} className="min-h-12 w-full rounded-2xl bg-white px-3.5 text-base shadow-sm ring-1 ring-stone-200 focus:outline-none focus:ring-2 focus:ring-guinda/50" />
            </label>
            {valor && <p className="text-xs text-stone-500">Se leerá como <b>{largo(valor)}</b>, hora de México (UTC−6), sin importar la zona de tu computadora.</p>}
            <p className="text-xs leading-snug text-stone-500">
              Solo afecta a los registros que lleguen después de guardar: las cuentas ya creadas no cambian. Hay {a.registro_abierto} {a.registro_abierto === 1 ? "cuenta con" : "cuentas con"} registro abierto por confirmar y {a.por_autorizar} {a.por_autorizar === 1 ? "solicitud" : "solicitudes"} por autorizar.
            </p>
            {hecho && <Aviso tipo="ok">{hecho}</Aviso>}
            <Boton type="submit" disabled={!valor || valor === a.corteMx || guardando} icono={guardando ? Loader2 : Check}>{guardando ? "Guardando…" : "Guardar fecha de corte"}</Boton>
          </form>
        )}
      </Tarjeta>
    </div>
  );
}
