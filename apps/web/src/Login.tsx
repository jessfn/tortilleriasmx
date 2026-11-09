import { useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, LogIn, Mail } from "lucide-react";
import { api, cuentaDeEsteAcceso, guardarSesion, type Sesion } from "./api";
import AuthLayout from "./AuthLayout";
import { Aviso, Boton, Campo } from "./ui";

/** Inicio de sesión de quienes registran tortillerías. El personal administrativo entra por /acceso (LoginAdmin). */
export default function Login({ alEntrar, alVolver, alIrARegistro }: { alEntrar: (s: Sesion) => void; alVolver: () => void; alIrARegistro: () => void }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    if (!usuario || !password) return;
    setError("");
    setCargando(true);
    try {
      const s = await api<Sesion>("/auth/login", { json: { usuario: usuario.trim(), password } });
      if (!cuentaDeEsteAcceso(s.usuario.rol)) {
        setError("Esta cuenta es del personal administrativo. Entra desde el acceso administrativo.");
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
    <AuthLayout
      titulo="Iniciar sesión"
      subtitulo="Entra a tu panel"
      icono={LogIn}
      alVolver={alVolver}
      pie={
        <div className="space-y-2">
          <Boton type="submit" form="form-login" disabled={cargando || !usuario || !password} icono={cargando ? Loader2 : LogIn}>
            {cargando ? "Entrando…" : "Entrar"}
          </Boton>
          <p className="text-center text-sm text-stone-600">
            ¿Aún no te has registrado?{" "}
            <button type="button" onClick={alIrARegistro} className="font-semibold text-guinda">
              Registrar mi tortillería
            </button>
          </p>
        </div>
      }
    >
      <form id="form-login" onSubmit={entrar} className="space-y-3">
        <Campo
          etiqueta="Correo electrónico"
          icono={Mail}
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          value={usuario}
          onChange={(e) => { setUsuario(e.target.value); setError(""); }}
          placeholder="Ej. tucorreo@ejemplo.com"
          ayuda="El correo con el que te registraste"
          valido={usuario.trim().length >= 3}
          enterKeyHint="next"
        />
        <Campo
          etiqueta="Contraseña"
          icono={KeyRound}
          type={ver ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(""); }}
          placeholder="Tu contraseña"
          enterKeyHint="go"
          derecha={
            <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"} className="grid h-10 w-10 place-items-center rounded-full text-stone-400 hover:text-stone-700">
              {ver ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          }
        />
        {error && <Aviso>{error}</Aviso>}
      </form>
    </AuthLayout>
  );
}
