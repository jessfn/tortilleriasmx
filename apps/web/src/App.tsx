import { useCallback, useEffect, useState } from "react";
import { guardarSesion, leerSesion, type Sesion } from "./api";
import { borrar, borrarTodo, CLAVES, guardar, leer } from "./persist";
import Inicio from "./Inicio";
import Login from "./Login";
import Captura from "./Captura";
import PanelUsuario from "./PanelUsuario";
import PanelAdmin from "./PanelAdmin";

type Vista = "inicio" | "login" | "panel" | "captura";

function vistaInicial(sesion: Sesion | null): Vista {
  // Tras una recarga (p. ej. al actualizarse la app) se vuelve a la pantalla donde se estaba
  const guardada = leer<Vista>(CLAVES.vista);
  if (guardada === "captura") return "captura"; // el registro a medias se restaura (con o sin cuenta)
  if (sesion && guardada === "panel") return "panel";
  // La bienvenida va primero; /acceso lleva directo al inicio de sesión
  return location.pathname.startsWith("/acceso") ? "login" : "inicio";
}

export default function App() {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesion());
  const [vista, setVista] = useState<Vista>(() => vistaInicial(leerSesion()));

  useEffect(() => {
    guardar(CLAVES.vista, vista);
  }, [vista]);

  const salir = useCallback(() => {
    guardarSesion(null);
    borrarTodo(); // también borra cualquier borrador de captura con datos personales
    setSesion(null);
    setVista("inicio");
  }, []);

  // Si el servidor dice que la sesión expiró o la cuenta se desactivó
  useEffect(() => {
    const expirada = () => {
      borrarTodo();
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

  // Un registro nuevo siempre empieza limpio (descarta cualquier borrador anterior)
  const nuevoRegistro = () => {
    borrar(CLAVES.borrador);
    setVista("captura");
  };

  // La captura se mantiene montada aunque la cuenta se cree a mitad del envío (así no se pierde el estado)
  if (vista === "captura")
    return (
      <Captura
        sesion={sesion}
        alSesion={setSesion}
        alSalir={() => {
          borrar(CLAVES.borrador);
          setVista(sesion ? "panel" : "inicio");
        }}
        alTerminar={() => setVista("panel")}
      />
    );

  if (vista === "inicio")
    return (
      <Inicio
        sesion={sesion}
        alRegistrar={nuevoRegistro}
        alIniciar={() => setVista("login")}
        alPanel={() => setVista("panel")}
        alCerrarSesion={salir}
      />
    );

  if (!sesion) return <Login alEntrar={entrar} alVolver={() => setVista("inicio")} alIrARegistro={nuevoRegistro} />;

  const actualizar = (s: Sesion) => setSesion(s);
  if (sesion.usuario.rol === "capturista")
    return <PanelUsuario sesion={sesion} alCapturar={nuevoRegistro} alActualizarSesion={actualizar} alSalir={salir} />;
  return <PanelAdmin sesion={sesion} alActualizarSesion={actualizar} alSalir={salir} />;
}
