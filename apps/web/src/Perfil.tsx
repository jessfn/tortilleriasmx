import { useState } from "react";
import { CalendarDays, KeyRound, Loader2, LogOut, Mail, Save, ShieldCheck, UserRound } from "lucide-react";
import { cambioPasswordSchema, normalizarTexto, perfilSchema, PASSWORD_MIN } from "@tortillerias/shared";
import { api, guardarSesion, leerSesion, type Sesion } from "./api";
import { Aviso, Boton, Campo, Tarjeta } from "./ui";

const ROLES: Record<string, string> = { capturista: "Usuario", supervisor: "Supervisor", admin: "Administrador" };

/** Pestaña de perfil: datos de la cuenta, cambio de contraseña y cierre de sesión (usuarios y personal) */
export default function Perfil({ sesion, alActualizar, alSalir }: { sesion: Sesion; alActualizar: (s: Sesion) => void; alSalir: () => void }) {
  const u = sesion.usuario;
  const [d, setD] = useState({ nombre: u.nombre, apellidos: u.apellidos });
  const [msg, setMsg] = useState<{ tipo: "ok" | "error"; texto: string }>();
  const [guardando, setGuardando] = useState(false);

  const [p, setP] = useState({ actual: "", nueva: "", confirmar: "" });
  const [msgP, setMsgP] = useState<{ tipo: "ok" | "error"; texto: string }>();
  const [cambiando, setCambiando] = useState(false);

  const okPerfil = perfilSchema.safeParse(d).success;
  const rp = cambioPasswordSchema.safeParse(p);
  const errP = (c: "nueva" | "confirmar") => (p[c] && !rp.success ? (rp.error.flatten().fieldErrors[c] as string[] | undefined)?.[0] : undefined);

  async function guardar() {
    setGuardando(true);
    setMsg(undefined);
    try {
      const r = await api<{ nombre: string; apellidos: string }>("/perfil", { metodo: "PATCH", json: d });
      const nueva: Sesion = { ...(leerSesion() ?? sesion), usuario: { ...u, ...r } };
      guardarSesion(nueva);
      alActualizar(nueva);
      setD(r);
      setMsg({ tipo: "ok", texto: "Perfil actualizado" });
    } catch (e: any) {
      setMsg({ tipo: "error", texto: e.message });
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarPassword() {
    setCambiando(true);
    setMsgP(undefined);
    try {
      await api("/perfil/password", { json: p });
      setP({ actual: "", nueva: "", confirmar: "" });
      setMsgP({ tipo: "ok", texto: "Contraseña actualizada" });
    } catch (e: any) {
      setMsgP({ tipo: "error", texto: e.message });
    } finally {
      setCambiando(false);
    }
  }

  const inicial = (u.nombre || u.correo || "?").trim().charAt(0).toUpperCase();

  return (
    <>
      <Tarjeta className="flex items-center gap-3">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-guinda to-guinda-oscuro text-2xl font-bold text-white">{inicial}</span>
        <div className="min-w-0">
          <p className="truncate font-bold">{[u.nombre, u.apellidos].filter(Boolean).join(" ") || "Sin nombre"}</p>
          <p className="flex items-center gap-1 truncate text-sm text-stone-500">
            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden /> {u.correo}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-verde">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> {ROLES[u.rol] ?? u.rol}
          </p>
        </div>
      </Tarjeta>

      <Tarjeta className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <UserRound className="h-4 w-4 text-guinda" aria-hidden /> Mis datos
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <Campo etiqueta="Nombre(s)" autoCapitalize="characters" autoComplete="given-name" value={d.nombre} onChange={(e) => setD({ ...d, nombre: normalizarTexto(e.target.value) })} />
          <Campo etiqueta="Apellidos" autoCapitalize="characters" autoComplete="family-name" value={d.apellidos} onChange={(e) => setD({ ...d, apellidos: normalizarTexto(e.target.value) })} />
        </div>
        {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
        <Boton onClick={guardar} disabled={!okPerfil || guardando} icono={guardando ? Loader2 : Save}>
          Guardar cambios
        </Boton>
      </Tarjeta>

      <Tarjeta className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <KeyRound className="h-4 w-4 text-guinda" aria-hidden /> Cambiar contraseña
        </h2>
        <Campo etiqueta="Contraseña actual" type="password" autoComplete="current-password" value={p.actual} onChange={(e) => setP({ ...p, actual: e.target.value })} />
        <Campo etiqueta="Nueva contraseña" type="password" autoComplete="new-password" value={p.nueva} onChange={(e) => setP({ ...p, nueva: e.target.value })} error={errP("nueva")} ayuda={`Mínimo ${PASSWORD_MIN} caracteres`} />
        <Campo etiqueta="Confirmar nueva contraseña" type="password" autoComplete="new-password" value={p.confirmar} onChange={(e) => setP({ ...p, confirmar: e.target.value })} error={errP("confirmar")} />
        {msgP && <Aviso tipo={msgP.tipo}>{msgP.texto}</Aviso>}
        <Boton variante="secundario" onClick={cambiarPassword} disabled={!rp.success || cambiando} icono={cambiando ? Loader2 : KeyRound}>
          Actualizar contraseña
        </Boton>
      </Tarjeta>

      <p className="flex items-center justify-center gap-1.5 text-xs text-stone-400">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden /> Sesión activa en este dispositivo
      </p>
      <Boton variante="peligro" onClick={alSalir} icono={LogOut}>
        Cerrar sesión
      </Boton>
    </>
  );
}
