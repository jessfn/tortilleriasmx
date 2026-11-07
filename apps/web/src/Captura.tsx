import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { PRECIO_MAX, PRECIO_MIN, responsableSchema } from "@tortillerias/shared";
import { api, ApiError } from "./api";
import { comprimirFoto } from "./imagen";
import { Boton, Campo, Opcion, Pantalla } from "./ui";

const Mapa = lazy(() => import("./Mapa"));

type Item = { clave: string; nombre: string };
type Tortilleria = { id: string; nombre: string; domicilio: string | null; estatus: string; distancia_m: number | null };
type Producto = "maiz" | "harina" | "masa";
const PRODUCTOS: { id: Producto; texto: string }[] = [
  { id: "maiz", texto: "Tortilla de maíz" },
  { id: "harina", texto: "Tortilla de harina" },
  { id: "masa", texto: "Masa" },
];

type Datos = {
  estado?: Item;
  municipio?: Item;
  tortilleria?: Tortilleria;
  nueva: boolean;
  nombreNueva: string;
  domicilioNueva: string;
  pos?: { lat: number; lng: number; precision?: number };
  foto?: Blob;
  fotoUrl?: string;
  omitirResponsable: boolean;
  resp: { nombre: string; apellidos: string; curp: string; telefono: string; tipoPersona: "fisica" | "moral"; rfc: string; razonSocial: string };
  aviso: boolean;
  producto: Producto;
  precio: string;
};

const inicial: Datos = {
  nueva: false,
  nombreNueva: "",
  domicilioNueva: "",
  omitirResponsable: true,
  resp: { nombre: "", apellidos: "", curp: "", telefono: "", tipoPersona: "fisica", rfc: "", razonSocial: "" },
  aviso: false,
  producto: "maiz",
  precio: "",
};

