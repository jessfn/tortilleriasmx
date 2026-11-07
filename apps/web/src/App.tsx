import { useEffect, useState } from "react";
import { guardarSesion, leerSesion, type Sesion } from "./api";
import Login from "./Login";
import Captura from "./Captura";

export default function App() {
  const [sesion, setSesion] = useState<Sesion | null>(leerSesion());

  useEffect(() => {
    const salir = () => setSesion(null);
    window.addEventListener("sesion-expirada", salir);
    return () => window.removeEventListener("sesion-expirada", salir);
  }, []);

  if (!sesion) return <Login alEntrar={setSesion} />;
  return (
    <Captura
      usuario={sesion.usuario.nombre}
      salir={() => {
        guardarSesion(null);
        setSesion(null);
      }}
    />
  );
}
