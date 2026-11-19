import { useEffect, useRef, useState } from "react";
import { Activity, ArrowUpDown, Check, Copy, KeyRound, Loader2, Pencil, ShieldCheck, Smartphone, UserPlus, Users } from "lucide-react";
import { CLAVES_PERMISOS, PERMISOS, personalNuevoSchema, type Permiso } from "@tortillerias/shared";
import { api } from "./api";
import { Aviso, Boton, Campo, HojaModal, Tarjeta, Vacio } from "./ui";
import { Paginacion, type Pagina } from "./Paginacion";
import { Buscador, SelectorFiltro } from "./Filtros";

export type UsuarioAdm = {
  id: string; correo: string | null; usuario: string; nombre: string; apellidos: string; rol: string; activo: boolean; creado_en: string; capturas: number;
  debe_cambiar_password?: boolean;
  /** AAAA-MM-DD de su última captura y cuántas hizo en los últimos 7 días: para ver quién está trabajando */
  ultima_captura?: string | null; capturas_7d?: number;
  /** del personal: los marcados (null = los de por omisión) y con los que de verdad cuenta */
  permisos?: string[] | null; permisos_efectivos?: string[];
};

const dia = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
};
const textoPermiso = (c: string) => PERMISOS.find((p) => p.clave === c)?.texto ?? c;
const nombreDe = (u: UsuarioAdm) => [u.nombre, u.apellidos].filter(Boolean).join(" ") || "Sin nombre";

/**
 * Usuarios, en dos tablas separadas:
 *  - Usuarios de la app (los que capturan precios en la PWA): no entran al administrador.
 *  - Usuarios del administrador (supervisores y administradores): cuentas aparte, con permisos de pantallas y acciones. Solo un administrador.
 */
