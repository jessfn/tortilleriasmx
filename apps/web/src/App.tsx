import { useEffect, useState } from "react";
import { LayoutDashboard, LogOut } from "lucide-react";
import { guardarSesion, leerSesion, type Sesion } from "./api";
import Login from "./Login";
import Captura from "./Captura";
import { Boton } from "./ui";

export default function App() {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesion());

  useEffect(() => {
    const salir = () => setSesion(null);
    window.addEventListener("sesion-expirada", salir);
    return () => window.removeEventListener("sesion-expirada", salir);
  }, []);

  // La captura es pública. Solo /acceso (supervisores y administradores) pide sesión.
  if (!location.pathname.startsWith("/acceso")) return <Captura />;

  if (!sesion) return <Login alEntrar={setSesion} />;

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-5 p-8 text-center">
      <span className="grid h-20 w-20 place-items-center rounded-3xl bg-guinda/10 text-guinda">
        <LayoutDashboard className="h-10 w-10" aria-hidden />
      </span>
      <h1 className="text-2xl font-bold">Hola, {sesion.usuario.nombre}</h1>
      <p className="text-stone-600">El panel de supervisión y el visor de estadísticas se están construyendo.</p>
      <div className="w-full max-w-xs">
        <Boton
          variante="secundario"
          icono={LogOut}
          onClick={() => {
            guardarSesion(null);
            setSesion(null);
          }}
        >
          Cerrar sesión
        </Boton>
      </div>
    </div>
  );
}
