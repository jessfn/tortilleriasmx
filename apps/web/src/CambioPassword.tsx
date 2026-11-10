import { useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { cambioPasswordSchema, PASSWORD_MIN } from "@tortillerias/shared";
import { api, guardarSesion, type Sesion } from "./api";
import AuthLayout from "./AuthLayout";
import { Aviso, Boton, Campo } from "./ui";

/**
 * Pantalla obligatoria cuando la administración restableció la contraseña: la persona entró con una temporal
 * y debe crear la suya antes de usar la aplicación.
 */
export default function CambioPassword({ sesion, alListo, alSalir }: { sesion: Sesion; alListo: (s: Sesion) => void; alSalir: () => void }) {
  const [v, setV] = useState({ actual: "", nueva: "", confirmar: "" });
  const [ver, setVer] = useState(false);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const r = cambioPasswordSchema.safeParse(v);
  const err = (c: "nueva" | "confirmar") => (v[c] && !r.success ? (r.error.flatten().fieldErrors[c] as string[] | undefined)?.[0] : undefined);
  const igual = v.nueva !== "" && v.nueva === v.actual;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!r.success || igual) return;
    setGuardando(true);
    setError("");
    try {
      await api("/perfil/password", { json: v });
      const nueva: Sesion = { ...sesion, usuario: { ...sesion.usuario, debeCambiarPassword: false } };
      guardarSesion(nueva);
      alListo(nueva);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  const ojo = (
    <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? "Ocultar contraseñas" : "Mostrar contraseñas"} className="grid h-10 w-10 place-items-center rounded-full text-stone-400 hover:text-stone-700">
      {ver ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
    </button>
  );

  return (
    <AuthLayout
      titulo="Crea tu contraseña"
      subtitulo="Entraste con una contraseña temporal"
      icono={ShieldCheck}
      alVolver={alSalir}
      pie={
        <div className="space-y-2">
          <Boton type="submit" form="form-cambio" disabled={!r.success || igual || guardando} icono={guardando ? Loader2 : KeyRound}>
            {guardando ? "Guardando…" : "Guardar y continuar"}
          </Boton>
          <button type="button" onClick={alSalir} className="w-full text-center text-sm font-semibold text-stone-500">
            Cerrar sesión
          </button>
        </div>
      }
    >
      <form id="form-cambio" onSubmit={guardar} className="space-y-3">
        <Aviso tipo="info">La administración restableció tu contraseña. Por seguridad, crea una nueva que solo tú conozcas.</Aviso>
        <Campo etiqueta="Contraseña temporal" icono={KeyRound} type={ver ? "text" : "password"} autoComplete="current-password" value={v.actual} onChange={(e) => setV({ ...v, actual: e.target.value })} derecha={ojo} />
        <Campo
          etiqueta="Nueva contraseña"
          icono={KeyRound}
          type={ver ? "text" : "password"}
          autoComplete="new-password"
          value={v.nueva}
          onChange={(e) => setV({ ...v, nueva: e.target.value })}
          error={igual ? "Debe ser distinta de la temporal" : err("nueva")}
          ayuda={`Mínimo ${PASSWORD_MIN} caracteres`}
        />
        <Campo etiqueta="Confirmar nueva contraseña" icono={KeyRound} type={ver ? "text" : "password"} autoComplete="new-password" value={v.confirmar} onChange={(e) => setV({ ...v, confirmar: e.target.value })} error={err("confirmar")} />
        {error && <Aviso>{error}</Aviso>}
      </form>
    </AuthLayout>
  );
}