export default function AdminUsuarios({ miId, esAdmin, puedeVerApp, puedeGestionarApp }: { miId: string; esAdmin: boolean; puedeVerApp: boolean; puedeGestionarApp: boolean }) {
  const [vista, setVista] = useState<"app" | "personal">(puedeVerApp ? "app" : "personal");
  const pestañas = [
    ...(puedeVerApp ? [{ id: "app" as const, texto: "Usuarios de la app", icono: Smartphone }] : []),
    ...(esAdmin ? [{ id: "personal" as const, texto: "Usuarios del administrador", icono: ShieldCheck }] : []),
  ];
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[92rem] flex-col gap-2.5 px-3 pb-3 pt-4 lg:px-6 lg:pb-5">
      {pestañas.length > 1 && (
        <div role="tablist" aria-label="Tipo de usuario" className="grid w-full shrink-0 grid-cols-2 gap-1 rounded-2xl bg-stone-200/70 p-1 md:w-[34rem]">
          {pestañas.map((p) => {
            const on = vista === p.id;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={on}
                onClick={() => setVista(p.id)}
                className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-2 text-[13px] font-semibold transition sm:text-sm ${on ? "bg-white text-guinda shadow" : "text-stone-500 hover:text-stone-700"}`}
              >
                <span className={`hidden h-7 w-7 shrink-0 place-items-center rounded-full sm:grid ${on ? "bg-guinda/10" : "bg-stone-300/50"}`}><p.icono className="h-4 w-4" aria-hidden /></span>
                <span className="min-w-0 text-center leading-tight">{p.texto}</span>
              </button>
            );
          })}
        </div>
      )}
      <ListaUsuarios key={vista} tipo={vista} miId={miId} esAdmin={esAdmin} puedeGestionarApp={puedeGestionarApp} />
    </div>
  );
}

function ListaUsuarios({ tipo, miId, esAdmin, puedeGestionarApp }: { tipo: "app" | "personal"; miId: string; esAdmin: boolean; puedeGestionarApp: boolean }) {
  const esPersonal = tipo === "personal";
  const puedeEditar = esPersonal ? esAdmin : puedeGestionarApp;
  const [pag, setPag] = useState<Pagina<UsuarioAdm>>();
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  const [rol, setRol] = useState("");
  const [activo, setActivo] = useState("");
  const [orden, setOrden] = useState("recientes");
  const [actividad, setActividad] = useState(""); // usuarios de la app: quién capturó estos días
  const [pagina, setPagina] = useState(1);
  const [limite, setLimite] = useState(50);
  const [recarga, setRecarga] = useState(0);
  const [error, setError] = useState("");
  const [trabajando, setTrabajando] = useState<string>();
  const [confirmando, setConfirmando] = useState<string>();
  const [temporal, setTemporal] = useState<{ correo: string; password: string; nuevo?: boolean }>();
  const [copiada, setCopiada] = useState(false);
  const [formulario, setFormulario] = useState<"nuevo" | UsuarioAdm>();
  const zona = useRef<HTMLDivElement>(null);
  const actualizar = (id: string, cambio: Partial<UsuarioAdm>) => setPag((p) => p && { ...p, filas: p.filas.map((x) => (x.id === id ? { ...x, ...cambio } : x)) });

  useEffect(() => {
    const t = window.setTimeout(() => {
      setQ(busqueda.trim());
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [busqueda]);

  useEffect(() => {
    let vigente = true;
    const p = new URLSearchParams({ tipo, pagina: String(pagina), limite: String(limite) });
    if (q) p.set("q", q);
    if (rol) p.set("rol", rol);
    if (activo) p.set("activo", activo);
    if (orden !== "recientes") p.set("orden", orden);
    if (actividad && !esPersonal) p.set("actividad", actividad);
    api<Pagina<UsuarioAdm>>(`/admin/usuarios?${p}`)
      .then((r) => {
        if (!vigente) return;
        if (!r.filas.length && pagina > 1) return setPagina(Math.max(1, r.paginas));
        setPag(r);
        setError("");
      })
      .catch((e) => vigente && setError(e.message));
    return () => {
      vigente = false;
    };
  }, [tipo, q, rol, activo, orden, actividad, pagina, limite, recarga]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    zona.current?.scrollTo({ top: 0 });
  }, [q, rol, activo, orden, actividad, pagina, limite]);

  async function cambiarActivo(u: UsuarioAdm) {
    setTrabajando(u.id);
    setError("");
    try {
      await api(`/admin/usuarios/${u.id}`, { metodo: "PATCH", json: { activo: !u.activo } });
      actualizar(u.id, { activo: !u.activo });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTrabajando(undefined);
    }
  }

  async function restablecer(u: UsuarioAdm) {
    setTrabajando(u.id);
    setError("");
    try {
      const r = await api<{ password: string }>(`/admin/usuarios/${u.id}/restablecer-password`, { json: {} });
      setTemporal({ correo: u.correo ?? u.usuario, password: r.password });
      setCopiada(false);
      actualizar(u.id, { debe_cambiar_password: true });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTrabajando(undefined);
      setConfirmando(undefined);
    }
  }

  const usuarios = pag?.filas;
  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 lg:flex-row lg:items-center">
        <div className="lg:max-w-md lg:flex-1">
          <Buscador valor={busqueda} alCambiar={setBusqueda} etiqueta="Buscar usuarios" placeholder="Buscar por correo, usuario o nombre" />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:flex lg:flex-1">
          <div className="col-span-2 md:col-span-1 lg:w-52">
            <SelectorFiltro
              icono={ArrowUpDown}
              etiqueta="Ordenar por"
              valor={orden}
              activo={orden !== "recientes"}
              alCambiar={(v) => { setOrden(v); setPagina(1); }}
              opciones={
                esPersonal
                  ? [{ valor: "recientes", texto: "Más recientes" }, { valor: "antiguos", texto: "Más antiguos" }, { valor: "nombre", texto: "Nombre (A–Z)" }]
                  : [
                      { valor: "recientes", texto: "Más recientes" },
                      { valor: "antiguos", texto: "Más antiguos" },
                      { valor: "ultima", texto: "Capturó hace poco" },
                      { valor: "capturas", texto: "Más capturas" },
                      { valor: "nombre", texto: "Nombre (A–Z)" },
                    ]
              }
            />
          </div>
          {!esPersonal && (
            <div className="lg:w-56">
              <SelectorFiltro
                icono={Activity}
                etiqueta="Filtrar por actividad"
                valor={actividad}
                activo={!!actividad}
                alCambiar={(v) => { setActividad(v); setPagina(1); }}
                opciones={[
                  { valor: "", texto: "Toda la actividad" },
                  { valor: "activos7", texto: "Capturaron esta semana" },
                  { valor: "sin7", texto: "Sin capturar esta semana" },
                  { valor: "nunca", texto: "Nunca han capturado" },
                ]}
              />
            </div>
          )}
          {esPersonal && (
            <div className="lg:w-48">
              <SelectorFiltro
                icono={ShieldCheck}
                etiqueta="Filtrar por rol"
                valor={rol}
                activo={!!rol}
                alCambiar={(v) => { setRol(v); setPagina(1); }}
                opciones={[{ valor: "", texto: "Todos los roles" }, { valor: "supervisor", texto: "Supervisores" }, { valor: "admin", texto: "Administradores" }]}
              />
            </div>
          )}
          <div className="lg:w-48">
            <SelectorFiltro
              icono={Users}
              etiqueta="Filtrar por estado de la cuenta"
              valor={activo}
              activo={!!activo}
              alCambiar={(v) => { setActivo(v); setPagina(1); }}
              opciones={[{ valor: "", texto: "Todas las cuentas" }, { valor: "1", texto: "Solo activas" }, { valor: "0", texto: "Solo inactivas" }]}
            />
          </div>
        </div>
        {esPersonal && esAdmin && (
          <Boton className="!min-h-11 lg:ml-auto lg:!w-auto lg:px-5" icono={UserPlus} onClick={() => setFormulario("nuevo")}>
            Nuevo usuario del administrador
          </Boton>
        )}
      </div>
      <p className="shrink-0 px-1 text-xs text-stone-500">
        {esPersonal
          ? "Cuentas para entrar al administrador. Cada una tiene sus pantallas y acciones; los usuarios de la app no pueden entrar aquí."
          : "Quienes capturan precios en la app. Estas cuentas no entran al administrador."}
      </p>
      {error && <Aviso>{error}</Aviso>}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200" aria-label={esPersonal ? "Usuarios del administrador" : "Usuarios de la app"}>
        <div ref={zona} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-stone-50/70 p-2.5">
          <div className="grid content-start gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {!usuarios ? (
              <div className="col-span-full grid place-items-center py-16 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : usuarios.length === 0 ? (
              <div className="col-span-full"><Vacio icono={Users} titulo="Sin resultados" texto={q ? "Ninguna cuenta coincide con la búsqueda." : undefined} /></div>
            ) : (
              usuarios.map((u) => {
                const yo = u.id === miId;
                const efectivos = u.permisos_efectivos ?? [];
                const vistas = efectivos.filter((c) => PERMISOS.find((p) => p.clave === c)?.tipo === "vista");
                const acciones = efectivos.filter((c) => PERMISOS.find((p) => p.clave === c)?.tipo === "accion");
                return (
                  <Tarjeta key={u.id} className={`space-y-2 ${u.activo ? "" : "opacity-60"}`}>
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-guinda/10 font-bold text-guinda">{(u.nombre || u.correo || u.usuario).charAt(0).toUpperCase()}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold leading-tight">{u.correo ?? u.usuario}</p>
                        <p className="truncate text-xs text-stone-500">{nombreDe(u)}{esPersonal ? "" : ` · ${u.capturas} captura(s)`}</p>
                        {!esPersonal && (
                          <p className="truncate text-[11px] text-stone-400">
                            {u.ultima_captura ? <>Última captura: {dia(u.ultima_captura)} · <b className={u.capturas_7d ? "text-emerald-700" : "text-stone-500"}>{u.capturas_7d ?? 0} en 7 días</b></> : "Aún sin capturas"}
                          </p>
                        )}
                      </div>
                      {yo && <span className="rounded-full bg-verde/10 px-2 py-0.5 text-[11px] font-semibold text-verde">Tú</span>}
                      {!yo && u.debe_cambiar_password && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200">Cambio pendiente</span>}
                    </div>

                    {esPersonal && (
                      <div className="space-y-1.5">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-bold ${u.rol === "admin" ? "bg-guinda text-white" : "bg-dorado/20 text-[#7a5a23]"}`}>{u.rol === "admin" ? "Administrador" : "Supervisor"}</span>
                        {u.rol === "admin" ? (
                          <p className="text-xs text-stone-500">Puede todo, incluida la gestión de usuarios y la auditoría.</p>
                        ) : (
                          <p className="text-xs leading-snug text-stone-500">
                            <b className="text-stone-700">Ve:</b> {vistas.length ? vistas.map(textoPermiso).join(", ") : "nada"}
                            <br />
                            <b className="text-stone-700">Puede:</b> {acciones.length ? acciones.map(textoPermiso).join(", ") : "solo consultar"}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      {esPersonal && puedeEditar && !yo && (
                        <button onClick={() => setFormulario(u)} className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white text-sm font-semibold text-guinda ring-1 ring-stone-200 hover:ring-guinda/40">
                          <Pencil className="h-4 w-4" aria-hidden /> Editar rol y permisos
                        </button>
                      )}
                      <span className="ml-auto flex items-center gap-2 text-xs text-stone-500">
                        {u.activo ? "Activa" : "Inactiva"}
                        <button
                          role="switch"
                          aria-checked={u.activo}
                          aria-label={u.activo ? "Desactivar cuenta" : "Activar cuenta"}
                          disabled={yo || !puedeEditar || trabajando === u.id}
                          onClick={() => cambiarActivo(u)}
                          className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${u.activo ? "bg-verde" : "bg-stone-300"}`}
                        >
                          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${u.activo ? "left-[1.4rem]" : "left-0.5"}`} />
                        </button>
                      </span>
                    </div>

                    {!yo && puedeEditar &&
                      (confirmando === u.id ? (
                        <div className="space-y-2 rounded-xl bg-amber-50 p-2.5 ring-1 ring-amber-200">
                          <p className="text-xs font-semibold text-amber-900">¿Restablecer la contraseña de {u.correo ?? u.usuario}? La actual dejará de servir y se generará una temporal.</p>
                          <div className="grid grid-cols-2 gap-2">
                            <Boton variante="secundario" className="!min-h-10 !text-sm" onClick={() => setConfirmando(undefined)}>Cancelar</Boton>
                            <Boton className="!min-h-10 !text-sm" onClick={() => restablecer(u)} disabled={trabajando === u.id} icono={trabajando === u.id ? Loader2 : KeyRound}>Sí, restablecer</Boton>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmando(u.id)} disabled={trabajando === u.id} className="flex items-center gap-1.5 text-xs font-semibold text-guinda disabled:opacity-50">
                          <KeyRound className="h-3.5 w-3.5" aria-hidden /> Restablecer contraseña
                        </button>
                      ))}
                  </Tarjeta>
                );
              })
            )}
          </div>
        </div>
        {pag && <Paginacion total={pag.total} pagina={pag.pagina} paginas={pag.paginas} limite={pag.limite} alPagina={setPagina} alLimite={(n) => { setLimite(n); setPagina(1); }} />}
      </section>

      {formulario && (
        <FormularioPersonal
          usuario={formulario === "nuevo" ? undefined : formulario}
          alCerrar={() => setFormulario(undefined)}
          alGuardar={(creado) => {
            setFormulario(undefined);
            setRecarga((n) => n + 1);
            if (creado) {
              setTemporal({ correo: creado.correo, password: creado.password, nuevo: true });
              setCopiada(false);
            }
          }}
        />
      )}

      {temporal && (
        <HojaModal titulo={temporal.nuevo ? "Cuenta creada" : "Contraseña temporal"} alCerrar={() => setTemporal(undefined)}>
          <p className="text-sm text-stone-700">
            Entrégale esta contraseña a <b>{temporal.correo}</b>. Al entrar, el sistema le pedirá crear una nueva.
          </p>
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
            <code className="select-all text-2xl font-bold tracking-wider text-guinda">{temporal.password}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(temporal.password).then(() => setCopiada(true)).catch(() => {})}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-guinda ring-1 ring-guinda/30 hover:bg-guinda/5"
            >
              {copiada ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copiada ? "Copiada" : "Copiar"}
            </button>
          </div>
          <Aviso tipo="info">Se muestra una sola vez: si la pierdes, vuelve a restablecerla.</Aviso>
          <Boton onClick={() => setTemporal(undefined)}>Listo</Boton>
        </HojaModal>
      )}
    </>
  );
}

