import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, Clock, Home, MapPin, PackageOpen, Plus, Store, UserRound, Wheat, XCircle, Layers, Loader2 } from "lucide-react";
import { api, type Sesion } from "./api";
import Perfil from "./Perfil";
import { CLAVES, usePersistente } from "./persist";
import { Boton, Dato, Insignia, PanelShell, Tarjeta, Vacio } from "./ui";

type Resumen = { registros: number; pendientes: number; aprobados: number; rechazados: number; tortillerias: number };
type Registro = {
  id: string; producto: "maiz" | "harina" | "masa"; precio_kg: string; fecha: string; creado_en: string; estatus: string; alerta: boolean;
  nombre: string; domicilio: string | null; municipio: string | null; estado: string | null;
};

const PRODUCTO = { maiz: { t: "Maíz", i: Wheat }, harina: { t: "Harina", i: PackageOpen }, masa: { t: "Masa", i: Layers } };
const fecha = (s: string) => new Date(s).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });

function TarjetaRegistro({ r }: { r: Registro }) {
  const P = PRODUCTO[r.producto];
  return (
    <Tarjeta className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-guinda/10 text-guinda">
        <Store className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-semibold leading-tight">{r.nombre}</p>
          <Insignia estatus={r.estatus} />
        </div>
        <p className="flex items-center gap-1 truncate text-xs text-stone-500">
          <MapPin className="h-3 w-3 shrink-0" aria-hidden /> {[r.municipio, r.estado].filter(Boolean).join(", ") || "Sin ubicación"}
        </p>
        <div className="mt-1.5 flex items-center justify-between text-sm">
          <span className="flex items-center gap-1 text-stone-600">
            <P.i className="h-4 w-4" aria-hidden /> {P.t} · <b className="text-stone-900">${Number(r.precio_kg).toFixed(2)}</b> /kg
          </span>
          <span className="text-xs text-stone-400">{fecha(r.creado_en)}</span>
        </div>
      </div>
    </Tarjeta>
  );
}

export default function PanelUsuario({
  sesion, alCapturar, alActualizarSesion, alSalir,
}: { sesion: Sesion; alCapturar: () => void; alActualizarSesion: (s: Sesion) => void; alSalir: () => void }) {
  const [tab, setTab] = usePersistente(CLAVES.tabUsuario, "inicio");
  const [resumen, setResumen] = useState<Resumen>();
  const [registros, setRegistros] = useState<Registro[]>();
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    Promise.all([api<Resumen>("/mis/resumen"), api<Registro[]>("/mis/registros")])
      .then(([a, b]) => {
        setResumen(a);
        setRegistros(b);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(cargar, [cargar]);

  const u = sesion.usuario;
  const nombre = u.nombre ? u.nombre.split(" ")[0] : u.correo.split("@")[0];

  return (
    <PanelShell
      titulo={`Hola, ${nombre}`}
      subtitulo={tab === "inicio" ? "Este es tu panel" : tab === "registros" ? "Tus tortillerías y precios" : "Tu cuenta"}
      pestañas={[
        { id: "inicio", texto: "Inicio", icono: Home },
        { id: "registros", texto: "Mis registros", icono: ClipboardList, insignia: resumen?.pendientes },
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
            <h2 className="text-sm font-bold">Últimos registros</h2>
            {!!registros?.length && (
              <button onClick={() => setTab("registros")} className="text-xs font-semibold text-guinda">
                Ver todos
              </button>
            )}
          </div>
          {!registros ? (
            <div className="grid place-items-center py-8 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : registros.length === 0 ? (
            <Vacio icono={Store} titulo="Aún no tienes registros" texto="Registra tu primera tortillería para empezar." />
          ) : (
            registros.slice(0, 3).map((r) => <TarjetaRegistro key={r.id} r={r} />)
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
          {!registros ? (
            <div className="grid place-items-center py-8 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : registros.length === 0 ? (
            <Vacio icono={ClipboardList} titulo="Sin registros todavía" texto="Cuando captures un precio aparecerá aquí con su estado de revisión." />
          ) : (
            registros.map((r) => <TarjetaRegistro key={r.id} r={r} />)
          )}
          <Boton onClick={alCapturar} icono={Plus}>
            Registrar otra tortillería
          </Boton>
        </>
      )}

      {tab === "perfil" && <Perfil sesion={sesion} alActualizar={alActualizarSesion} alSalir={alSalir} />}
    </PanelShell>
  );
}
