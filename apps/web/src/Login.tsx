import { useState } from "react";
import { ChevronLeft, Loader2, LockKeyhole, LogIn, ShieldCheck, UserRound } from "lucide-react";
import { api, guardarSesion, type Sesion } from "./api";
import { Aviso, Boton, Campo } from "./ui";

/** Acceso solo para supervisores y administradores. La captura pública no pide sesión. */
export default function Login({ alEntrar, alVolver }: { alEntrar: (s: Sesion) => void; alVolver: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCargando(true);
    try {
      const s = await api<Sesion>("/auth/login", { json: { usuario: usuario.trim(), password } });
      guardarSesion(s);
      alEntrar(s);
    } catch (err: any) {
      setError(err.status === 429 ? "Demasiados intentos. Espera un minuto." : err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="mx-auto flex h-dvh max-w-xl flex-col overflow-hidden bg-gradient-to-b from-guinda-oscuro via-guinda to-guinda-oscuro">
      <div className="shrink-0 px-4 pb-8 pt-[max(.75rem,env(safe-area-inset-top))] text-white">
        <button onClick={alVolver} aria-label="Volver al inicio" className="-ml-1 grid h-9 w-9 place-items-center rounded-full hover:bg-white/10">
          <ChevronLeft className="h-6 w-6" />
        </button>
        <div className="mt-3 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15">
            <ShieldCheck className="h-6 w-6 text-dorado" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold leading-tight">Iniciar sesión</h1>
            <p className="text-xs text-white/70">Supervisores y administradores</p>
          </div>
        </div>
      </div>
      <form onSubmit={entrar} className="paso flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-t-3xl bg-stone-50 p-5">
        <Campo etiqueta="Usuario" icono={UserRound} value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        <Campo etiqueta="Contraseña" icono={LockKeyhole} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <Aviso>{error}</Aviso>}
        <div className="mt-auto pb-[max(.5rem,env(safe-area-inset-bottom))]">
          <Boton type="submit" disabled={cargando || !usuario || !password} icono={cargando ? Loader2 : LogIn}>
            {cargando ? "Entrando…" : "Entrar"}
          </Boton>
        </div>
      </form>
    </div>
  );
}
