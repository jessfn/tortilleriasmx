import { useCallback, useEffect, useState } from "react";
import { guardarSesion, leerSesion, type Sesion } from "./api";
import Inicio from "./Inicio";
import Login from "./Login";
import Registro from "./Registro";
import Captura from "./Captura";
import PanelUsuario from "./PanelUsuario";
import PanelAdmin from "./PanelAdmin";

type Vista = "inicio" | "login" | "registro" | "panel" | "captura";

export default function App() {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesion());
  // La bienvenida va primero; /acceso lleva directo al inicio de sesión
  const [vista, setVista] = useState<Vista>(location.pathname.startsWith("/acceso") ? "login" : "inicio");

  const salir = useCallback(() => {
    guardarSesion(null);
    setSesion(null);
    setVista("inicio");
  }, []);

  // Si el servidor dice que la sesión expiró o la cuenta se desactivó
  useEffect(() => {
    const expirada = () => {
      setSesion(null);
      setVista("login");
    };
    window.addEventListener("sesion-expirada", expirada);
    return () => window.removeEventListener("sesion-expirada", expirada);
  }, []);

  const entrar = (s: Sesion) => {
    setSesion(s);
    setVista("panel");
  };

  if (vista === "inicio")
    return (
      <Inicio
        sesion={sesion}
        alRegistrar={() => setVista("registro")}
        alIniciar={() => setVista("login")}
        alPanel={() => setVista("panel")}
        alCerrarSesion={salir}
      />
    );

  if (!sesion) {
    if (vista === "registro") return <Registro alEntrar={entrar} alVolver={() => setVista("inicio")} alIrALogin={() => setVista("login")} />;
    return <Login alEntrar={entrar} alVolver={() => setVista("inicio")} alIrARegistro={() => setVista("registro")} />;
  }

  if (vista === "captura") return <Captura alSalir={() => setVista("panel")} />;

  const actualizar = (s: Sesion) => setSesion(s);
  if (sesion.usuario.rol === "capturista")
    return <PanelUsuario sesion={sesion} alCapturar={() => setVista("captura")} alActualizarSesion={actualizar} alSalir={salir} />;
  return <PanelAdmin sesion={sesion} alActualizarSesion={actualizar} alSalir={salir} />;
}

/** Aviso discreto cuando hay una versión nueva de la app (se muestra sobre cualquier pantalla) */
export function AvisoVersion() {
  const [hay, setHay] = useState(false);
  useEffect(() => {
    const f = () => setHay(true);
    window.addEventListener("hay-version-nueva", f);
    return () => window.removeEventListener("hay-version-nueva", f);
  }, []);
  if (!hay) return null;
  return (
    <div className="fixed inset-x-0 bottom-[max(5.5rem,env(safe-area-inset-bottom))] z-[60] flex justify-center px-4">
      <div className="paso flex items-center gap-3 rounded-full bg-stone-900 py-2 pl-4 pr-2 text-sm text-white shadow-2xl">
        Hay una versión nueva
        <button
          onClick={() => (window as unknown as { __actualizarApp?: () => void }).__actualizarApp?.()}
          className="rounded-full bg-dorado px-3 py-1.5 font-semibold text-stone-900"
        >
          Actualizar
        </button>
      </div>
    </div>
  );
}
