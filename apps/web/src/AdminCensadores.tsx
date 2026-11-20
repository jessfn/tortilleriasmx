import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Check, Copy, Eye, Fingerprint, KeyRound, Landmark, Loader2, Mail, MapPin, Power, Search, ShieldX, UserCheck, UserPlus, Users, X } from "lucide-react";
import { censadorNuevoSchema, curpSchema } from "@tortillerias/shared";
import { api } from "./api";
import { Aviso, Boton, Campo, HojaModal, Selector, Tarjeta, Vacio } from "./ui";
import { Paginacion, type Pagina } from "./Paginacion";
import { SelectorFiltro } from "./Filtros";

type Censador = {
  id: string; correo: string | null; nombre: string; apellidos: string; activo: boolean; creado_en: string; estado_cuenta: "por_autorizar" | "autorizado" | "rechazado";
  registro_abierto: boolean; datos_completos: boolean; estado_clave: string | null; estado_sugerido: boolean; estado: string | null; curp: string;
  capturas: number; ultima_captura: string | null; capturas_7d: number; debe_cambiar_password: boolean;
};
type Conteo = { por_autorizar: number; registro_abierto: number; autorizados: number; rechazados: number; desactivados: number };
type Estado = { clave: string; nombre: string };
type Pestana = "solicitudes" | "abierto" | "autorizados" | "rechazados" | "desactivados";

const PESTANAS: { id: Pestana; texto: string; conteo: keyof Conteo; filtro: string }[] = [
  { id: "solicitudes", texto: "Solicitudes", conteo: "por_autorizar", filtro: "cuenta=por_autorizar&activo=1" },
  { id: "abierto", texto: "Registro abierto", conteo: "registro_abierto", filtro: "cuenta=autorizado&registro_abierto=1&activo=1" },
  { id: "autorizados", texto: "Autorizados", conteo: "autorizados", filtro: "cuenta=autorizado&activo=1" },
  { id: "rechazados", texto: "Rechazados", conteo: "rechazados", filtro: "cuenta=rechazado" },
  { id: "desactivados", texto: "Desactivados", conteo: "desactivados", filtro: "activo=0" },
];
const AYUDA: Record<Pestana, string> = {
  solicitudes: "Se registraron después de la fecha de corte y esperan tu autorización. Hasta entonces no pueden capturar.",
  abierto: "Se registraron antes del corte (registro abierto) o ya existían. Confirma a quien sí es personal de la Secretaría; rechaza a quien no.",
  autorizados: "Trabajan con normalidad.",
  rechazados: "No es personal de la Secretaría: no pueden capturar y sus capturas no cuentan. Si se autoriza de nuevo, sus capturas regresan solas.",
  desactivados: "Ya no participan: no pueden entrar, pero sus capturas anteriores siguen contando.",
};
const dia = (s: string) => new Date(s).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

/**
 * Usuarios de la app (censadores) por estado: solicitudes, registro abierto, autorizados, rechazados y desactivados.
 * El administrador estatal solo ve (y solo puede tocar) a los de sus estados; el servidor lo exige en cada petición.
 * RECHAZAR ("no es personal de la Secretaría": sus capturas dejan de contar) no es lo mismo que DESACTIVAR ("ya no participa": sus capturas siguen contando).
 */
