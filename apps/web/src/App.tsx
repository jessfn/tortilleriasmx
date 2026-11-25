import CompletaDatos from "./CompletaDatos";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ES_ADMIN, guardarSesion, leerSesion, type Sesion } from "./api";
import { borrar, borrarTodo, CLAVES, guardar, leer } from "./persist";
import Inicio from "./Inicio";
import Login from "./Login";
import LoginAdmin from "./LoginAdmin";
import CambioPassword from "./CambioPassword";
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
  // El acceso administrativo no tiene bienvenida ni captura: solo su inicio de sesión y su panel
  if (ES_ADMIN) return sesion && guardada === "panel" ? "panel" : "login";
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
    return leer<Vista>(CLAVES.vista) === "captura" && (b?.caso === "actualizar" || b?.caso === "cuestionario") ? b.d?.tortilleria : undefined;
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

  // El estado de la cuenta (por autorizar, autorizado, rechazado) y los datos pendientes se piden al servidor al abrir: así una autorización llega sin volver a entrar.
  // Mientras la cuenta NO esté autorizada se vuelve a preguntar cada minuto, al regresar a la app y al recuperar la señal: en cuanto la autorizan, se desbloquea sola.
  const sesionRef = useRef(sesion);
  sesionRef.current = sesion;
  useEffect(() => {
    if (!sesion) return;
    let vigente = true;
    const revisar = () => {
      const actual = sesionRef.current;
      if (!actual || !navigator.onLine) return;
      api<Sesion["usuario"] & { creadoEn?: string }>("/auth/me")
        .then((me) => {
          if (!vigente) return;
          const cambio = me.estadoCuenta !== actual.usuario.estadoCuenta || me.datosCompletos !== actual.usuario.datosCompletos || me.estadoClave !== actual.usuario.estadoClave || me.rol !== actual.usuario.rol;
          if (!cambio) return;
          const s = { ...actual, usuario: { ...actual.usuario, ...me } };
          guardarSesion(s);
          setSesion(s);
          // recién autorizada: lo que estaba guardado en el teléfono sale de inmediato
          if (me.estadoCuenta === "autorizado" && actual.usuario.estadoCuenta !== "autorizado") window.dispatchEvent(new Event("sesion-iniciada"));
        })
        .catch(() => {});
    };
    revisar();
    const pendiente = (sesion.usuario.estadoCuenta ?? "autorizado") !== "autorizado";
    const t = pendiente ? window.setInterval(revisar, 60_000) : undefined;
    const alVolver = () => { if (!document.hidden) revisar(); };
    if (pendiente) {
      document.addEventListener("visibilitychange", alVolver);
      window.addEventListener("online", revisar);
    }
    return () => {
      vigente = false;
      if (t) window.clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", revisar);
    };
  }, [sesion?.usuario.id, sesion?.usuario.estadoCuenta]); // eslint-disable-line react-hooks/exhaustive-deps

  const entrar = (s: Sesion) => {
    setSesion(s);
    setVista("panel");
    window.dispatchEvent(new Event("sesion-iniciada")); // envía lo que quedó pendiente de este usuario
  };
  const alSesion = (s: Sesion) => {
    setSesion(s);
    window.dispatchEvent(new Event("sesion-iniciada")); // cuenta nueva creada al enviar la captura
  };

  // Una cuenta por autorizar o rechazada no inicia capturas (el servidor también lo impide)
  const puedeCapturar = !sesion || sesion.usuario.rol !== "capturista" || (sesion.usuario.estadoCuenta ?? "autorizado") === "autorizado";

  // Un registro nuevo siempre empieza limpio (descarta cualquier borrador anterior)
  const nuevoRegistro = () => {
    if (!puedeCapturar) return;
    borrar(CLAVES.borrador);
    setParaActualizar(undefined);
    setVista("captura");
  };

  // C21: abre la captura solo con el cuestionario (tortillerías ya censadas), sin pedir precio
  const [modoCaptura, setModoCaptura] = useState<"actualizar" | "cuestionario">(() => {
    const b = leer<{ caso?: string }>(CLAVES.borrador);
    return leer<Vista>(CLAVES.vista) === "captura" && b?.caso === "cuestionario" ? "cuestionario" : "actualizar";
  });
  const aplicarCuestionario = (t: Punto) => {
    if (!puedeCapturar) return;
    borrar(CLAVES.borrador);
    setModoCaptura("cuestionario");
    setParaActualizar(t);
    setVista("captura");
  };

  const actualizarPrecio = (t: Punto) => {
    if (!puedeCapturar) return;
    borrar(CLAVES.borrador);
    setModoCaptura("actualizar");
    setParaActualizar(t);
    setVista("captura");
  };

  // La captura se mantiene montada aunque la cuenta se cree a mitad del envío (así no se pierde el estado)
  const pantalla = (() => {
  // La administración restableció su contraseña: antes de usar la app debe crear una nueva
  if (sesion?.usuario.debeCambiarPassword) return <CambioPassword sesion={sesion} alListo={setSesion} alSalir={salir} />;
  if (vista === "captura")
    return (
      <Captura
        sesion={sesion}
        tortilleriaInicial={paraActualizar}
        modo={modoCaptura}
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

  if (!sesion) return ES_ADMIN ? <LoginAdmin alEntrar={entrar} /> : <Login alEntrar={entrar} alVolver={() => setVista("inicio")} alIrARegistro={nuevoRegistro} />;

  const actualizar = (s: Sesion) => setSesion(s);
  // Censadores que ya existían: antes de capturar completan sus datos (la bandeja sigue enviando lo que ya tenían)
  if (sesion.usuario.rol === "capturista" && sesion.usuario.datosCompletos === false) return <CompletaDatos sesion={sesion} alListo={actualizar} alSalir={salir} />;
  if (sesion.usuario.rol === "capturista")
    return <PanelUsuario sesion={sesion} alCapturar={nuevoRegistro} alActualizarPrecio={actualizarPrecio} alAplicarCuestionario={aplicarCuestionario} alActualizarSesion={actualizar} alSalir={salir} />;
  return <PanelAdmin sesion={sesion} alActualizarSesion={actualizar} alSalir={salir} />;
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
