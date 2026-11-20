import { useEffect, useState } from "react";
import { Fingerprint, Landmark, Loader2, LogOut, ShieldCheck, User } from "lucide-react";
import { completarDatosSchema, curpSchema } from "@tortillerias/shared";
import { api, guardarSesion, type Sesion } from "./api";
import { listaEstados } from "./catalogo";
import { Aviso, Boton, Campo, Selector } from "./ui";

type Estado = { clave: string; nombre: string };

/**
 * "Completa tus datos": los censadores que ya existían antes de pedir CURP y estado. Hasta completarla no se inician capturas nuevas
 * (lo que ya estaba guardado en el teléfono SÍ se sigue enviando: la bandeja no depende de esta pantalla).
 */
export default function CompletaDatos({ sesion, alListo, alSalir }: { sesion: Sesion; alListo: (s: Sesion) => void; alSalir: () => void }) {
  const u = sesion.usuario;
  const partes = (u.apellidos ?? "").trim().split(/\s+/);
  const [nombre, setNombre] = useState(u.nombre ?? "");
  const [paterno, setPaterno] = useState(u.apellidoPaterno ?? partes[0] ?? "");
  const [materno, setMaterno] = useState(u.apellidoMaterno ?? partes.slice(1).join(" "));
  const [curp, setCurp] = useState("");
  const [estado, setEstado] = useState(u.estadoClave ?? "");
  const [aviso, setAviso] = useState(false);
  const [estados, setEstados] = useState<Estado[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const [falloEstados, setFalloEstados] = useState(false);
  const [cargandoEstados, setCargandoEstados] = useState(false);
  const cargarEstados = () => {
    setFalloEstados(false);
    setCargandoEstados(true);
    listaEstados().then((e) => setEstados(e)).catch(() => setFalloEstados(true)).finally(() => setCargandoEstados(false));
  };
  useEffect(cargarEstados, []); // eslint-disable-line react-hooks/exhaustive-deps

  const r = completarDatosSchema.safeParse({ nombre, apellidoPaterno: paterno, apellidoMaterno: materno, curp, estadoClave: estado, aceptoAviso: aviso });
  const errCampo = (c: string, valor: string) => (valor && !r.success ? (r.error.flatten().fieldErrors as Record<string, string[] | undefined>)[c]?.[0] : undefined);
  const curpOk = curpSchema.safeParse(curp).success;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!r.success) return;
    setError("");
    setCargando(true);
    try {
      const usuario = await api<Sesion["usuario"]>("/auth/completar-datos", { json: r.data });
      const s = { ...sesion, usuario: { ...sesion.usuario, ...usuario } };
      guardarSesion(s);
      alListo(s);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="marco-pc mx-auto flex min-h-dvh max-w-xl flex-col bg-stone-50 lg:max-w-2xl">
      <header className="bg-gradient-to-b from-guinda-oscuro to-guinda px-5 pb-6 pt-8 text-white">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-white/15"><User className="h-6 w-6 text-dorado" aria-hidden /></span>
        <h1 className="mt-3 text-2xl font-bold">Completa tus datos</h1>
        <p className="mt-1 text-sm text-white/80">Ahora pedimos tu CURP y tu estado para identificar al personal que registra precios. Lo haces una sola vez.</p>
      </header>
      <form onSubmit={guardar} className="flex-1 space-y-3 px-4 py-5">
        <Campo etiqueta="Nombre(s) *" icono={User} value={nombre} autoComplete="given-name" onChange={(e) => setNombre(e.target.value)} error={errCampo("nombre", nombre)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Apellido paterno *" value={paterno} autoComplete="family-name" onChange={(e) => setPaterno(e.target.value)} error={errCampo("apellidoPaterno", paterno)} />
          <Campo etiqueta="Apellido materno *" value={materno} autoComplete="off" onChange={(e) => setMaterno(e.target.value)} error={errCampo("apellidoMaterno", materno)} />
        </div>
        <Campo
          etiqueta="CURP *"
          icono={Fingerprint}
          value={curp}
          maxLength={18}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCurp(e.target.value.toUpperCase().replace(/\s/g, ""))}
          error={curp && !curpOk ? "Revisa la CURP (18 caracteres)" : undefined}
          valido={curpOk}
          placeholder="Ej. HEGG560427MVZRRL04"
          ayuda="Se guarda cifrada y no se muestra a nadie más"
        />
        <Selector
          etiqueta="Estado *"
          icono={Landmark}
          value={estado}
          onChange={(e) => setEstado(e.target.value)}
          placeholder={cargandoEstados && !estados.length ? "Cargando estados…" : "Elige el estado"}
          opciones={estados.map((x) => ({ valor: x.clave, texto: x.nombre }))}
          ayuda={falloEstados && !estados.length ? undefined : u.estadoSugerido && u.estadoClave && estado === u.estadoClave ? "Lo elegimos por donde más has capturado. Cámbialo si no es el correcto." : "Elige el estado donde trabajas."}
        />
        {falloEstados && !estados.length && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200">
            <span>No pudimos cargar los estados. Revisa tu conexión.</span>
            <button type="button" onClick={cargarEstados} disabled={cargandoEstados} className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-guinda ring-1 ring-red-200 disabled:opacity-50">{cargandoEstados ? "Cargando…" : "Reintentar"}</button>
          </div>
        )}
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
          <input type="checkbox" checked={aviso} onChange={(e) => setAviso(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-guinda" />
          <span className="text-sm leading-snug text-stone-600">
            <ShieldCheck className="mr-1 inline h-4 w-4 text-verde" aria-hidden />
            Acepto el aviso de privacidad para el tratamiento de estos datos. La CURP se guarda cifrada.
          </span>
        </label>
        {error && <Aviso>{error}</Aviso>}
        <Boton type="submit" disabled={!r.success || cargando} icono={cargando ? Loader2 : undefined}>{cargando ? "Guardando…" : "Guardar y continuar"}</Boton>
        <Boton type="button" variante="fantasma" onClick={alSalir} icono={LogOut}>Cerrar sesión</Boton>
        <p className="px-1 text-center text-[11px] text-stone-500">Mientras tanto, lo que ya tenías guardado en tu teléfono se sigue enviando.</p>
      </form>
    </div>
  );
}
