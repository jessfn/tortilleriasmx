import { useState } from "react";
import { BarChart3, ClipboardCheck, Eye, EyeOff, KeyRound, Loader2, LogIn, Map as MapaIcono, ShieldCheck, UserRound } from "lucide-react";
import { api, cuentaDeEsteAcceso, guardarSesion, type Sesion } from "./api";
import { Aviso, Boton, Campo, HojaModal } from "./ui";

const FUNCIONES = [
  { i: MapaIcono, t: "Mapa de precios en vivo", d: "Cada tortillería con su último precio" },
  { i: ClipboardCheck, t: "Revisión de registros", d: "Valida tortillerías nuevas y precios" },
  { i: BarChart3, t: "Estadísticas", d: "Promedios por estado y municipio" },
];

/**
 * Acceso al panel administrativo (administración y supervisión). Es independiente del inicio de sesión de quienes
 * registran tortillerías: otra pantalla, otra sesión y no admite cuentas de tortillerías.
 */
export default function LoginAdmin({ alEntrar }: { alEntrar: (s: Sesion) => void }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const [ayuda, setAyuda] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!usuario || !password) return;
    setError("");
    setCargando(true);
    try {
      const s = await api<Sesion>("/auth/login", { json: { usuario: usuario.trim(), password } });
      if (!cuentaDeEsteAcceso(s.usuario.rol)) {
        setError("Esta cuenta no tiene acceso al panel administrativo.");
        return;
      }
      guardarSesion(s);
      alEntrar(s);
    } catch (err: any) {
      setError(err.status === 429 ? "Demasiados intentos. Espera un minuto." : err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-guinda-oscuro lg:h-dvh lg:flex-row lg:overflow-hidden">
      {/* Portada institucional */}
      <aside className="relative shrink-0 overflow-hidden px-6 pb-14 pt-[max(1.5rem,env(safe-area-inset-top))] text-white lg:flex lg:w-[46%] lg:flex-col lg:justify-between lg:px-12 lg:pb-12 lg:pt-12">
        <img src="/login-tortilleria.jpg" alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#2a0615]/95 via-guinda-oscuro/90 to-guinda-oscuro/70 lg:bg-gradient-to-br" aria-hidden />

        <div className="relative flex items-center gap-3">
          <span className="text-sm font-bold uppercase tracking-[.2em] text-dorado">TortilleríasMX</span>
        </div>

        <div className="relative mt-8 lg:mt-0">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1 text-[11px] font-semibold backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5 text-dorado" aria-hidden /> Acceso restringido
          </span>
          <h1 className="mt-3 font-patria text-[2.3rem] font-normal leading-[1.05] lg:text-6xl">
            Panel <span className="text-dorado">administrativo</span>
          </h1>
          <p className="mt-3 max-w-sm text-sm leading-snug text-white/80 lg:text-base">Administración y supervisión del registro nacional del precio de la tortilla.</p>
        </div>

        <ul className="relative hidden space-y-4 lg:block">
          {FUNCIONES.map((f) => (
            <li key={f.t} className="flex items-center gap-3.5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/12 backdrop-blur">
                <f.i className="h-5 w-5 text-dorado" aria-hidden />
              </span>
              <span>
                <span className="block text-sm font-semibold">{f.t}</span>
                <span className="block text-xs text-white/70">{f.d}</span>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/* Formulario */}
      <main className="paso relative z-10 -mt-6 flex flex-1 flex-col justify-center rounded-t-[1.75rem] bg-stone-50 px-5 pb-8 pt-7 shadow-[0_-6px_18px_-6px_rgba(0,0,0,.35)] lg:mt-0 lg:rounded-none lg:px-16 lg:shadow-none">
        <form onSubmit={entrar} className="mx-auto w-full max-w-sm space-y-4">
          <div>
            <h2 className="text-2xl font-bold leading-tight">Iniciar sesión</h2>
            <p className="mt-1 text-sm text-stone-500">Solo para personal autorizado.</p>
          </div>
          <Campo
            etiqueta="Correo o usuario"
            icono={UserRound}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            value={usuario}
            onChange={(e) => {
              setUsuario(e.target.value);
              setError("");
            }}
            placeholder="Tu correo o usuario"
            valido={usuario.trim().length >= 3}
            enterKeyHint="next"
          />
          <Campo
            etiqueta="Contraseña"
            icono={KeyRound}
            type={ver ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            placeholder="Tu contraseña"
            enterKeyHint="go"
            derecha={
              <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"} className="grid h-10 w-10 place-items-center rounded-full text-stone-400 hover:text-stone-700">
                {ver ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            }
          />
          <div className="-mt-1 text-right">
            <button type="button" onClick={() => setAyuda(true)} className="text-sm font-semibold text-guinda">
              ¿Olvidaste tu contraseña?
            </button>
          </div>
          {error && <Aviso>{error}</Aviso>}
          <Boton type="submit" disabled={cargando || !usuario || !password} icono={cargando ? Loader2 : LogIn}>
            {cargando ? "Entrando…" : "Entrar al panel"}
          </Boton>
          <p className="text-center text-xs text-stone-500">¿Necesitas acceso? Solicítalo a la administración del sistema.</p>
        </form>
      </main>
      {ayuda && (
        <HojaModal titulo="Recuperar mi contraseña" alCerrar={() => setAyuda(false)}>
          <p className="text-sm text-stone-700">La contraseña de una cuenta administrativa la restablece otra persona con rol de administración:</p>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-stone-600">
            <li>Pídele a otra persona administradora que entre a <b>Usuarios</b> y toque <b>Restablecer contraseña</b> en tu cuenta.</li>
            <li>Te darán una contraseña <b>temporal</b>.</li>
            <li>Entra con ella: la aplicación te pedirá crear tu contraseña nueva.</li>
          </ol>
          <Boton onClick={() => setAyuda(false)}>Entendido</Boton>
        </HojaModal>
      )}
    </div>
  );
}
