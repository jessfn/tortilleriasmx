import { useState } from "react";
import { api, guardarSesion, type Sesion } from "./api";
import { Boton, Campo, Pantalla } from "./ui";

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
    <Pantalla titulo="Iniciar sesión">
      <form onSubmit={entrar} className="paso flex flex-1 flex-col gap-4 p-5">
        <p className="text-stone-600 dark:text-stone-300">Captura el precio de la tortilla en tu zona.</p>
        <Campo etiqueta="Usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" required />
        <Campo etiqueta="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
        <div className="mt-auto">
          <Boton type="submit" disabled={cargando || !usuario || !password}>{cargando ? "Entrando…" : "Entrar"}</Boton>
        </div>
      </form>
    </Pantalla>
  );
}
