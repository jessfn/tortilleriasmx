import { useState } from "react";
import { Loader2, LockKeyhole, LogIn, ShieldCheck, UserRound } from "lucide-react";
import { api, guardarSesion, type Sesion } from "./api";
import { Aviso, Boton, Campo } from "./ui";

/** Acceso solo para supervisores y administradores. La captura pública no pide sesión. */
export default function Login({ alEntrar }: { alEntrar: (s: Sesion) => void }) {
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
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col bg-gradient-to-b from-guinda-oscuro via-guinda to-guinda-oscuro">
      <div className="px-6 pb-10 pt-16 text-white">
        <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/15 backdrop-blur">
          <ShieldCheck className="h-8 w-8 text-dorado" aria-hidden />
        </span>
        <h1 className="mt-5 text-3xl font-bold">Acceso de supervisión</h1>
        <p className="mt-1 text-white/75">Solo para supervisores y administradores.</p>
      </div>
      <form onSubmit={entrar} className="paso flex flex-1 flex-col gap-4 rounded-t-[2rem] bg-stone-50 p-6">
        <Campo etiqueta="Usuario" icono={UserRound} value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        <Campo etiqueta="Contraseña" icono={LockKeyhole} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <Aviso>{error}</Aviso>}
        <div className="mt-auto pb-4">
          <Boton type="submit" disabled={cargando || !usuario || !password} icono={cargando ? Loader2 : LogIn}>
            {cargando ? "Entrando…" : "Entrar"}
          </Boton>
        </div>
      </form>
    </div>
  );
}
