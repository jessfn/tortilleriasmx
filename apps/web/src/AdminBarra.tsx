import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bell, ChevronDown, Home, KeyRound, LogOut, UserRound } from "lucide-react";
import type { Sesion } from "./api";
import { Hoja, type PestañaNav } from "./ui";

const ROLES: Record<string, string> = { capturista: "Usuario", supervisor: "Supervisor", admin: "Administrador" };

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
        className="flex items-center gap-2.5 rounded-full bg-white/10 py-1 pl-1 pr-2.5 transition hover:bg-white/15 sm:pr-3"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-dorado text-xs font-bold text-guinda-oscuro">{iniciales(usuario)}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block max-w-[10rem] truncate text-xs font-semibold">{nombre}</span>
          <span className="block text-[10px] text-white/65">{ROLES[usuario.rol] ?? usuario.rol}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 transition ${abierto ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {abierto && (
        <div role="menu" className="paso absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl bg-white p-1.5 text-stone-900 shadow-2xl ring-1 ring-black/5">
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
  titulo, subtitulo, derecha, pestañas, activa, alCambiar, plano, usuario, pendientes = 0, alInicio, alSalir, children,
}: {
  titulo: string;
  subtitulo?: string;
  derecha?: ReactNode;
  pestañas: PestañaNav[];
  activa: string;
  alCambiar: (id: string) => void;
  /** La sección activa ocupa toda el área (mapa), sin márgenes ni scroll de página */
  plano?: boolean;
  usuario: Sesion["usuario"];
  /** Registros por revisar: se muestran en la campana, que lleva a "Revisión" */
  pendientes?: number;
  alInicio?: () => void;
  alSalir: () => void;
  children: ReactNode;
}) {
  const arriba = pestañas.filter((p) => p.id !== "perfil"); // el perfil vive en el menú de la cuenta

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-guinda-oscuro">
      <header className="relative shrink-0 bg-gradient-to-b from-[#4a0e27] to-guinda-oscuro text-white">
        <div className="mx-auto flex w-full max-w-[96rem] items-center gap-3 px-4 pb-8 pt-[max(.75rem,env(safe-area-inset-top))] lg:px-8 lg:pb-3.5 lg:pt-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-dorado">TortilleríasMX</p>
            <h1 className="truncate font-patria text-xl font-normal leading-tight lg:text-2xl">{titulo}</h1>
            {subtitulo && <p className="hidden truncate text-xs text-white/65 sm:block">{subtitulo}</p>}
          </div>
          {derecha}
          <button
            onClick={() => alCambiar("revision")}
            aria-label={pendientes ? `${pendientes} registros por revisar` : "Revisión de registros"}
            className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/10 transition hover:bg-white/15"
          >
            <Bell className="h-[18px] w-[18px]" aria-hidden />
            {pendientes > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-dorado px-1 text-[10px] font-bold text-guinda-oscuro ring-2 ring-guinda-oscuro">
                {pendientes > 99 ? "99+" : pendientes}
              </span>
            )}
          </button>
          <MenuCuenta usuario={usuario} alPerfil={() => alCambiar("perfil")} alInicio={alInicio} alSalir={alSalir} />
        </div>

        <nav className="hidden border-t border-white/10 bg-black/10 lg:block" aria-label="Secciones">
          <ul className="mx-auto flex w-full max-w-[96rem] gap-1 px-6">
            {arriba.map((p) => {
              const on = p.id === activa;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => alCambiar(p.id)}
                    aria-current={on ? "page" : undefined}
                    className={`relative flex items-center gap-2 px-4 py-3 text-sm font-semibold transition ${on ? "text-white" : "text-white/65 hover:text-white"}`}
                  >
                    <p.icono className="h-[18px] w-[18px]" aria-hidden />
                    {p.texto}
                    {!!p.insignia && <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-dorado px-1 text-[10px] font-bold text-guinda-oscuro">{p.insignia}</span>}
                    {on && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t-full bg-dorado" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <Hoja className="lg:mt-0 lg:rounded-none lg:shadow-none">
        <div key={activa} className={`paso min-h-0 flex-1 ${plano ? "relative overflow-hidden" : "overflow-y-auto overscroll-contain px-3 pb-3 pt-5 lg:px-8 lg:pb-8 lg:pt-8"}`}>
          <div className={plano ? "h-full w-full" : "mx-auto w-full max-w-[92rem] space-y-3"}>{children}</div>
        </div>
      </Hoja>

      <nav className="shrink-0 bg-stone-50 pb-[max(.125rem,calc(var(--sb)*.3))] shadow-[0_-10px_20px_-14px_rgba(0,0,0,.3)] lg:hidden" aria-label="Secciones">
        <ul className="mx-auto flex max-w-xl">
          {pestañas.map((p) => {
            const on = p.id === activa;
            return (
              <li key={p.id} className="flex-1">
                <button
                  onClick={() => alCambiar(p.id)}
                  aria-current={on ? "page" : undefined}
                  className={`relative flex w-full flex-col items-center py-1.5 text-[11px] font-semibold transition ${on ? "text-guinda" : "text-stone-400"}`}
                >
                  <span className={`grid h-8 w-14 place-items-center rounded-full transition-all ${on ? "bg-guinda/10" : ""}`}>
                    <p.icono className="h-5 w-5" aria-hidden />
                  </span>
                  {p.texto}
                  {!!p.insignia && <span className="absolute right-[calc(50%-1.6rem)] top-1 grid h-4 min-w-4 place-items-center rounded-full bg-guinda px-1 text-[10px] text-white">{p.insignia}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