export default function Captura({ usuario, salir }: { usuario: string; salir: () => void }) {
  const [d, setD] = useState<Datos>(inicial);
  const [paso, setPaso] = useState(0);
  const [estados, setEstados] = useState<Item[]>([]);
  const [municipios, setMunicipios] = useState<Item[]>([]);
  const [tortillerias, setTortillerias] = useState<Tortilleria[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [creada, setCreada] = useState<{ tortilleriaId?: string; foto?: boolean; resp?: boolean }>({});

  const set = (p: Partial<Datos>) => setD((x) => ({ ...x, ...p }));
  const setResp = (p: Partial<Datos["resp"]>) => setD((x) => ({ ...x, resp: { ...x.resp, ...p } }));

  const pasos = useMemo(
    () => ["estado", "municipio", "tortilleria", ...(d.nueva ? ["nueva"] : []), "ubicacion", "foto", "responsable", "precio", "resumen"],
    [d.nueva],
  );
  const id = pasos[paso];

  useEffect(() => {
    api<Item[]>("/estados").then(setEstados).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!d.estado) return;
    api<Item[]>(`/estados/${d.estado.clave}/municipios`).then(setMunicipios).catch((e) => setError(e.message));
  }, [d.estado]);

  // Tortillerías del municipio (con cercanía si ya hay GPS)
  useEffect(() => {
    if (id !== "tortilleria" || !d.municipio) return;
    const q = new URLSearchParams({ municipio: d.municipio.clave });
    if (busqueda.trim()) q.set("q", busqueda.trim());
    if (d.pos) {
      q.set("lat", String(d.pos.lat));
      q.set("lng", String(d.pos.lng));
    }
    const t = setTimeout(() => api<Tortilleria[]>(`/tortillerias?${q}`).then(setTortillerias).catch((e) => setError(e.message)), 250);
    return () => clearTimeout(t);
  }, [id, d.municipio, busqueda, d.pos]);

  const resultadoResp = responsableSchema.safeParse({ ...d.resp, razonSocial: d.resp.razonSocial || undefined });
  const errResp = (campo: string) => {
    if (resultadoResp.success) return undefined;
    const valor = (d.resp as any)[campo];
    return valor ? resultadoResp.error.flatten().fieldErrors[campo as never]?.[0] : undefined;
  };
  const precioNum = Number(d.precio.replace(",", "."));
  const precioOk = d.precio !== "" && precioNum >= PRECIO_MIN && precioNum <= PRECIO_MAX;
  const respRequerido = d.nueva || !d.omitirResponsable;

  const puede: Record<string, boolean> = {
    estado: !!d.estado,
    municipio: !!d.municipio,
    tortilleria: d.nueva || !!d.tortilleria,
    nueva: d.nombreNueva.trim().length >= 2,
    ubicacion: !!d.pos,
    foto: !d.nueva || !!d.foto,
    responsable: !respRequerido || (resultadoResp.success && d.aviso),
    precio: precioOk,
    resumen: true,
  };

  function ir(delta: number) {
    setError("");
    setPaso((p) => Math.min(Math.max(p + delta, 0), pasos.length - 1));
  }

  function usarGps() {
    setError("");
    if (!navigator.geolocation) return setError("Este dispositivo no tiene GPS disponible.");
    navigator.geolocation.getCurrentPosition(
      (p) => set({ pos: { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy } }),
      () => setError("No se pudo obtener tu ubicación. Revisa el permiso de ubicación del navegador."),
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }

  async function tomarFoto(archivo?: File) {
    if (!archivo) return;
    try {
      const blob = await comprimirFoto(archivo);
      if (d.fotoUrl) URL.revokeObjectURL(d.fotoUrl);
      set({ foto: blob, fotoUrl: URL.createObjectURL(blob) });
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  // Envío por etapas: si algo falla se puede reintentar sin duplicar lo ya guardado
  async function enviar() {
    setEnviando(true);
    setError("");
    try {
      let tid = creada.tortilleriaId ?? d.tortilleria?.id;
      if (!tid) {
        const r = await api<{ id: string }>("/tortillerias", {
          json: {
            nombre: d.nombreNueva.trim(),
            domicilio: d.domicilioNueva.trim() || undefined,
            estadoClave: d.estado!.clave,
            municipioClave: d.municipio!.clave,
            lat: d.pos!.lat,
            lng: d.pos!.lng,
          },
        });
        tid = r.id;
        setCreada((c) => ({ ...c, tortilleriaId: tid }));
      }
      if (d.foto && !creada.foto) {
        const f = new FormData();
        f.append("file", d.foto, "foto.jpg");
        await api(`/tortillerias/${tid}/fotos`, { form: f });
        setCreada((c) => ({ ...c, foto: true }));
      }
      if (respRequerido && !creada.resp) {
        await api(`/tortillerias/${tid}/responsable`, {
          json: { ...d.resp, razonSocial: d.resp.razonSocial || undefined, aceptoAviso: d.aviso },
        });
        setCreada((c) => ({ ...c, resp: true }));
      }
      await api("/precios", {
        json: { tortilleriaId: tid, producto: d.producto, precioKg: precioNum, lat: d.pos!.lat, lng: d.pos!.lng, precisionGps: d.pos!.precision },
      });
      setListo(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.cuerpo?.posibles) {
        setError(`Ya existe una tortillería parecida cerca: ${e.cuerpo.posibles.map((p: any) => p.nombre).join(", ")}. Regresa y elígela de la lista.`);
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
    setCreada({});
    setBusqueda("");
    setListo(false);
    setPaso(2);
  }

  if (listo)
    return (
      <Pantalla>
        <div className="paso flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="grid h-24 w-24 place-items-center rounded-full bg-verde text-5xl text-white">✓</div>
          <h2 className="text-2xl font-bold">¡Captura enviada!</h2>
          <p className="text-stone-600 dark:text-stone-300">Gracias, {usuario}. El precio quedó registrado.</p>
          <Boton onClick={otra}>Capturar otra tortillería</Boton>
          <Boton variante="fantasma" onClick={salir}>Salir</Boton>
        </div>
      </Pantalla>
    );

  const titulos: Record<string, string> = {
    estado: "¿En qué estado estás?",
    municipio: "¿En qué municipio?",
    tortilleria: "¿Cuál tortillería?",
    nueva: "Datos de la tortillería",
    ubicacion: "Marca la ubicación",
    foto: "Foto de la tortillería",
    responsable: "Datos del responsable",
    precio: "¿Cuánto cuesta el kilo?",
    resumen: "Revisa y envía",
  };

  return (
    <Pantalla titulo={titulos[id]}>
      <div className="h-1.5 bg-guinda-oscuro/20">
        <div className="h-full bg-dorado transition-all duration-300" style={{ width: `${((paso + 1) / pasos.length) * 100}%` }} />
      </div>

      <main key={id} className="paso flex flex-1 flex-col gap-3 p-5">
        {id === "estado" && estados.map((e) => (
          <Opcion key={e.clave} activo={d.estado?.clave === e.clave} onClick={() => set({ estado: e, municipio: undefined, tortilleria: undefined })}>{e.nombre}</Opcion>
        ))}

        {id === "municipio" && <ListaBuscable items={municipios} sel={d.municipio} alElegir={(m) => set({ municipio: m, tortilleria: undefined })} />}

        {id === "tortilleria" && (
          <>
            <Campo etiqueta="Buscar por nombre" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            {tortillerias.map((t) => (
              <Opcion key={t.id} activo={!d.nueva && d.tortilleria?.id === t.id} onClick={() => set({ tortilleria: t, nueva: false, omitirResponsable: true })}>
                <div>{t.nombre}</div>
                <div className="text-sm text-stone-500">
                  {t.domicilio ?? "Sin domicilio"}{t.distancia_m != null && ` · ${Math.round(t.distancia_m)} m`}{t.estatus === "pendiente" && " · por validar"}
                </div>
              </Opcion>
            ))}
            <Opcion activo={d.nueva} onClick={() => set({ nueva: true, tortilleria: undefined, omitirResponsable: false })}>
              ➕ No aparece, agregar nueva
            </Opcion>
          </>
        )}

        {id === "nueva" && (
          <>
            <Campo etiqueta="Nombre de la tortillería" value={d.nombreNueva} onChange={(e) => set({ nombreNueva: e.target.value })} />
            <Campo etiqueta="Domicilio (opcional)" value={d.domicilioNueva} onChange={(e) => set({ domicilioNueva: e.target.value })} />
          </>
        )}

        {id === "ubicacion" && (
          <>
            <Boton variante="secundario" onClick={usarGps}>📍 Usar mi ubicación</Boton>
            {d.pos ? (
              <>
                <Suspense fallback={<div className="h-72 animate-pulse rounded-2xl bg-stone-200" />}>
                  <Mapa lat={d.pos.lat} lng={d.pos.lng} onCambio={(lat, lng) => set({ pos: { lat, lng, precision: d.pos?.precision } })} />
                </Suspense>
                <p className="text-sm text-stone-600 dark:text-stone-300">Arrastra el pin o toca el mapa para ajustarlo.</p>
                {d.pos.precision != null && (
                  <p className={`rounded-xl p-3 text-sm ${d.pos.precision > 50 ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800"}`}>
                    Precisión del GPS: {Math.round(d.pos.precision)} m{d.pos.precision > 50 && ". Es baja: sal a un lugar abierto y vuelve a intentar."}
                  </p>
                )}
              </>
            ) : (
              <p className="text-stone-600 dark:text-stone-300">Párate en la tortillería y toca el botón para marcar el punto.</p>
            )}
          </>
        )}

        {id === "foto" && (
          <>
            {d.fotoUrl && <img src={d.fotoUrl} alt="Vista previa de la tortillería" className="max-h-80 w-full rounded-2xl object-cover" />}
            <label className="block">
              <span className="grid min-h-14 w-full cursor-pointer place-items-center rounded-2xl bg-guinda px-5 text-lg font-semibold text-white">
                {d.foto ? "📷 Repetir foto" : "📷 Tomar foto"}
              </span>
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => tomarFoto(e.target.files?.[0])} />
            </label>
            <p className="text-sm text-stone-500">{d.nueva ? "La foto es obligatoria para tortillerías nuevas." : "La foto es opcional para tortillerías que ya existen."}</p>
          </>
        )}

        {id === "responsable" && (
          <>
            {!d.nueva && (
              <Opcion activo={d.omitirResponsable} onClick={() => set({ omitirResponsable: !d.omitirResponsable })}>
                {d.omitirResponsable ? "✓ Omitir (ya se capturó antes)" : "Omitir este paso"}
              </Opcion>
            )}
            {respRequerido && (
              <>
                <Campo etiqueta="Nombre(s)" value={d.resp.nombre} onChange={(e) => setResp({ nombre: e.target.value })} error={errResp("nombre")} autoComplete="off" />
                <Campo etiqueta="Apellidos" value={d.resp.apellidos} onChange={(e) => setResp({ apellidos: e.target.value })} error={errResp("apellidos")} autoComplete="off" />
                <div className="grid grid-cols-2 gap-2">
                  <Opcion activo={d.resp.tipoPersona === "fisica"} onClick={() => setResp({ tipoPersona: "fisica", rfc: "" })}>Persona física</Opcion>
                  <Opcion activo={d.resp.tipoPersona === "moral"} onClick={() => setResp({ tipoPersona: "moral", rfc: "" })}>Persona moral</Opcion>
                </div>
                {d.resp.tipoPersona === "moral" && <Campo etiqueta="Razón social" value={d.resp.razonSocial} onChange={(e) => setResp({ razonSocial: e.target.value })} />}
                <Campo etiqueta="CURP" value={d.resp.curp} maxLength={18} autoCapitalize="characters" autoComplete="off" onChange={(e) => setResp({ curp: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} error={errResp("curp")} />
                <Campo etiqueta="RFC" value={d.resp.rfc} maxLength={d.resp.tipoPersona === "fisica" ? 13 : 12} autoCapitalize="characters" autoComplete="off" onChange={(e) => setResp({ rfc: e.target.value.toUpperCase().replace(/[^A-ZÑ&0-9]/g, "") })} error={errResp("rfc")} ayuda={d.resp.tipoPersona === "fisica" ? "13 caracteres" : "12 caracteres"} />
                <Campo etiqueta="Teléfono (10 dígitos)" value={d.resp.telefono} inputMode="numeric" maxLength={10} autoComplete="off" onChange={(e) => setResp({ telefono: e.target.value.replace(/\D/g, "").slice(0, 10) })} error={errResp("telefono")} />
                <label className="flex items-start gap-3 rounded-2xl bg-white p-4 dark:bg-stone-800">
                  <input type="checkbox" className="mt-1 h-6 w-6 accent-guinda" checked={d.aviso} onChange={(e) => set({ aviso: e.target.checked })} />
                  <span className="text-sm">El responsable fue informado y acepta el aviso de privacidad para el tratamiento de sus datos personales.</span>
                </label>
              </>
            )}
          </>
        )}

        {id === "precio" && (
          <>
            {PRODUCTOS.map((p) => <Opcion key={p.id} activo={d.producto === p.id} onClick={() => set({ producto: p.id })}>{p.texto}</Opcion>)}
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-stone-600 dark:text-stone-300">Precio por kilo (MXN)</span>
              <input
                inputMode="decimal"
                value={d.precio}
                onChange={(e) => set({ precio: e.target.value.replace(/[^0-9.,]/g, "").slice(0, 6) })}
                placeholder="0.00"
                className="w-full rounded-2xl border-2 border-stone-200 bg-white px-4 py-5 text-center text-5xl font-bold outline-none focus:border-guinda dark:border-stone-700 dark:bg-stone-800"
              />
            </label>
            {d.precio !== "" && !precioOk && <p className="text-sm text-red-600">El precio debe estar entre ${PRECIO_MIN} y ${PRECIO_MAX}.</p>}
          </>
        )}

        {id === "resumen" && (
          <dl className="space-y-3 rounded-2xl bg-white p-4 text-lg dark:bg-stone-800">
            <Fila k="Lugar" v={`${d.municipio?.nombre}, ${d.estado?.nombre}`} />
            <Fila k="Tortillería" v={d.nueva ? `${d.nombreNueva} (nueva)` : d.tortilleria?.nombre ?? ""} />
            <Fila k="Producto" v={PRODUCTOS.find((p) => p.id === d.producto)!.texto} />
            <Fila k="Precio" v={`$${precioNum.toFixed(2)} / kg`} />
            <Fila k="Foto" v={d.foto ? "Incluida" : "Sin foto"} />
            <Fila k="Responsable" v={respRequerido ? `${d.resp.nombre} ${d.resp.apellidos}` : "No se captura"} />
          </dl>
        )}

        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
      </main>

      <footer className="sticky bottom-0 flex gap-3 border-t border-stone-200 bg-stone-50/95 p-4 backdrop-blur dark:border-stone-700 dark:bg-stone-900/95">
        {paso > 0 ? <Boton variante="secundario" className="!w-1/3" onClick={() => ir(-1)}>Atrás</Boton> : <Boton variante="fantasma" className="!w-1/3" onClick={salir}>Salir</Boton>}
        {id === "resumen" ? (
          <Boton onClick={enviar} disabled={enviando}>{enviando ? "Enviando…" : "Enviar captura"}</Boton>
        ) : (
          <Boton onClick={() => ir(1)} disabled={!puede[id]}>Continuar</Boton>
        )}
      </footer>
    </Pantalla>
  );
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-stone-100 pb-2 last:border-0 dark:border-stone-700">
      <dt className="text-stone-500">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

function ListaBuscable({ items, sel, alElegir }: { items: Item[]; sel?: Item; alElegir: (i: Item) => void }) {
  const [q, setQ] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const filtrados = items.filter((i) => norm(i.nombre).includes(norm(q)));
  return (
    <>
      <Campo etiqueta="Buscar" value={q} onChange={(e) => setQ(e.target.value)} />
      {filtrados.slice(0, 80).map((i) => <Opcion key={i.clave} activo={sel?.clave === i.clave} onClick={() => alElegir(i)}>{i.nombre}</Opcion>)}
    </>
  );
}
