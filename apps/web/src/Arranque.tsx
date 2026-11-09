import { useEffect, useState } from "react";
import { CloudDownload, Loader2 } from "lucide-react";
import { api, type Sesion } from "./api";
import { pedirAlmacenamientoPersistente } from "./bd";
import { iniciarSincronizacion, refrescarTemporales } from "./bandeja";
import { actualizarCatalogos, alCambiarCatalogo, cargarCatalogoLocal, descargarEstado, estadosDescargados, listaEstados, type Item } from "./catalogo";
import { useEnLinea } from "./Conexion";
import { Aviso, Boton, Selector, Tarjeta } from "./ui";

const CADA_6_H = 6 * 3600 * 1000;

/** Posición del teléfono (el GPS funciona sin internet). Devuelve null si se niega o tarda demasiado. */
function posicion(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => ok(null),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 5 * 60_000 },
    );
  });
}

/** Mensaje temporal que se ve mientras se descarga un estado (null = no mostrar nada) */
export function useArranque(sesion: Sesion | null): string | null {
  const [mensaje, setMensaje] = useState<string | null>(null);
  const uid = sesion?.usuario.id;
  const capturista = sesion?.usuario.rol === "capturista";

  useEffect(() => {
    if (!uid || !capturista) return;
    let vivo = true;
    let ocultar: number | undefined;
    const decir = (t: string | null, ms = 0) => {
      if (!vivo) return;
      window.clearTimeout(ocultar);
      setMensaje(t);
      if (t && ms) ocultar = window.setTimeout(() => vivo && setMensaje(null), ms);
    };

    /** Primera vez: se descarga el estado donde está el censador */
    async function descargarPrimero() {
      const pos = await posicion();
      if (!pos || !vivo) return; // sin GPS: el panel ofrece elegir el estado a mano
      const z = await api<{ estado: Item | null }>(`/ubicacion/cercana?lat=${pos.lat}&lng=${pos.lng}`);
      if (!z.estado || !vivo) return;
      await bajar(z.estado);
    }
    async function bajar(estado: Item) {
      decir(`Descargando tortillerías de ${estado.nombre}…`);
      try {
        await descargarEstado(estado.clave, estado.nombre);
        const e = estadosDescargados().find((x) => x.clave === estado.clave);
        decir(`Listo: ${(e?.total ?? 0).toLocaleString("es-MX")} tortillerías guardadas para usar sin señal`, 5000);
      } catch {
        decir(null); // sin red o error: se reintenta al volver la señal
      }
    }

    async function revisar() {
      if (!navigator.onLine) return;
      try {
        await actualizarCatalogos();
        if (!estadosDescargados().length) await descargarPrimero();
      } catch {
        /* sin red: se intenta de nuevo después */
      }
    }

    pedirAlmacenamientoPersistente();
    void (async () => {
      await cargarCatalogoLocal(); // lo ya descargado pasa a memoria (mapa y lista sin red)
      await refrescarTemporales();
      iniciarSincronizacion(); // envío automático de la bandeja
      await revisar();
    })();

    const cada = window.setInterval(() => void revisar(), CADA_6_H);
    const alVolver = () => void revisar();
    window.addEventListener("online", alVolver);
    return () => {
      vivo = false;
      window.clearTimeout(ocultar);
      window.clearInterval(cada);
      window.removeEventListener("online", alVolver);
    };
  }, [uid, capturista]);

  return mensaje;
}

export function AvisoDescarga({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null;
  const listo = mensaje.startsWith("Listo");
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-3" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 78px)" }} role="status">
      <span className="flex max-w-full items-center gap-1.5 rounded-full bg-stone-900/90 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur">
        {listo ? <CloudDownload className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden /> : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />}
        <span className="truncate">{mensaje}</span>
      </span>
    </div>
  );
}

/** Cuántos estados hay descargados (se actualiza sola cuando termina una descarga) */
export function useEstadosDescargados() {
  const [lista, setLista] = useState(estadosDescargados);
  useEffect(() => {
    setLista(estadosDescargados());
    return alCambiarCatalogo(() => setLista(estadosDescargados()));
  }, []);
  return lista;
}

/** Descargar un estado a mano, con progreso. Lo usan el panel (primera vez) y el Perfil ("Agregar otro estado"). */
export function SelectorDescarga({ yaDescargados, etiqueta = "Estado" }: { yaDescargados: string[]; etiqueta?: string }) {
  const enLinea = useEnLinea();
  const [estados, setEstados] = useState<Item[]>([]);
  const [clave, setClave] = useState("");
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    listaEstados().then(setEstados).catch(() => {});
  }, [enLinea]);

  async function descargar() {
    const e = estados.find((x) => x.clave === clave);
    if (!e) return;
    setBajando(true);
    setError("");
    try {
      await descargarEstado(e.clave, e.nombre);
      setClave("");
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBajando(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <Selector
        etiqueta={etiqueta}
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        placeholder="Elige un estado"
        opciones={estados.filter((e) => !yaDescargados.includes(e.clave)).map((e) => ({ valor: e.clave, texto: e.nombre }))}
        disabled={bajando}
      />
      {error && <Aviso>{error}</Aviso>}
      <Boton onClick={descargar} disabled={!clave || bajando || !enLinea} icono={bajando ? Loader2 : CloudDownload}>
        {bajando ? "Descargando…" : "Descargar"}
      </Boton>
      {!enLinea && <p className="text-center text-xs text-stone-500">Necesitas señal para descargar</p>}
    </div>
  );
}

/** Tarjeta del panel cuando todavía no hay ningún estado en el teléfono (p. ej. no se pudo usar el GPS) */
export function TarjetaDescargaEstado() {
  const lista = useEstadosDescargados();
  if (lista.length) return null;
  return (
    <Tarjeta className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <CloudDownload className="h-4 w-4 text-guinda" aria-hidden /> Descarga tu estado para trabajar sin señal
        </h2>
        <p className="mt-0.5 text-xs text-stone-500">Se guardan las tortillerías en tu teléfono (menos de 1 MB). Hazlo ahora que tienes internet.</p>
      </div>
      <SelectorDescarga yaDescargados={[]} />
    </Tarjeta>
  );
}
