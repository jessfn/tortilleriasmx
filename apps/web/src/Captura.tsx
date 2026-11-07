import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Banknote, Building2, Camera, Check, CircleCheck, Eye, EyeOff, FileText, Fingerprint, ImagePlus, KeyRound, Landmark, Layers,
  ListChecks, Loader2, LocateFixed, Mail, MapPin, PackageOpen, Phone, Plus, RotateCcw, Send, ShieldCheck, Store, UserPlus,
  UserRound, Wheat,
  type LucideIcon,
} from "lucide-react";
import { normalizarTexto, PASSWORD_MIN, PRECIO_MAX, PRECIO_MIN, registroSchema, responsableSchema } from "@tortillerias/shared";
import { api, ApiError, guardarSesion, type Sesion } from "./api";
import { buscarLugar } from "./geocoder";
import { blobADataUrl, comprimirFoto } from "./imagen";
import { borrar, CLAVES, guardar, leer } from "./persist";
import BuscadorLugar from "./BuscadorLugar";
import { Aviso, Barra, Boton, Buscador, Cabecera, Campo, Hoja, Opcion } from "./ui";

const Mapa = lazy(() => import("./Mapa"));

type Item = { clave: string; nombre: string };
type Tortilleria = { id: string; nombre: string; domicilio: string | null; estatus: string; distancia_m: number | null };
type Producto = "maiz" | "harina" | "masa";
type Pos = { lat: number; lng: number; precision?: number };

const PRODUCTOS: { id: Producto; texto: string; icono: LucideIcon }[] = [
  { id: "maiz", texto: "Tortilla de maíz", icono: Wheat },
  { id: "harina", texto: "Tortilla de harina", icono: PackageOpen },
  { id: "masa", texto: "Masa", icono: Layers },
];

type Datos = {
  estado?: Item;
  municipio?: Item;
  tortilleria?: Tortilleria;
  nueva: boolean;
  nombreNueva: string;
  domicilioNueva: string;
  pos?: Pos;
  foto?: Blob;
  fotoUrl?: string;
  resp: { nombre: string; apellidos: string; curp: string; telefono: string; tipoPersona: "fisica" | "moral"; rfc: string; razonSocial: string };
  aviso: boolean;
  /** Solo se pide si la persona aún no tiene cuenta: se crea al enviar el registro */
  cuenta: { correo: string; password: string; confirmar: string };
  producto: Producto;
  precio: string;
};

/**
 * Pasos del asistente, de lo general a lo personal:
 * primero todo lo de la tortillería (lugar, ubicación, foto, precio), después los datos de la persona
 * y al final la cuenta (correo y contraseña), que solo se pide si aún no hay sesión.
 */
function armarPasos(nueva: boolean, conCuenta: boolean): string[] {
  return [
    "estado", "municipio", "tortilleria", ...(nueva ? ["nueva"] : []),
    "ubicacion", "foto", "precio",
    "responsable", ...(conCuenta ? ["cuenta"] : []),
    "resumen",
  ];
}

const inicial: Datos = {
  nueva: false,
  nombreNueva: "",
  domicilioNueva: "",
  resp: { nombre: "", apellidos: "", curp: "", telefono: "", tipoPersona: "fisica", rfc: "", razonSocial: "" },
  aviso: false,
  cuenta: { correo: "", password: "", confirmar: "" },
  producto: "maiz",
  precio: "",
};

const META: Record<string, { titulo: string; sub: string; icono: LucideIcon }> = {
  estado: { titulo: "Estado", sub: "¿En qué estado estás?", icono: Landmark },
  municipio: { titulo: "Municipio", sub: "¿En qué municipio?", icono: Building2 },
  tortilleria: { titulo: "Tortillería", sub: "Elige una o agrega una nueva", icono: Store },
  nueva: { titulo: "Nueva tortillería", sub: "Todos los campos son obligatorios", icono: Plus },
  ubicacion: { titulo: "Ubicación", sub: "GPS o elige el punto en el mapa", icono: MapPin },
  foto: { titulo: "Foto", sub: "Toma una foto o elige de tu galería", icono: Camera },
  responsable: { titulo: "Tus datos", sub: "Del responsable de la tortillería", icono: UserRound },
  cuenta: { titulo: "Tu cuenta", sub: "Con ella entrarás a tu panel", icono: UserPlus },
  precio: { titulo: "Precio", sub: "Precio por kilo al público", icono: Banknote },
  resumen: { titulo: "Resumen", sub: "Revisa y envía", icono: ListChecks },
};

