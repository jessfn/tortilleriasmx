import { useCallback, useEffect, useState } from "react";
import { guardarSesion, leerSesion, type Sesion } from "./api";
import { borrar, borrarTodo, CLAVES, guardar, leer } from "./persist";
import Inicio from "./Inicio";
import Login from "./Login";
import Captura from "./Captura";
import type { Punto } from "./MapaTortillerias";
import PanelUsuario from "./PanelUsuario";
import PanelAdmin from "./PanelAdmin";
import { AvisoSinConexion, useEnLinea } from "./Conexion";
import { AvisoDescarga, useArranque } from "./Arranque";
import { borrarBandejaDe, contarPendientes } from "./bandeja";
import { borrarBorrador } from "./borrador";
import { kvBorrar } from "./bd";
import { Boton, HojaModal } from "./ui";

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
  // Caso C: actualizar el precio de una tortillería ya visitada (desde el panel)
  const [paraActualizar, setParaActualizar] = useState<Punto | undefined>(() => {
    // tras una recarga (p. ej. al actualizarse la app) se sigue donde se estaba
    const b = leer<{ caso?: string; d?: { tortilleria?: Punto } }>(CLAVES.borrador);
    return leer<Vista>(CLAVES.vista) === "captura" && b?.caso === "actualizar" ? b.d?.tortilleria : undefined;
  });

  useEffect(() => {
    guardar(CLAVES.vista, vista);
    document.documentElement.dataset.vista = vista;
  }, [vista]);

  const enLinea = useEnLinea();
  const mensajeDescarga = useArranque(sesion);
  // Cerrar sesión con capturas sin enviar: se pide confirmación (se borrarían del teléfono)
  const [saliendo, setSaliendo] = useState<number | null>(null);

  const cerrarSesion = useCallback(async () => {
    const uid = leerSesion()?.usuario.id;
    if (uid) await borrarBandejaDe(uid).catch(() => {}); // la bandeja lleva RFC y celular: no debe quedar en el teléfono
    await kvBorrar("misTortillerias");
    await borrarBorrador().catch(() => {});
    guardarSesion(null);
    borrarTodo(); // también borra cualquier borrador de captura con datos personales
    setSaliendo(null);
    setSesion(null);
    setVista("inicio");
    // El catálogo de estados NO se borra: no tiene datos personales y es pesado de volver a bajar
  }, []);

  const salir = useCallback(async () => {
    const uid = leerSesion()?.usuario.id;
    const n = uid ? await contarPendientes(uid).catch(() => 0) : 0;
    if (n > 0) return setSaliendo(n);
    await cerrarSesion();
  }, [cerrarSesion]);

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
    window.dispatchEvent(new Event("sesion-iniciada")); // envía lo que quedó pendiente de este usuario
  };
  const alSesion = (s: Sesion) => {
    setSesion(s);
    window.dispatchEvent(new Event("sesion-iniciada")); // cuenta nueva creada al enviar la captura
  };

  // Un registro nuevo siempre empieza limpio (descarta cualquier borrador anterior)
  const nuevoRegistro = () => {
    borrar(CLAVES.borrador);
    setParaActualizar(undefined);
    setVista("captura");
  };

  const actualizarPrecio = (t: Punto) => {
    borrar(CLAVES.borrador);
    setParaActualizar(t);
    setVista("captura");
  };

  // La captura se mantiene montada aunque la cuenta se cree a mitad del envío (así no se pierde el estado)
  const pantalla = (() => {
  if (vista === "captura")
    return (
      <Captura
        sesion={sesion}
        tortilleriaInicial={paraActualizar}
        alSesion={alSesion}
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
    return <PanelUsuario sesion={sesion} alCapturar={nuevoRegistro} alActualizarPrecio={actualizarPrecio} alActualizarSesion={actualizar} alSalir={salir} />;
  return <PanelAdmin sesion={sesion} alActualizarSesion={actualizar} alSalir={salir} alInicio={() => setVista("inicio")} />;
  })();

  return (
    <>
      {pantalla}
      <AvisoSinConexion />
      <AvisoDescarga mensaje={mensajeDescarga} />
      {saliendo !== null && (
        <HojaModal titulo="¿Cerrar sesión?" alCerrar={() => setSaliendo(null)}>
          <p className="text-sm text-stone-700">
            Tienes <b>{saliendo}</b> {saliendo === 1 ? "captura sin enviar" : "capturas sin enviar"}. Si cierras sesión se borrarán de este teléfono.
          </p>
          {!enLinea && <p className="text-sm font-semibold text-guinda">Conéctate a internet para enviarlas antes de salir.</p>}
          <Boton onClick={() => setSaliendo(null)}>Cancelar</Boton>
          <Boton variante="peligro" onClick={() => void cerrarSesion()}>
            Cerrar sesión y borrar
          </Boton>
        </HojaModal>
      )}
    </>
  );
}
