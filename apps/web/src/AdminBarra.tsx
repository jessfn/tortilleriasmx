import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Bell, ChevronDown, Ellipsis, Home, KeyRound, LogOut, UserRound } from "lucide-react";
import type { Sesion } from "./api";
import { Hoja, type PestañaNav } from "./ui";

const ROLES: Record<string, string> = { capturista: "Usuario", supervisor: "Supervisor", admin: "Administrador", estatal: "Administrador estatal" };

const iniciales = (u: Sesion["usuario"]) => {
  const n = [u.nombre, u.apellidos].filter(Boolean).join(" ").trim() || u.correo || "?";
  const p = n.split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p.length > 1 ? (p[p.length - 1][0] ?? "") : "")).toUpperCase() || "?";
};

/** Chip de la cuenta con su menú: perfil, contraseña, inicio y cerrar sesión */
function MenuCuenta({ usuario, alPerfil, alInicio, alSalir }: { usuario: Sesion["usuario"]; alPerfil: () => void; alInicio?: () => void; alSalir: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const nombre = [usuario.nombre, usuario.apellidos].filter(Boolean).join(" ") || usuario.correo;

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent | TouchEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("touchstart", fuera);
    window.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("touchstart", fuera);
      window.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  const item = (icono: ReactNode, texto: string, accion: () => void, peligro = false) => (
    <button
      role="menuitem"
      onClick={() => {
        setAbierto(false);
        accion();
      }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition hover:bg-stone-100 ${peligro ? "text-red-600 hover:bg-red-50" : "text-stone-700"}`}
    >
      {icono}
      {texto}
    </button>
  );

  return (
    <div ref={caja} className="relative">
      <button
        onClick={() => setAbierto(!abierto)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-label="Menú de la cuenta"
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-white/10"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-dorado text-xs font-bold text-guinda-oscuro">{iniciales(usuario)}</span>
        <span className="hidden max-w-[9rem] truncate text-[13px] font-medium xl:block">{nombre}</span>
        <ChevronDown className={`h-3.5 w-3.5 text-white/60 transition ${abierto ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {(
        <div
          role="menu"
          aria-hidden={!abierto}
          className={`absolute right-0 top-full z-50 mt-2 w-64 origin-top-right rounded-2xl bg-white p-1.5 text-stone-900 shadow-2xl ring-1 ring-black/5 transition duration-200 ease-[cubic-bezier(.2,.9,.3,1.15)] ${
            abierto ? "visible translate-y-0 scale-100 opacity-100" : "invisible -translate-y-1.5 scale-95 opacity-0"
          }`}
        >
          <div className="mb-1 border-b border-stone-100 px-2.5 pb-2.5 pt-2">
            <p className="truncate text-sm font-bold">{nombre}</p>
            <p className="truncate text-xs text-stone-500">{usuario.correo}</p>
            <span className="mt-1.5 inline-block rounded-full bg-guinda/10 px-2 py-0.5 text-[11px] font-semibold text-guinda">{ROLES[usuario.rol] ?? usuario.rol}</span>
          </div>
          {item(<UserRound className="h-4 w-4 text-stone-400" aria-hidden />, "Mi perfil", alPerfil)}
          {item(<KeyRound className="h-4 w-4 text-stone-400" aria-hidden />, "Cambiar contraseña", alPerfil)}
          {alInicio && item(<Home className="h-4 w-4 text-stone-400" aria-hidden />, "Ir al inicio", alInicio)}
          <div className="mt-1 border-t border-stone-100 pt-1">{item(<LogOut className="h-4 w-4" aria-hidden />, "Cerrar sesión", alSalir, true)}</div>
        </div>
      )}
    </div>
  );
}

/**
 * Estructura del panel de administración y supervisión: barra superior con marca, estado en vivo, avisos y menú de la cuenta;
 * en computadora y tableta las secciones van como pestañas debajo de la barra, y en el teléfono como barra inferior.
 */
export default function AdminBarra({
  titulo, banda, pestañas, activa, alCambiar, plano, usuario, pendientes = 0, vivo, alInicio, alSalir, children,
}: {
  /** Una línea bajo la barra (solo en el teléfono): por ejemplo, los estados de un administrador estatal */
  banda?: string;
  /** Qué panel es (Administración o Supervisión) */
  titulo: string;
  pestañas: PestañaNav[];
  activa: string;
  alCambiar: (id: string) => void;
  /** La sección activa ocupa toda el área (mapa), sin márgenes ni scroll de página */
  plano?: boolean;
  usuario: Sesion["usuario"];
  /** Registros por revisar: se muestran en la campana, que lleva a "Revisión" */
  pendientes?: number;
  /** Estado de la actualización automática de datos */
  vivo?: { ultima?: number; fallo?: boolean };
  alInicio?: () => void;
  alSalir: () => void;
  children: ReactNode;
}) {
  const arriba = pestañas.filter((p) => p.id !== "perfil"); // el perfil vive en el menú de la cuenta

  // Con muchas secciones no caben en una fila sin encimarse: las primeras van en la barra y el resto en "Más" (la sección activa siempre se ve)
  const [ancho, setAncho] = useState(typeof window === "undefined" ? 1280 : window.innerWidth);
  useEffect(() => {
    const f = () => setAncho(window.innerWidth);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const maxVisibles = ancho >= 1800 ? 10 : ancho >= 1600 ? 9 : ancho >= 1440 ? 7 : ancho >= 1280 ? 5 : 4;
  let visibles = arriba.slice(0, maxVisibles);
  const iActiva = arriba.findIndex((p) => p.id === activa);
  if (iActiva >= maxVisibles && maxVisibles > 1) visibles = [...visibles.slice(0, maxVisibles - 1), arriba[iActiva]];
  const masItems = arriba.filter((p) => !visibles.some((v) => v.id === p.id));
  // Barra inferior (teléfono y tableta vertical): las que caben a 64 px mínimo, contando el botón "Más"
  const espacios = Math.max(4, Math.min(8, Math.floor(ancho / 64)));
  const [inferiorAbierta, setInferiorAbierta] = useState(false);
  const cabenTodas = pestañas.length <= espacios;
  const cupo = cabenTodas ? pestañas.length : espacios - 1;
  let inferiorVisibles = pestañas.slice(0, cupo);
  const iAct = pestañas.findIndex((p) => p.id === activa);
  if (!cabenTodas && iAct >= cupo) inferiorVisibles = [...inferiorVisibles.slice(0, cupo - 1), pestañas[iAct]];
  const inferiorMas = pestañas.filter((p) => !inferiorVisibles.some((v) => v.id === p.id));
  useEffect(() => setInferiorAbierta(false), [activa]);
  const [masAbierto, setMasAbierto] = useState(false);
  const masCaja = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!masAbierto) return;
    const fuera = (e: MouseEvent | TouchEvent) => { if (masCaja.current && !masCaja.current.contains(e.target as Node)) setMasAbierto(false); };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setMasAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("touchstart", fuera);
    window.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("touchstart", fuera); window.removeEventListener("keydown", tecla); };
  }, [masAbierto]);

  // La pastilla de la sección activa se desliza de una pestaña a otra
  const lista = useRef<HTMLUListElement>(null);
  const [pastilla, setPastilla] = useState<{ x: number; w: number }>();
  useLayoutEffect(() => {
    const medir = () => {
      const on = lista.current?.querySelector<HTMLElement>('[aria-current="page"]');
      setPastilla(on ? { x: on.offsetLeft, w: on.offsetWidth } : undefined);
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (lista.current) ro.observe(lista.current);
    return () => ro.disconnect();
  }, [activa, visibles.map((p) => p.id).join(","), pestañas.map((p) => p.insignia).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-guinda-oscuro">
      <header className="relative shrink-0 border-b border-white/10 bg-guinda-oscuro pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex h-14 w-full max-w-[96rem] items-center gap-2 px-3 lg:gap-6 lg:px-6">
          {/* Marca + a qué panel se entró */}
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-patria text-[1.35rem] font-normal leading-none">
              Tortillerías<span className="font-sans font-extrabold text-dorado">MX</span>
            </span>
            <span className="hidden border-l border-white/20 pl-2.5 text-xs font-medium text-white/60 sm:block">{titulo}</span>
          </div>

          {/* Secciones: una sola fila (en teléfono van abajo) */}
          <nav className="hidden min-w-0 flex-1 lg:block" aria-label="Secciones">
            <ul ref={lista} className="relative flex items-center gap-1">
              <li aria-hidden className={`pointer-events-none absolute left-0 top-0 h-full rounded-lg bg-white/12 ring-1 ring-white/10 transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(.34,1.3,.5,1)] ${pastilla ? "opacity-100" : "opacity-0"}`} style={{ width: pastilla?.w ?? 0, transform: `translateX(${pastilla?.x ?? 0}px)` }} />
              {visibles.map((p) => {
                const on = p.id === activa;
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => alCambiar(p.id)}
                      aria-current={on ? "page" : undefined}
                      className={`relative z-10 flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-200 ${on ? "text-white" : "text-white/60 hover:bg-white/6 hover:text-white"}`}
                    >
                      <p.icono className="h-4 w-4" aria-hidden />
                      {p.texto}
                      {!!p.insignia && <span className="rounded-full bg-dorado px-1.5 text-[10px] font-bold leading-4 text-guinda-oscuro">{p.insignia}</span>}
                    </button>
                  </li>
                );
              })}
              {masItems.length > 0 && (
                <li ref={masCaja} className="relative">
                  <button onClick={() => setMasAbierto((v) => !v)} aria-expanded={masAbierto} aria-haspopup="menu" className="relative z-10 flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-medium text-white/60 transition-colors hover:bg-white/6 hover:text-white">
                    <Ellipsis className="h-4 w-4" aria-hidden /> Más
                    {masItems.some((p) => p.insignia) && <span className="h-1.5 w-1.5 rounded-full bg-dorado" aria-hidden />}
                  </button>
                  {masAbierto && (
                    <ul role="menu" className="absolute left-0 top-full z-50 mt-2 min-w-[13rem] overflow-hidden rounded-2xl bg-white p-1.5 text-stone-800 shadow-2xl ring-1 ring-black/10">
                      {masItems.map((p) => (
                        <li key={p.id} role="none">
                          <button role="menuitem" onClick={() => { setMasAbierto(false); alCambiar(p.id); }} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-stone-100">
                            <p.icono className="h-4 w-4 text-guinda" aria-hidden />
                            <span className="flex-1">{p.texto}</span>
                            {!!p.insignia && <span className="rounded-full bg-dorado px-1.5 text-[10px] font-bold leading-4 text-guinda-oscuro">{p.insignia}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )}
            </ul>
          </nav>
          <div className="flex-1 lg:hidden" />

          {/* Estado, avisos y cuenta */}
          {vivo && (
            <span className="hidden items-center gap-1.5 text-xs text-white/55 2xl:flex" title="Los datos se actualizan solos">
              <span className={`h-1.5 w-1.5 rounded-full ${vivo.fallo ? "bg-red-400" : vivo.ultima ? "bg-emerald-400" : "bg-white/40"}`} />
              {vivo.fallo ? "Sin conexión" : "En vivo"}
            </span>
          )}
          <button
            onClick={() => alCambiar("revision")}
            aria-label={pendientes ? `${pendientes} registros por revisar` : "Revisión de registros"}
            className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <Bell className="h-[18px] w-[18px]" aria-hidden />
            {pendientes > 0 && (
              <span className="absolute right-1 top-1 h-2 w-2" aria-hidden>
                <span className="absolute inset-0 animate-ping rounded-full bg-dorado/70" />
                <span className="absolute inset-0 rounded-full bg-dorado ring-2 ring-guinda-oscuro" />
              </span>
            )}
          </button>
          <MenuCuenta usuario={usuario} alPerfil={() => alCambiar("perfil")} alInicio={alInicio} alSalir={alSalir} />
        </div>
      </header>

      {banda && <div className="shrink-0 truncate bg-guinda px-3 py-1.5 text-center text-xs font-medium text-white/90 sm:hidden">{banda}</div>}

      <Hoja className="!mt-0 !rounded-none !shadow-none">
        <div key={activa} className={`paso min-h-0 flex-1 ${plano ? "relative overflow-hidden" : "overflow-y-auto overscroll-contain px-3 pb-3 pt-4 lg:px-6 lg:pb-5 lg:pt-4"}`}>
          <div className={plano ? "h-full w-full" : "mx-auto w-full max-w-[92rem] space-y-2.5"}>{children}</div>
        </div>
      </Hoja>

      {/* Barra inferior: cuantas pestañas caben según el ancho (mín. 64 px cada una); el resto va en "Más". La sección activa siempre se ve. */}
      {inferiorAbierta && <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] lg:hidden" onClick={() => setInferiorAbierta(false)} aria-hidden />}
      {inferiorAbierta && (
        <div role="menu" className="paso fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-stone-50 px-3 pb-[max(1rem,calc(var(--sb)*.5))] pt-2 shadow-2xl lg:hidden">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-stone-300" aria-hidden />
          <ul className="mx-auto grid max-w-xl grid-cols-3 gap-2 sm:grid-cols-4">
            {inferiorMas.map((p) => (
              <li key={p.id} role="none">
                <button role="menuitem" onClick={() => { setInferiorAbierta(false); alCambiar(p.id); }} className="relative flex w-full flex-col items-center gap-1 rounded-2xl bg-white px-1 py-3 text-center text-[12px] font-semibold leading-tight text-stone-700 shadow-sm ring-1 ring-stone-200 transition active:scale-95">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-guinda/10 text-guinda"><p.icono className="h-5 w-5" aria-hidden /></span>
                  {p.texto}
                  {!!p.insignia && <span className="absolute right-2 top-2 grid h-4 min-w-4 place-items-center rounded-full bg-guinda px-1 text-[10px] text-white">{p.insignia}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <nav className="relative z-40 shrink-0 bg-stone-50 pb-[max(.125rem,calc(var(--sb)*.3))] shadow-[0_-10px_20px_-14px_rgba(0,0,0,.3)] lg:hidden" aria-label="Secciones">
        <ul className="mx-auto flex max-w-3xl">
          {inferiorVisibles.map((p) => {
            const on = p.id === activa;
            return (
              <li key={p.id} className="min-w-0 flex-1">
                <button
                  onClick={() => alCambiar(p.id)}
                  aria-current={on ? "page" : undefined}
                  className={`relative flex w-full flex-col items-center py-1.5 text-[11px] font-semibold transition ${on ? "text-guinda" : "text-stone-400"}`}
                >
                  <span className={`grid h-8 w-12 place-items-center rounded-full transition-all ${on ? "bg-guinda/10" : ""}`}>
                    <p.icono className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="w-full truncate px-0.5 text-center">{p.texto}</span>
                  {!!p.insignia && <span className="absolute right-[calc(50%-1.5rem)] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-guinda px-1 text-[10px] text-white">{p.insignia}</span>}
                </button>
              </li>
            );
          })}
          {inferiorMas.length > 0 && (
            <li className="min-w-0 flex-1">
              <button onClick={() => setInferiorAbierta((v) => !v)} aria-expanded={inferiorAbierta} aria-haspopup="menu" className={`relative flex w-full flex-col items-center py-1.5 text-[11px] font-semibold transition ${inferiorAbierta ? "text-guinda" : "text-stone-400"}`}>
                <span className={`grid h-8 w-12 place-items-center rounded-full transition-all ${inferiorAbierta ? "bg-guinda/10" : ""}`}><Ellipsis className="h-5 w-5" aria-hidden /></span>
                Más
                {inferiorMas.some((p) => p.insignia) && <span className="absolute right-[calc(50%-1rem)] top-1.5 h-2 w-2 rounded-full bg-guinda" aria-hidden />}
              </button>
            </li>
          )}
        </ul>
      </nav>
    </div>
  );
}