/** Marcar qué pantallas ve y qué acciones puede hacer una cuenta del administrador */
function SelectorPermisos({ valor, alCambiar, deshabilitado }: { valor: Set<string>; alCambiar: (v: Set<string>) => void; deshabilitado?: boolean }) {
  const alternar = (c: string) => {
    const n = new Set(valor);
    n.has(c) ? n.delete(c) : n.add(c);
    alCambiar(n);
  };
  const grupo = (tipo: "vista" | "accion", titulo: string) => (
    <fieldset className="space-y-1.5" disabled={deshabilitado}>
      <legend className="mb-1 text-xs font-bold uppercase tracking-wide text-stone-400">{titulo}</legend>
      {PERMISOS.filter((p) => p.tipo === tipo).map((p) => (
        <label key={p.clave} className={`flex cursor-pointer items-start gap-3 rounded-xl bg-white p-2.5 ring-1 transition ${valor.has(p.clave) ? "ring-guinda/40" : "ring-stone-200"} ${deshabilitado ? "opacity-60" : ""}`}>
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-guinda" checked={valor.has(p.clave)} onChange={() => alternar(p.clave)} />
          <span className="min-w-0 leading-tight">
            <span className="block text-sm font-semibold">{p.texto}</span>
            <span className="block text-xs text-stone-500">{p.ayuda}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
  return (
    <div className="space-y-3">
      <div className="flex gap-3 text-xs font-semibold text-guinda">
        <button type="button" disabled={deshabilitado} onClick={() => alCambiar(new Set(CLAVES_PERMISOS))} className="hover:underline disabled:opacity-50">Marcar todo</button>
        <button type="button" disabled={deshabilitado} onClick={() => alCambiar(new Set())} className="hover:underline disabled:opacity-50">Quitar todo</button>
      </div>
      {grupo("vista", "Qué pantallas ve")}
      {grupo("accion", "Qué puede hacer")}
    </div>
  );
}

/** Alta de una cuenta del administrador, o edición de su rol y permisos */
function FormularioPersonal({ usuario, alCerrar, alGuardar }: { usuario?: UsuarioAdm; alCerrar: () => void; alGuardar: (creado?: { correo: string; password: string }) => void }) {
  const editando = !!usuario;
  const [correo, setCorreo] = useState(usuario?.correo ?? "");
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [apellidos, setApellidos] = useState(usuario?.apellidos ?? "");
  const [rol, setRol] = useState<"supervisor" | "admin">(usuario?.rol === "admin" ? "admin" : "supervisor");
  const [permisos, setPermisos] = useState<Set<string>>(new Set(usuario?.permisos_efectivos ?? PERMISOS.filter((p) => p.tipo === "vista" && p.clave !== "ver_usuarios_app").map((p) => p.clave)));
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const lista = [...permisos].filter((c): c is Permiso => (CLAVES_PERMISOS as readonly string[]).includes(c));
  const sinVistas = rol === "supervisor" && !lista.some((c) => c.startsWith("ver_"));
  const valida = editando ? !sinVistas : personalNuevoSchema.safeParse({ correo, nombre, apellidos, rol, permisos: lista }).success && !sinVistas;

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      if (editando) {
        await api(`/admin/usuarios/${usuario!.id}`, { metodo: "PATCH", json: { rol, ...(rol === "supervisor" ? { permisos: lista } : {}) } });
        alGuardar();
      } else {
        const r = await api<{ correo: string; password: string }>("/admin/personal", { json: { correo, nombre, apellidos, rol, permisos: lista } });
        alGuardar({ correo: r.correo, password: r.password });
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <HojaModal titulo={editando ? "Editar rol y permisos" : "Nuevo usuario del administrador"} alCerrar={alCerrar}>
      {editando ? (
        <p className="text-sm text-stone-600">{usuario!.correo ?? usuario!.usuario} · {nombreDe(usuario!)}</p>
      ) : (
        <div className="space-y-2.5">
          <Campo etiqueta="Correo *" type="email" inputMode="email" autoCapitalize="none" autoComplete="off" value={correo} onChange={(e) => setCorreo(e.target.value)} placeholder="Ej. nombre@agricultura.gob.mx" />
          <div className="grid grid-cols-2 gap-2">
            <Campo etiqueta="Nombre *" autoComplete="off" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <Campo etiqueta="Apellidos *" autoComplete="off" value={apellidos} onChange={(e) => setApellidos(e.target.value)} />
          </div>
        </div>
      )}

      <div role="radiogroup" aria-label="Rol" className="grid grid-cols-2 gap-2">
        {([["supervisor", "Supervisor", "Con los permisos que marques"], ["admin", "Administrador", "Puede todo"]] as const).map(([v, t, ayuda]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={rol === v}
            onClick={() => setRol(v)}
            className={`rounded-xl px-3 py-2.5 text-left transition ${rol === v ? "bg-guinda text-white shadow-md shadow-guinda/25" : "bg-white text-stone-700 ring-1 ring-stone-200"}`}
          >
            <span className="block text-sm font-bold">{t}</span>
            <span className={`block text-xs ${rol === v ? "text-white/80" : "text-stone-500"}`}>{ayuda}</span>
          </button>
        ))}
      </div>

      {rol === "admin" ? (
        <Aviso tipo="info">Un administrador entra a todas las pantallas, puede hacer todas las acciones, gestiona los usuarios y ve la auditoría.</Aviso>
      ) : (
        <SelectorPermisos valor={permisos} alCambiar={setPermisos} />
      )}
      {sinVistas && <Aviso>Elige al menos una pantalla para que pueda entrar.</Aviso>}
      {error && <Aviso>{error}</Aviso>}
      {!editando && <p className="text-xs text-stone-500">El sistema genera una contraseña temporal que verás una sola vez; la persona la cambiará al entrar.</p>}

      <div className="grid grid-cols-2 gap-2">
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton onClick={guardar} disabled={!valida || guardando} icono={guardando ? Loader2 : editando ? Check : UserPlus}>{editando ? "Guardar" : "Crear cuenta"}</Boton>
      </div>
    </HojaModal>
  );
}
