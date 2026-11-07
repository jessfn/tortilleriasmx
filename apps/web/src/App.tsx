import { useEffect, useState } from "react";
import { LayoutDashboard, LogOut } from "lucide-react";
import { guardarSesion, leerSesion, type Sesion } from "./api";
import Inicio from "./Inicio";
import Login from "./Login";
import Captura from "./Captura";
import { Boton } from "./ui";

type Vista = "inicio" | "captura" | "login";

export default function App() {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesion());
  // /acceso lleva directo al inicio de sesión; cualquier otra ruta empieza en la bienvenida
  const [vista, setVista] = useState<Vista>(location.pathname.startsWith("/acceso") ? "login" : "inicio");

  useEffect(() => {
    const salir = () => setSesion(null);
    window.addEventListener("sesion-expirada", salir);
    return () => window.removeEventListener("sesion-expirada", salir);
  }, []);

  if (vista === "inicio") return <Inicio alRegistrar={() => setVista("captura")} alIniciar={() => setVista("login")} />;
  if (vista === "captura") return <Captura alSalir={() => setVista("inicio")} />;

  if (!sesion) return <Login alEntrar={setSesion} alVolver={() => setVista("inicio")} />;

  return (
    <div className="mx-auto flex h-dvh max-w-xl flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="grid h-20 w-20 place-items-center rounded-3xl bg-guinda/10 text-guinda">
        <LayoutDashboard className="h-10 w-10" aria-hidden />
      </span>
      <h1 className="text-2xl font-bold">Hola, {sesion.usuario.nombre}</h1>
      <p className="text-stone-600">El panel de supervisión y el visor de estadísticas se están construyendo.</p>
      <div className="w-full max-w-xs space-y-2">
        <Boton
          variante="secundario"
          icono={LogOut}
          onClick={() => {
            guardarSesion(null);
            setSesion(null);
            setVista("inicio");
          }}
        >
          Cerrar sesión
        </Boton>
      </div>
    </div>
  );
}