/** Lo que se conserva si la página se recarga (p. ej. al actualizarse la app): todo menos el archivo de la foto */
type Creada = { cuenta?: boolean; tortilleriaId?: string; foto?: boolean; resp?: boolean };
type Borrador = {
  d: Omit<Datos, "foto" | "fotoUrl">; // la contraseña NUNCA se guarda
  pasoId: string;
  creada: Creada;
  fotoDataUrl?: string;
};

type Props = {
  /** null = aún no tiene cuenta: el asistente le pedirá correo y contraseña al final de sus datos */
  sesion: Sesion | null;
  alSesion: (s: Sesion) => void;
  /** Salir sin terminar (regresa a la bienvenida o al panel) */
  alSalir: () => void;
  /** Registro terminado: entrar al panel */
  alTerminar: () => void;
};

export default function Captura({ sesion, alSesion, alSalir, alTerminar }: Props) {
  const [conCuenta] = useState(!sesion); // se fija al entrar: los pasos no cambian aunque se cree la cuenta a mitad del envío
  const [verPass, setVerPass] = useState(false);
  const [borrador] = useState(() => leer<Borrador>(CLAVES.borrador));
  const [d, setD] = useState<Datos>(() => (borrador ? { ...inicial, ...borrador.d, cuenta: { ...borrador.d.cuenta, password: "", confirmar: "" } } : inicial));
  const [paso, setPaso] = useState(() => {
    if (!borrador) return 0;
    const ps = armarPasos(borrador.d.nueva, !sesion);
    const i = ps.indexOf(borrador.pasoId);
    return i >= 0 ? i : ps.length - 1;
  });
  const [fotoDataUrl, setFotoDataUrl] = useState<string | undefined>(borrador?.fotoDataUrl);
  const [estados, setEstados] = useState<Item[]>([]);
  const [municipios, setMunicipios] = useState<Item[]>([]);
  const [tortillerias, setTortillerias] = useState<Tortilleria[]>([]);
  const [filtro, setFiltro] = useState("");
  const [centro, setCentro] = useState<Pos>();
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [km, setKm] = useState(5); // 0 = todo el municipio
  const [cargandoLista, setCargandoLista] = useState(false);
  const [visibles, setVisibles] = useState(80);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [creada, setCreada] = useState<Creada>(() => borrador?.creada ?? {});
  const inputCamara = useRef<HTMLInputElement>(null);
  const inputGaleria = useRef<HTMLInputElement>(null);

  const set = (p: Partial<Datos>) => setD((x) => ({ ...x, ...p }));
  const setResp = (p: Partial<Datos["resp"]>) => setD((x) => ({ ...x, resp: { ...x.resp, ...p } }));

  const pasos = useMemo(() => armarPasos(d.nueva, conCuenta), [d.nueva, conCuenta]);
  const id = pasos[paso];

  useEffect(() => setFiltro(""), [id]);

  // Recuperar la foto del borrador tras una recarga
  useEffect(() => {
    if (!borrador?.fotoDataUrl) return;
    fetch(borrador.fotoDataUrl)
      .then((r) => r.blob())
      .then((b) => setD((x) => (x.foto ? x : { ...x, foto: b, fotoUrl: URL.createObjectURL(b) })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guardar el borrador (sin archivo de foto) mientras se captura
  useEffect(() => {
    if (listo) return;
    const t = setTimeout(() => {
      const { foto: _f, fotoUrl: _u, ...resto } = d;
      const sinClave = { ...resto, cuenta: { correo: d.cuenta.correo, password: "", confirmar: "" } };
      const base = { d: sinClave, pasoId: pasos[paso], creada };
      const ok = guardar(CLAVES.borrador, { ...base, fotoDataUrl } satisfies Borrador);
      if (!ok && fotoDataUrl) guardar(CLAVES.borrador, base satisfies Borrador); // sin foto si no cabe
    }, 300);
    return () => clearTimeout(t);
  }, [d, paso, pasos, creada, fotoDataUrl, listo]);

  // Registro nuevo terminado: entrar solo al panel después de un momento
  useEffect(() => {
    if (!listo || !conCuenta) return;
    const t = setTimeout(alTerminar, 3500);
    return () => clearTimeout(t);
  }, [listo, conCuenta, alTerminar]);

  useEffect(() => {
    api<Item[]>("/estados").then(setEstados).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!d.estado) return;
    api<Item[]>(`/estados/${d.estado.clave}/municipios`).then(setMunicipios).catch((e) => setError(e.message));
  }, [d.estado]);

  useEffect(() => {
    if (id !== "tortilleria" || !d.municipio) return;
    const q = new URLSearchParams();
    if (filtro.trim()) q.set("q", filtro.trim());
    if (d.pos && km > 0) {
      // Radio alrededor de mi ubicación: TODAS las del círculo
      q.set("lat", String(d.pos.lat));
      q.set("lng", String(d.pos.lng));
      q.set("km", String(km));
    } else {
      q.set("municipio", d.municipio.clave);
      if (d.pos) {
        q.set("lat", String(d.pos.lat));
        q.set("lng", String(d.pos.lng));
      }
    }
    let vigente = true;
    setCargandoLista(true);
    const t = setTimeout(
      () =>
        api<Tortilleria[]>(`/tortillerias?${q}`)
          .then((r) => vigente && (setTortillerias(r), setVisibles(80)))
          .catch((e) => vigente && setError(e.message))
          .finally(() => vigente && setCargandoLista(false)),
      200,
    );
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [id, d.municipio, filtro, d.pos, km]);

  // Al llegar al mapa, centrarlo en el municipio elegido
  useEffect(() => {
    if (id !== "ubicacion" || d.pos || centro || !d.municipio || !d.estado) return;
    buscarLugar(`${d.municipio.nombre}, ${d.estado.nombre}`)
      .then((r) => r[0] && setCentro({ lat: r[0].lat, lng: r[0].lng }))
      .catch(() => {});
  }, [id, d.pos, centro, d.municipio, d.estado]);

  const resultadoResp = responsableSchema.safeParse({ ...d.resp, razonSocial: d.resp.razonSocial || undefined });
  const errResp = (campo: string) => {
    if (resultadoResp.success) return undefined;
    return (d.resp as any)[campo] ? resultadoResp.error.flatten().fieldErrors[campo as never]?.[0] : undefined;
  };
  const resultadoCuenta = registroSchema.safeParse(d.cuenta);
  const errCuenta = (campo: "correo" | "password" | "confirmar") =>
    d.cuenta[campo] && !resultadoCuenta.success ? (resultadoCuenta.error.flatten().fieldErrors[campo] as string[] | undefined)?.[0] : undefined;
  const precioNum = Number(d.precio.replace(",", "."));
  const precioOk = d.precio !== "" && precioNum >= PRECIO_MIN && precioNum <= PRECIO_MAX;

  // Todo es obligatorio
  const puede: Record<string, boolean> = {
    estado: !!d.estado,
    municipio: !!d.municipio,
    tortilleria: d.nueva || !!d.tortilleria,
    nueva: d.nombreNueva.trim().length >= 2 && d.domicilioNueva.trim().length >= 3,
    ubicacion: !!d.pos,
    foto: !!d.foto,
    responsable: resultadoResp.success && d.aviso,
    cuenta: resultadoCuenta.success,
    precio: precioOk,
    resumen: true,
  };

  function ir(delta: number) {
    setError("");
    setPaso((p) => Math.min(Math.max(p + delta, 0), pasos.length - 1));
  }

  function usarGps() {
    setError("");
    if (!navigator.geolocation) return setError("Este dispositivo no tiene GPS. Busca la dirección o toca el mapa.");
    setBuscandoGps(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        set({ pos: { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy } });
        setBuscandoGps(false);
      },
      () => {
        setBuscandoGps(false);
        setError("No pudimos obtener tu ubicación. Activa el permiso o elige el punto en el mapa.");
      },
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }

  async function recibirFoto(archivo?: File) {
    if (!archivo) return;
    try {
      const blob = await comprimirFoto(archivo);
      if (d.fotoUrl) URL.revokeObjectURL(d.fotoUrl);
      set({ foto: blob, fotoUrl: URL.createObjectURL(blob) });
      blobADataUrl(blob).then(setFotoDataUrl).catch(() => setFotoDataUrl(undefined));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  // Envío por etapas: si algo falla se reintenta sin duplicar lo ya guardado
  async function enviar() {
    setEnviando(true);
    setError("");
    let etapa = "";
    try {
      // 0) Cuenta nueva: se crea con el mismo formulario y la sesión inicia sola
      if (conCuenta && !creada.cuenta) {
        etapa = "cuenta";
        let s = await api<Sesion>("/auth/registro", { json: d.cuenta });
        guardarSesion(s); // desde aquí las llamadas siguientes ya van con la sesión
        try {
          // el perfil toma el nombre de quien registra (lo puede editar después)
          const nombre = await api<{ nombre: string; apellidos: string }>("/perfil", { metodo: "PATCH", json: { nombre: d.resp.nombre, apellidos: d.resp.apellidos } });
          s = { ...s, usuario: { ...s.usuario, ...nombre } };
          guardarSesion(s);
        } catch {
          /* no es crítico */
        }
        alSesion(s);
        setCreada((c) => ({ ...c, cuenta: true }));
      }
      etapa = "tortilleria";
      let tid = creada.tortilleriaId ?? d.tortilleria?.id;
      if (!tid) {
        const r = await api<{ id: string }>("/tortillerias", {
          json: {
            nombre: d.nombreNueva.trim(),
            domicilio: d.domicilioNueva.trim(),
            estadoClave: d.estado!.clave,
            municipioClave: d.municipio!.clave,
            lat: d.pos!.lat,
            lng: d.pos!.lng,
          },
        });
        tid = r.id;
        setCreada((c) => ({ ...c, tortilleriaId: tid }));
      }
      if (!creada.foto) {
        const f = new FormData();
        f.append("file", d.foto!, "foto.jpg");
        await api(`/tortillerias/${tid}/fotos`, { form: f });
        setCreada((c) => ({ ...c, foto: true }));
      }
      if (!creada.resp) {
        await api(`/tortillerias/${tid}/responsable`, { json: { ...d.resp, razonSocial: d.resp.razonSocial || undefined, aceptoAviso: d.aviso } });
        setCreada((c) => ({ ...c, resp: true }));
      }
      await api("/precios", {
        json: { tortilleriaId: tid, producto: d.producto, precioKg: precioNum, lat: d.pos!.lat, lng: d.pos!.lng, precisionGps: d.pos!.precision },
      });
      borrar(CLAVES.borrador);
      setListo(true);
    } catch (e) {
      if (etapa === "cuenta") {
        // correo ya usado u otro problema con la cuenta: se regresa a ese paso para corregirlo
        setPaso(pasos.indexOf("cuenta"));
        setError(e instanceof ApiError && e.status === 429 ? "Demasiados intentos. Inténtalo más tarde." : (e as Error).message);
      } else if (e instanceof ApiError && e.status === 409 && e.cuerpo?.posibles) {
        setError(`Ya existe una tortillería parecida cerca: ${e.cuerpo.posibles.map((p: any) => p.nombre).join(", ")}. Regresa y elígela de la lista.`);
      } else if (e instanceof ApiError && e.status === 429) {
        setError("Demasiados envíos seguidos. Espera un minuto e inténtalo de nuevo.");
      } else {
        setError((e as Error).message);
      }
    } finally {
      setEnviando(false);
    }
  }

  function otra() {
    if (d.fotoUrl) URL.revokeObjectURL(d.fotoUrl);
    setD({ ...inicial, estado: d.estado, municipio: d.municipio });
    setFotoDataUrl(undefined);
    setCreada({});
    setFiltro("");
    setCentro(undefined);
    setListo(false);
    setPaso(2);
  }

  if (listo)
    return (
      <div className="mx-auto flex h-dvh max-w-xl flex-col items-center justify-center gap-5 bg-gradient-to-b from-guinda-oscuro to-guinda p-8 text-center text-white">
        <div className="paso grid h-24 w-24 place-items-center rounded-full bg-white/15 ring-8 ring-white/10">
          <CircleCheck className="h-14 w-14 text-dorado" aria-hidden />
        </div>
        <div className="paso">
          <h1 className="text-2xl font-bold">{conCuenta ? "¡Registro completo!" : "¡Captura enviada!"}</h1>
          <p className="mt-1.5 text-sm text-white/80">
            {conCuenta
              ? "Creamos tu cuenta, iniciaste sesión y registramos tu tortillería. Entrando a tu panel…"
              : "Gracias por tu aportación. El precio quedó registrado y será revisado."}
          </p>
        </div>
        <div className="mt-2 w-full max-w-sm space-y-2">
          {conCuenta ? (
            <Boton onClick={alTerminar} icono={Check} className="!bg-white !bg-none !text-guinda !shadow-xl">
              Entrar a mi panel
            </Boton>
          ) : (
            <>
              <Boton onClick={otra} icono={RotateCcw} className="!bg-white !bg-none !text-guinda !shadow-xl">
                Registrar otra tortillería
              </Boton>
              <Boton variante="fantasma" onClick={alTerminar} className="!text-white/80 hover:!bg-white/10">
                Ir a mi panel
              </Boton>
            </>
          )}
        </div>
      </div>
    );

  const m = META[id];
  const llena = id === "ubicacion" || id === "foto"; // estas pantallas ocupan todo el alto, sin scroll
  const buscaEn: Record<string, string> = { estado: "Buscar estado", municipio: "Buscar municipio", tortilleria: "Buscar por nombre o calle" };

  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const filtrar = (items: Item[]) => items.filter((i) => norm(i.nombre).includes(norm(filtro)));

  return (
    <div className="mx-auto flex h-dvh max-w-xl flex-col overflow-hidden bg-guinda-oscuro">
      <Cabecera paso={paso + 1} total={pasos.length} titulo={m.titulo} subtitulo={m.sub} icono={m.icono} atras={paso > 0 ? () => ir(-1) : alSalir}>
        {buscaEn[id] && <Buscador value={filtro} onChange={setFiltro} placeholder={buscaEn[id]} cargando={id === "tortilleria" && cargandoLista} />}
        {id === "tortilleria" && (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button
                onClick={usarGps}
                disabled={buscandoGps}
                className={`flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold ring-1 transition ${d.pos ? "bg-white/20 text-white ring-white/40" : "bg-white text-guinda ring-white"}`}
              >
                {buscandoGps ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                {buscandoGps ? "Buscando…" : d.pos ? "Ubicación activa · actualizar" : "Ver las más cercanas a mí"}
              </button>
              <button
                onClick={() => {
                  set({ nueva: true, tortilleria: undefined });
                  setPaso((x) => x + 1);
                }}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-dorado px-3.5 text-sm font-bold text-guinda-oscuro shadow-md active:scale-95"
              >
                <Plus className="h-4 w-4" strokeWidth={3} /> Nueva
              </button>
            </div>
            {d.pos && (
              <div className="grid grid-cols-5 gap-1 rounded-xl bg-black/20 p-1" role="radiogroup" aria-label="Distancia">
                {[1, 5, 10, 20, 0].map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={km === v}
                    onClick={() => setKm(v)}
                    className={`h-8 rounded-lg text-xs font-semibold transition ${km === v ? "bg-white text-guinda shadow" : "text-white/85"}`}
                  >
                    {v === 0 ? "Muni." : `${v} km`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {id === "ubicacion" && <BuscadorLugar onElegir={(l) => set({ pos: { lat: l.lat, lng: l.lng } })} />}
      </Cabecera>

      <Hoja>
        <div
          key={id}
          onScroll={
            id === "tortilleria"
              ? (e) => {
                  const el = e.currentTarget;
                  if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) setVisibles((v) => v + 80);
                }
              : undefined
          }
          className={`paso min-h-0 flex-1 overscroll-contain px-3 pb-2 pt-5 ${llena ? "flex flex-col gap-2 overflow-hidden" : "space-y-2 overflow-y-auto"}`}
        >
          {id === "estado" &&
            filtrar(estados).map((e) => (
              <Opcion key={e.clave} icono={Landmark} activo={d.estado?.clave === e.clave} onClick={() => set({ estado: e, municipio: undefined, tortilleria: undefined })}>
                <span className="font-medium">{e.nombre}</span>
              </Opcion>
            ))}

          {id === "municipio" &&
            filtrar(municipios).slice(0, 120).map((mu) => (
              <Opcion key={mu.clave} icono={Building2} activo={d.municipio?.clave === mu.clave} onClick={() => set({ municipio: mu, tortilleria: undefined })}>
                <span className="font-medium">{mu.nombre}</span>
              </Opcion>
            ))}

          {id === "tortilleria" && (
            <>
              <p className="px-1 text-xs text-stone-500">
                {cargandoLista
                  ? "Buscando…"
                  : `${tortillerias.length.toLocaleString("es-MX")} tortillerías${d.pos && km > 0 ? ` a ${km} km o menos` : ` en ${d.municipio?.nombre ?? "el municipio"}`}${filtro.trim() ? ` con “${filtro.trim()}”` : ""}${!d.pos ? ". Toca “Cerca de mí” para ver las más próximas." : ""}`}
              </p>
              {d.nueva && (
                <Opcion icono={Plus} activo onClick={() => set({ nueva: false })}>
                  <span className="font-medium">Agregando una nueva (toca para cancelar)</span>
                </Opcion>
              )}
              {tortillerias.slice(0, visibles).map((t) => (
                <Opcion key={t.id} icono={Store} activo={!d.nueva && d.tortilleria?.id === t.id} onClick={() => set({ tortilleria: t, nueva: false })}>
                  <div className="font-medium">{t.nombre}</div>
                  <div className="text-xs text-stone-500">
                    {t.domicilio ?? "Sin domicilio"}
                    {t.distancia_m != null && ` · ${t.distancia_m >= 1000 ? (t.distancia_m / 1000).toFixed(1) + " km" : Math.round(t.distancia_m) + " m"}`}
                    {t.estatus === "pendiente" && " · por validar"}
                  </div>
                </Opcion>
              ))}
              {visibles < tortillerias.length && <p className="px-1 py-2 text-center text-xs text-stone-400">Desliza para ver más…</p>}
              {!cargandoLista && tortillerias.length === 0 && (
                <p className="px-1 py-6 text-center text-sm text-stone-500">No hay resultados. Amplía el radio, cambia la búsqueda o agrega una nueva.</p>
              )}
            </>
          )}

          {id === "nueva" && (
            <>
              <Campo etiqueta="Nombre de la tortillería" icono={Store} value={d.nombreNueva} onChange={(e) => set({ nombreNueva: e.target.value })} />
              <Campo etiqueta="Domicilio" icono={MapPin} value={d.domicilioNueva} onChange={(e) => set({ domicilioNueva: e.target.value })} ayuda="Calle, número y colonia" />
            </>
          )}

          {id === "ubicacion" && (
            <>
              <Boton variante="secundario" onClick={usarGps} disabled={buscandoGps} icono={buscandoGps ? Loader2 : LocateFixed} className="!min-h-11 shrink-0">
                {buscandoGps ? "Buscando tu ubicación…" : "Usar mi ubicación actual"}
              </Boton>
              <div className="min-h-0 flex-1">
                <Suspense fallback={<div className="h-full animate-pulse rounded-2xl bg-stone-200" />}>
                  <Mapa pos={d.pos} centro={centro} onElegir={(lat, lng) => set({ pos: { lat, lng } })} />
                </Suspense>
              </div>
              <div className="shrink-0">
                {d.pos ? (
                  d.pos.precision != null ? (
                    <Aviso tipo={d.pos.precision > 50 ? "info" : "ok"}>
                      GPS con precisión de {Math.round(d.pos.precision)} m.{d.pos.precision > 50 ? " Es baja: ajusta el pin en el mapa." : " Puedes mover el pin."}
                    </Aviso>
                  ) : (
                    <Aviso tipo="ok">Ubicación elegida. Arrastra el pin para ajustarla.</Aviso>
                  )
                ) : (
                  <p className="text-center text-xs text-stone-500">Busca arriba, toca el mapa o usa tu ubicación actual.</p>
                )}
              </div>
            </>
          )}

          {id === "foto" && (
            <>
              <div className="min-h-0 flex-1 overflow-hidden rounded-2xl">
                {d.fotoUrl ? (
                  <img src={d.fotoUrl} alt="Vista previa de la tortillería" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center rounded-2xl border-2 border-dashed border-stone-300 bg-white text-stone-400">
                    <div className="text-center">
                      <Camera className="mx-auto h-12 w-12" aria-hidden />
                      <p className="mt-2 text-sm">Aún no hay foto</p>
                    </div>
                  </div>
                )}
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-2">
                <Boton onClick={() => inputCamara.current?.click()} icono={Camera}>{d.foto ? "Otra foto" : "Tomar foto"}</Boton>
                <Boton variante="secundario" onClick={() => inputGaleria.current?.click()} icono={ImagePlus}>Galería</Boton>
              </div>
              <input ref={inputCamara} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { recibirFoto(e.target.files?.[0]); e.target.value = ""; }} />
              <input ref={inputGaleria} type="file" accept="image/*" className="sr-only" onChange={(e) => { recibirFoto(e.target.files?.[0]); e.target.value = ""; }} />
            </>
          )}

          {id === "responsable" && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Campo etiqueta="Nombre(s)" value={d.resp.nombre} autoCapitalize="characters" onChange={(e) => setResp({ nombre: normalizarTexto(e.target.value) })} error={errResp("nombre")} autoComplete="off" />
                <Campo etiqueta="Apellidos" value={d.resp.apellidos} autoCapitalize="characters" onChange={(e) => setResp({ apellidos: normalizarTexto(e.target.value) })} error={errResp("apellidos")} autoComplete="off" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Chip activo={d.resp.tipoPersona === "fisica"} onClick={() => setResp({ tipoPersona: "fisica", rfc: "" })}>Persona física</Chip>
                <Chip activo={d.resp.tipoPersona === "moral"} onClick={() => setResp({ tipoPersona: "moral", rfc: "" })}>Persona moral</Chip>
              </div>
              {d.resp.tipoPersona === "moral" && <Campo etiqueta="Razón social" icono={Building2} value={d.resp.razonSocial} autoCapitalize="characters" onChange={(e) => setResp({ razonSocial: normalizarTexto(e.target.value) })} error={errResp("razonSocial")} />}
              <Campo etiqueta="CURP" icono={Fingerprint} value={d.resp.curp} maxLength={18} autoCapitalize="characters" autoComplete="off" onChange={(e) => setResp({ curp: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} error={errResp("curp")} placeholder="18 caracteres" />
              <Campo etiqueta="RFC" icono={FileText} value={d.resp.rfc} maxLength={d.resp.tipoPersona === "fisica" ? 13 : 12} autoCapitalize="characters" autoComplete="off" onChange={(e) => setResp({ rfc: e.target.value.toUpperCase().replace(/[^A-ZÑ&0-9]/g, "") })} error={errResp("rfc")} placeholder={d.resp.tipoPersona === "fisica" ? "13 caracteres" : "12 caracteres"} />
              <Campo etiqueta="Teléfono" icono={Phone} value={d.resp.telefono} inputMode="numeric" maxLength={10} autoComplete="off" onChange={(e) => setResp({ telefono: e.target.value.replace(/\D/g, "").slice(0, 10) })} error={errResp("telefono")} placeholder="10 dígitos" />
              <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-guinda" checked={d.aviso} onChange={(e) => set({ aviso: e.target.checked })} />
                <span className="text-xs leading-snug">
                  <ShieldCheck className="mr-1 inline h-4 w-4 text-verde" aria-hidden />
                  El responsable acepta el aviso de privacidad para el tratamiento de sus datos personales.
                </span>
              </label>
            </>
          )}

          {id === "cuenta" && (
            <>
              <p className="text-sm leading-snug text-stone-600">
                Con tu correo y contraseña entrarás a tu panel para ver tus registros y registrar más tortillerías. Tu cuenta se crea al enviar.
              </p>
              <Campo
                etiqueta="Correo electrónico"
                icono={Mail}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                autoCorrect="off"
                value={d.cuenta.correo}
                onChange={(e) => set({ cuenta: { ...d.cuenta, correo: e.target.value } })}
                error={errCuenta("correo")}
                placeholder="tucorreo@ejemplo.com"
              />
              <Campo
                etiqueta="Contraseña"
                icono={KeyRound}
                type={verPass ? "text" : "password"}
                autoComplete="new-password"
                value={d.cuenta.password}
                onChange={(e) => set({ cuenta: { ...d.cuenta, password: e.target.value } })}
                error={errCuenta("password")}
                ayuda={`Mínimo ${PASSWORD_MIN} caracteres`}
                derecha={
                  <button type="button" onClick={() => setVerPass(!verPass)} aria-label={verPass ? "Ocultar contraseña" : "Mostrar contraseña"} className="grid h-10 w-10 place-items-center rounded-full text-stone-400 hover:text-stone-700">
                    {verPass ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                }
              />
              <Campo
                etiqueta="Confirmar contraseña"
                icono={KeyRound}
                type={verPass ? "text" : "password"}
                autoComplete="new-password"
                value={d.cuenta.confirmar}
                onChange={(e) => set({ cuenta: { ...d.cuenta, confirmar: e.target.value } })}
                error={errCuenta("confirmar")}
              />
            </>
          )}

          {id === "precio" && (
            <>
              {PRODUCTOS.map((p) => (
                <Opcion key={p.id} icono={p.icono} activo={d.producto === p.id} onClick={() => set({ producto: p.id })}>
                  <span className="font-medium">{p.texto}</span>
                </Opcion>
              ))}
              <label className="block pt-1">
                <span className="mb-1 block text-xs font-semibold text-stone-600">Precio por kilo (MXN)</span>
                <span className="flex items-center rounded-2xl bg-white px-4 shadow-sm ring-1 ring-stone-200 focus-within:ring-4 focus-within:ring-guinda/15">
                  <span className="text-3xl font-bold text-stone-300">$</span>
                  <input
                    inputMode="decimal"
                    value={d.precio}
                    onChange={(e) => set({ precio: e.target.value.replace(/[^0-9.,]/g, "").slice(0, 6) })}
                    placeholder="0.00"
                    aria-label="Precio por kilo"
                    className="w-full bg-transparent px-2 py-4 text-center text-4xl font-bold outline-none placeholder:text-stone-200"
                  />
                </span>
              </label>
              {d.precio !== "" && !precioOk && <Aviso>El precio debe estar entre ${PRECIO_MIN} y ${PRECIO_MAX}.</Aviso>}
            </>
          )}

          {id === "resumen" && (
            <div className="divide-y divide-stone-100 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200">
              <Fila icono={MapPin} k="Lugar" v={`${d.municipio?.nombre}, ${d.estado?.nombre}`} />
              <Fila icono={Store} k="Tortillería" v={d.nueva ? `${d.nombreNueva} (nueva)` : d.tortilleria?.nombre ?? ""} />
              <Fila icono={Wheat} k="Producto" v={PRODUCTOS.find((p) => p.id === d.producto)!.texto} />
              <Fila icono={Banknote} k="Precio" v={`$${precioNum.toFixed(2)} por kilo`} />
              <Fila icono={Camera} k="Foto" v="Incluida" />
              <Fila icono={UserRound} k="Responsable" v={`${d.resp.nombre} ${d.resp.apellidos}`} />
              {conCuenta && <Fila icono={Mail} k="Tu cuenta" v={d.cuenta.correo} />}
            </div>
          )}

          {error && <Aviso>{error}</Aviso>}
        </div>
      </Hoja>

      <Barra>
        {id === "resumen" ? (
          <Boton onClick={enviar} disabled={enviando} icono={enviando ? Loader2 : Send}>
            {enviando ? "Enviando…" : conCuenta ? "Crear cuenta y enviar" : "Enviar captura"}
          </Boton>
        ) : (
          <Boton onClick={() => ir(1)} disabled={!puede[id]} icono={Check}>
            Continuar
          </Boton>
        )}
      </Barra>
    </div>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`min-h-11 rounded-xl px-3 text-sm font-semibold transition active:scale-[.97] ${activo ? "bg-guinda text-white shadow-md shadow-guinda/25" : "bg-white text-stone-600 ring-1 ring-stone-200"}`}
    >
      {children}
    </button>
  );
}

function Fila({ icono: Icono, k, v }: { icono: LucideIcon; k: string; v: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-guinda/10 text-guinda">
        <Icono className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 leading-tight">
        <div className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{k}</div>
        <div className="truncate text-[15px] font-semibold">{v}</div>
      </div>
    </div>
  );
}