export default function AdminCensadores({ esAdmin, titulo = "Usuarios de la app", estadosPermitidos }: { esAdmin: boolean; titulo?: string; estadosPermitidos?: string[] | null }) {
  const [tab, setTab] = useState<Pestana>("solicitudes");
  const [conteo, setConteo] = useState<Conteo>();
  const [pag, setPag] = useState<Pagina<Censador>>();
  const [estados, setEstados] = useState<Estado[]>([]);
  const [estadoFiltro, setEstadoFiltro] = useState("");
  const [q, setQ] = useState("");
  const [qEnviada, setQEnviada] = useState("");
  const [pagina, setPagina] = useState(1);
  const [limite, setLimite] = useState(50);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<{ id: string; accion: "rechazar" | "desactivar" | "restablecer" } | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [clave, setClave] = useState<{ titulo: string; correo: string; password: string } | null>(null);
  const [curpVista, setCurpVista] = useState<Record<string, string>>({});
  const zona = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Estado[]>("/estados")
      .then((e) => setEstados(estadosPermitidos ? e.filter((x) => estadosPermitidos.includes(x.clave)) : e))
      .catch(() => {});
  }, [estadosPermitidos?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = window.setTimeout(() => { setQEnviada(q.trim()); setPagina(1); }, 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    api<Conteo>("/admin/usuarios/conteo").then(setConteo).catch(() => {});
  }, [version]);

  useEffect(() => {
    let vigente = true;
    const f = PESTANAS.find((p) => p.id === tab)!;
    const p = new URLSearchParams(`tipo=app&${f.filtro}&pagina=${pagina}&limite=${limite}&orden=recientes`);
    if (qEnviada) p.set("q", qEnviada);
    if (estadoFiltro) p.set("estado", estadoFiltro);
    api<Pagina<Censador>>(`/admin/usuarios?${p}`)
      .then((r) => {
        if (!vigente) return;
        if (!r.filas.length && pagina > 1) return setPagina(Math.max(1, r.paginas));
        setPag(r);
        setError("");
        zona.current?.scrollTo({ top: 0 });
      })
      .catch((e) => vigente && setError(e.message));
    return () => { vigente = false; };
  }, [tab, pagina, limite, qEnviada, estadoFiltro, version]);

  const cambiar = (t: Pestana) => { setTab(t); setPagina(1); setPag(undefined); setConfirmar(null); };
  const refrescar = useCallback(() => setVersion((v) => v + 1), []);

  async function patch(c: Censador, cuerpo: object) {
    setTrabajando(c.id);
    setError("");
    try {
      await api(`/admin/usuarios/${c.id}`, { metodo: "PATCH", json: cuerpo });
      setConfirmar(null);
      refrescar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(null);
    }
  }
  async function restablecer(c: Censador) {
    setTrabajando(c.id);
    setError("");
    try {
      const r = await api<{ password: string }>(`/admin/usuarios/${c.id}/restablecer-password`, { json: {} });
      setConfirmar(null);
      setClave({ titulo: "Contraseña temporal", correo: c.correo ?? "", password: r.password });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(null);
    }
  }
  async function verCurp(c: Censador) {
    try {
      const r = await api<{ curp: string | null }>(`/admin/usuarios/${c.id}/curp`);
      setCurpVista((v) => ({ ...v, [c.id]: r.curp ?? "Sin CURP" }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2.5 overflow-hidden px-3 pb-3 pt-4 lg:px-6 lg:pb-5">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-guinda/10 text-guinda"><Users className="h-[18px] w-[18px]" aria-hidden /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="text-base font-bold">{titulo}</h2>
          <p className="text-xs text-stone-500">Censadores de tu estado: autoriza, rechaza, activa o restablece su contraseña.</p>
        </div>
        <Boton className="!w-auto !min-h-10 px-4 !text-sm" icono={UserPlus} onClick={() => setNuevo(true)}>Nuevo censador</Boton>
      </div>

      <div role="tablist" aria-label="Estado de las cuentas" className="flex shrink-0 gap-1 overflow-x-auto rounded-2xl bg-stone-200/70 p-1">
        {PESTANAS.map((p) => {
          const on = tab === p.id;
          const n = conteo?.[p.conteo];
          return (
            <button key={p.id} role="tab" aria-selected={on} onClick={() => cambiar(p.id)} className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition ${on ? "bg-white text-guinda shadow" : "text-stone-500 hover:text-stone-700"}`}>
              {p.texto}
              {n !== undefined && <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold ${on ? "bg-guinda text-white" : p.id === "solicitudes" && n > 0 ? "bg-amber-500 text-white" : "bg-stone-300/70 text-stone-600"}`}>{n}</span>}
            </button>
          );
        })}
      </div>
      <p className="shrink-0 px-1 text-xs text-stone-500">{AYUDA[tab]}</p>

      <div className="grid shrink-0 gap-2 sm:grid-cols-[1fr_16rem]">
        <label className="relative block min-w-0">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-stone-400" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre, correo o CURP completa" aria-label="Buscar censadores" className="h-11 w-full rounded-xl border border-stone-200 bg-white pl-10 pr-3 text-base shadow-sm outline-none focus:border-guinda focus:ring-4 focus:ring-guinda/10" />
        </label>
        {estados.length > 1 && (
          <SelectorFiltro icono={Landmark} etiqueta="Estado" valor={estadoFiltro} activo={!!estadoFiltro} alCambiar={(v) => { setEstadoFiltro(v); setPagina(1); }} opciones={[{ valor: "", texto: "Todos mis estados" }, ...estados.map((e) => ({ valor: e.clave, texto: e.nombre }))]} />
        )}
      </div>
      {error && <Aviso>{error}</Aviso>}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200" aria-label="Censadores">
        <div ref={zona} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {!pag ? (
            <div className="grid place-items-center py-16 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : pag.filas.length === 0 ? (
            <Vacio icono={Users} titulo="Nadie por aquí" texto={qEnviada ? "No hay resultados con esa búsqueda." : "No hay cuentas en esta pestaña."} />
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2 2xl:grid-cols-3">
              {pag.filas.map((c) => {
                const ocupado = trabajando === c.id;
                const conf = confirmar?.id === c.id ? confirmar.accion : null;
                return (
                  <li key={c.id}>
                    <Tarjeta className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-semibold leading-tight">{`${c.nombre} ${c.apellidos}`.trim() || "Sin nombre"}</p>
                          <p className="flex items-center gap-1 truncate text-xs text-stone-500"><Mail className="h-3 w-3 shrink-0" aria-hidden /> {c.correo}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1">
                          {!c.datos_completos && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">Datos incompletos</span>}
                          {c.estado_cuenta === "rechazado" && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700 ring-1 ring-red-200">Rechazado</span>}
                          {!c.activo && <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-600 ring-1 ring-stone-200">Desactivado</span>}
                          {c.debe_cambiar_password && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200">Contraseña temporal</span>}
                        </div>
                      </div>
                      <ul className="space-y-1 text-xs text-stone-500">
                        <li className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 shrink-0 text-guinda" aria-hidden /> {c.estado ?? "Sin estado"}{c.estado_sugerido ? " (sugerido por sus capturas)" : ""}</li>
                        <li className="flex items-center gap-1.5"><Fingerprint className="h-3.5 w-3.5 shrink-0 text-guinda" aria-hidden /> {curpVista[c.id] ?? (c.curp || "Sin CURP")}</li>
                        <li>Se registró el {dia(c.creado_en)} · {c.capturas} {c.capturas === 1 ? "captura" : "capturas"}{c.ultima_captura ? ` · última el ${c.ultima_captura}` : ""}</li>
                      </ul>
                      {esAdmin && c.curp && !curpVista[c.id] && (
                        <button onClick={() => verCurp(c)} className="inline-flex items-center gap-1 text-xs font-semibold text-guinda"><Eye className="h-3.5 w-3.5" aria-hidden /> Ver la CURP completa (queda en la bitácora)</button>
                      )}
                      {estados.length > 1 && c.estado_cuenta !== "rechazado" && (
                        <Selector etiqueta="Estado del censador" icono={Landmark} value={c.estado_clave ?? ""} disabled={ocupado} onChange={(e) => e.target.value && patch(c, { estadoClave: e.target.value })} placeholder="Sin estado" opciones={estados.map((e) => ({ valor: e.clave, texto: e.nombre }))} />
                      )}

                      {conf ? (
                        <div className={`space-y-2 rounded-xl p-2.5 ring-1 ${conf === "restablecer" ? "bg-amber-50 ring-amber-200" : "bg-red-50 ring-red-200"}`}>
                          <p className={`text-xs font-semibold ${conf === "restablecer" ? "text-amber-900" : "text-red-800"}`}>
                            {conf === "rechazar" && "¿Rechazar esta cuenta? Quiere decir que no es personal de la Secretaría: no podrá capturar y sus capturas dejarán de contar (no se borran; si la autorizas de nuevo, regresan)."}
                            {conf === "desactivar" && "¿Desactivar esta cuenta? Quiere decir que ya no participa: no podrá entrar, pero sus capturas anteriores siguen contando."}
                            {conf === "restablecer" && "¿Restablecer la contraseña? La actual dejará de servir y se generará una temporal que verás una sola vez."}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <Boton variante="secundario" className="!min-h-10 !text-sm" onClick={() => setConfirmar(null)} disabled={ocupado}>Cancelar</Boton>
                            <Boton
                              variante={conf === "restablecer" ? "primario" : "peligro"} className="!min-h-10 !text-sm" disabled={ocupado} icono={ocupado ? Loader2 : conf === "rechazar" ? ShieldX : conf === "desactivar" ? Power : KeyRound}
                              onClick={() => (conf === "rechazar" ? patch(c, { accion: "rechazar" }) : conf === "desactivar" ? patch(c, { activo: false }) : restablecer(c))}
                            >
                              {conf === "rechazar" ? "Sí, rechazar" : conf === "desactivar" ? "Sí, desactivar" : "Sí, restablecer"}
                            </Boton>
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-flow-col auto-cols-fr gap-2">
                          {tab === "solicitudes" && (
                            <>
                              <Boton className="!min-h-10 !text-sm" icono={ocupado ? Loader2 : UserCheck} disabled={ocupado} onClick={() => patch(c, { accion: "autorizar" })}>Autorizar</Boton>
                              <Boton variante="peligro" className="!min-h-10 !text-sm" icono={ShieldX} disabled={ocupado} onClick={() => setConfirmar({ id: c.id, accion: "rechazar" })}>Rechazar</Boton>
                            </>
                          )}
                          {tab === "abierto" && (
                            <>
                              <Boton className="!min-h-10 !text-sm" icono={ocupado ? Loader2 : Check} disabled={ocupado} onClick={() => patch(c, { accion: "confirmar" })}>Confirmar</Boton>
                              <Boton variante="peligro" className="!min-h-10 !text-sm" icono={ShieldX} disabled={ocupado} onClick={() => setConfirmar({ id: c.id, accion: "rechazar" })}>Rechazar</Boton>
                            </>
                          )}
                          {tab === "autorizados" && (
                            <>
                              <Boton variante="secundario" className="!min-h-10 !text-sm" icono={KeyRound} disabled={ocupado} onClick={() => setConfirmar({ id: c.id, accion: "restablecer" })}>Contraseña</Boton>
                              <Boton variante="secundario" className="!min-h-10 !text-sm" icono={Power} disabled={ocupado} onClick={() => setConfirmar({ id: c.id, accion: "desactivar" })}>Desactivar</Boton>
                              <Boton variante="peligro" className="!min-h-10 !text-sm" icono={X} disabled={ocupado} onClick={() => setConfirmar({ id: c.id, accion: "rechazar" })}>Rechazar</Boton>
                            </>
                          )}
                          {tab === "rechazados" && <Boton className="!min-h-10 !text-sm" icono={ocupado ? Loader2 : UserCheck} disabled={ocupado} onClick={() => patch(c, { accion: "autorizar" })}>Autorizar de nuevo</Boton>}
                          {tab === "desactivados" && <Boton className="!min-h-10 !text-sm" icono={ocupado ? Loader2 : Power} disabled={ocupado} onClick={() => patch(c, { activo: true })}>Activar</Boton>}
                        </div>
                      )}
                    </Tarjeta>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {pag && <Paginacion total={pag.total} pagina={pag.pagina} paginas={pag.paginas} limite={pag.limite} alPagina={setPagina} alLimite={(n) => { setLimite(n); setPagina(1); }} />}
      </section>

      {nuevo && <FormularioCensador estados={estados} alCerrar={() => setNuevo(false)} alCreado={(c) => { setNuevo(false); setClave({ titulo: "Censador creado", correo: c.correo, password: c.password }); refrescar(); }} />}
      {clave && <HojaClave datos={clave} alCerrar={() => setClave(null)} />}
    </div>
  );
}

/** La contraseña temporal se muestra UNA sola vez, con botón para copiarla */
function HojaClave({ datos, alCerrar }: { datos: { titulo: string; correo: string; password: string }; alCerrar: () => void }) {
  const [copiada, setCopiada] = useState(false);
  return (
    <HojaModal titulo={datos.titulo} alCerrar={alCerrar}>
      <p className="text-sm text-stone-600">Entrega esta contraseña a <b>{datos.correo}</b>. <b>Solo se muestra ahora</b>: al entrar deberá cambiarla.</p>
      <div className="flex items-center gap-2 rounded-2xl bg-stone-100 p-3">
        <code className="min-w-0 flex-1 select-all break-all text-center text-2xl font-bold tracking-wider text-guinda">{datos.password}</code>
        <button
          onClick={() => { void navigator.clipboard?.writeText(datos.password).then(() => setCopiada(true)).catch(() => {}); }}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-semibold text-guinda ring-1 ring-stone-200"
        >
          {copiada ? <Check className="h-4 w-4 text-verde" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copiada ? "Copiada" : "Copiar"}
        </button>
      </div>
      <Boton onClick={alCerrar}>Listo</Boton>
    </HojaModal>
  );
}

function FormularioCensador({ estados, alCerrar, alCreado }: { estados: Estado[]; alCerrar: () => void; alCreado: (c: { correo: string; password: string }) => void }) {
  const [v, setV] = useState({ nombre: "", apellidoPaterno: "", apellidoMaterno: "", curp: "", correo: "", estadoClave: estados.length === 1 ? estados[0].clave : "" });
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const r = censadorNuevoSchema.safeParse(v);
  const err = (c: keyof typeof v) => (v[c] && !r.success ? ((r.error.flatten().fieldErrors as Record<string, string[] | undefined>)[c])?.[0] : undefined);
  const curpOk = curpSchema.safeParse(v.curp).success;
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!r.success) return;
    setEnviando(true);
    setError("");
    try {
      const c = await api<{ correo: string; password: string }>("/admin/usuarios-app", { json: r.data });
      alCreado(c);
    } catch (e2) {
      setError((e2 as Error).message);
      setEnviando(false);
    }
  }
  return (
    <HojaModal titulo="Nuevo censador" alCerrar={alCerrar}>
      <form onSubmit={crear} className="space-y-3">
        <Campo etiqueta="Nombre(s) *" value={v.nombre} autoComplete="off" onChange={(e) => setV({ ...v, nombre: e.target.value })} error={err("nombre")} />
        <div className="grid grid-cols-2 gap-2">
          <Campo etiqueta="Apellido paterno *" value={v.apellidoPaterno} autoComplete="off" onChange={(e) => setV({ ...v, apellidoPaterno: e.target.value })} error={err("apellidoPaterno")} />
          <Campo etiqueta="Apellido materno *" value={v.apellidoMaterno} autoComplete="off" onChange={(e) => setV({ ...v, apellidoMaterno: e.target.value })} error={err("apellidoMaterno")} />
        </div>
        <Campo etiqueta="CURP *" icono={Fingerprint} value={v.curp} maxLength={18} autoCapitalize="characters" autoComplete="off" spellCheck={false} onChange={(e) => setV({ ...v, curp: e.target.value.toUpperCase().replace(/\s/g, "") })} error={v.curp && !curpOk ? "Revisa la CURP (18 caracteres)" : undefined} valido={curpOk} />
        <Campo etiqueta="Correo (será su usuario) *" icono={Mail} type="email" inputMode="email" autoCapitalize="none" autoComplete="off" value={v.correo} onChange={(e) => setV({ ...v, correo: e.target.value })} error={err("correo")} />
        <Selector etiqueta="Estado *" icono={Landmark} value={v.estadoClave} onChange={(e) => setV({ ...v, estadoClave: e.target.value })} placeholder="Elige el estado" opciones={estados.map((x) => ({ valor: x.clave, texto: x.nombre }))} />
        <p className="text-xs text-stone-500">La cuenta queda autorizada y con los datos completos. El sistema genera una contraseña temporal que verás una sola vez.</p>
        {error && <Aviso>{error}</Aviso>}
        <div className="grid grid-cols-2 gap-2">
          <Boton type="button" variante="secundario" onClick={alCerrar} disabled={enviando}>Cancelar</Boton>
          <Boton type="submit" disabled={!r.success || enviando} icono={enviando ? Loader2 : UserPlus}>{enviando ? "Creando…" : "Crear"}</Boton>
        </div>
      </form>
    </HojaModal>
  );
}
