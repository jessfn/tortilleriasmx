import { useState } from "react";
import { Eye, EyeOff, KeyRound, Loader2, Mail, UserPlus } from "lucide-react";
import { registroSchema, PASSWORD_MIN } from "@tortillerias/shared";
import { api, guardarSesion, type Sesion } from "./api";
import AuthLayout from "./AuthLayout";
import { Aviso, Boton, Campo } from "./ui";

export default function Registro({ alEntrar, alVolver, alIrALogin }: { alEntrar: (s: Sesion) => void; alVolver: () => void; alIrALogin: () => void }) {
  const [v, setV] = useState({ correo: "", password: "", confirmar: "" });
  const [ver, setVer] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const r = registroSchema.safeParse(v);
  const errores = r.success ? {} : r.error.flatten().fieldErrors;
  const falla = (campo: keyof typeof v) => (v[campo] ? (errores[campo] as string[] | undefined)?.[0] : undefined);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!r.success) return;
    setError("");
    setCargando(true);
    try {
      const s = await api<Sesion>("/auth/registro", { json: v });
      guardarSesion(s);
      alEntrar(s);
    } catch (err: any) {
      setError(err.status === 429 ? "Demasiados intentos. Inténtalo más tarde." : err.message);
    } finally {
      setCargando(false);
    }
  }

  const ojo = (
    <button type="button" onClick={() => setVer(!ver)} aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"} className="grid h-10 w-10 place-items-center rounded-full text-stone-400 hover:text-stone-700">
      {ver ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
    </button>
  );

  return (
    <AuthLayout
      titulo="Crear cuenta"
      subtitulo="Para registrar tortillerías y ver tus registros"
      icono={UserPlus}
      alVolver={alVolver}
      pie={
        <form onSubmit={crear} className="space-y-2">
          <Boton type="submit" disabled={!r.success || cargando} icono={cargando ? Loader2 : UserPlus}>
            {cargando ? "Creando cuenta…" : "Crear cuenta"}
          </Boton>
          <p className="text-center text-sm text-stone-600">
            ¿Ya tienes cuenta?{" "}
            <button type="button" onClick={alIrALogin} className="font-semibold text-guinda">
              Iniciar sesión
            </button>
          </p>
        </form>
      }
    >
      <form id="registro" onSubmit={crear} className="space-y-3">
        <Campo
          etiqueta="Correo electrónico"
          icono={Mail}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          value={v.correo}
          onChange={(e) => setV({ ...v, correo: e.target.value })}
          error={falla("correo")}
          placeholder="tucorreo@ejemplo.com"
        />
        <Campo
          etiqueta="Contraseña"
          icono={KeyRound}
          type={ver ? "text" : "password"}
          autoComplete="new-password"
          value={v.password}
          onChange={(e) => setV({ ...v, password: e.target.value })}
          error={falla("password")}
          ayuda={`Mínimo ${PASSWORD_MIN} caracteres`}
          derecha={ojo}
        />
        <Campo
          etiqueta="Confirmar contraseña"
          icono={KeyRound}
          type={ver ? "text" : "password"}
          autoComplete="new-password"
          value={v.confirmar}
          onChange={(e) => setV({ ...v, confirmar: e.target.value })}
          error={falla("confirmar")}
        />
        {error && <Aviso>{error}</Aviso>}
      </form>
    </AuthLayout>
  );
}
