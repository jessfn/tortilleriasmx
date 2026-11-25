import { useEffect, useMemo, useState } from "react";
import { CUESTIONARIO_VERSION, ELABORACION, MOTIVOS_BAJA, MOTIVOS_SIN_FISCAL, textoMotivoBaja, textoMotivoNoAplica, textoMotivoSinFiscal } from "@tortillerias/shared";
import { ArrowDown, ArrowUp, Ban, BookOpen, ChevronRight, ClipboardCheck, Cog, Download, FileSpreadsheet, FileX, Layers, Loader2, Map as MapaIcono, Store, Wheat } from "lucide-react";
import { api, apiDescargar } from "./api";
import { dinero, entero, EnVivo, Tendencia, useVivo, type DiaPrecio } from "./AdminVivo";
import { BarraValor } from "./AdminVivo";
import type { FilaZona, FocoMapa } from "./AdminMapa";
import { Tarjeta } from "./ui";

const PERIODOS: [number, string][] = [[7, "7 días"], [30, "30 días"], [90, "90 días"], [0, "Todo"]];
type Orden = "nombre" | "tortillerias" | "nuevas" | "denue_visitadas" | "con_precios" | "capturas" | "promedio" | "minimo" | "maximo";

type IndCuest = {
  nacional: { visitadas: number; aplicados: number; no_aplicados: number; porcentaje: number };
  estados: { clave: string; nombre: string; visitadas: number; aplicados: number; porcentaje: number }[];
  municipios: { clave: string; nombre: string; visitadas: number; aplicados: number; porcentaje: number }[] | null;
  motivos: { motivo: string; n: number }[];
};

/** Estadísticas por estado y municipio, con tendencia, exportación y salto al mapa. `esAdmin` (DGTIC) suma el avance del cuestionario (C21.9: solo DGTIC). */
export default function AdminEstadisticas({ alMapa, puedeExportar = true, esAdmin = false }: { alMapa: (f: FocoMapa) => void; puedeExportar?: boolean; esAdmin?: boolean }) {
  const [cuest, setCuest] = useState<IndCuest>();
  const [dias, setDias] = useState(30);
  const [producto, setProducto] = useState<"maiz" | "masa">("maiz");
  const [estado, setEstado] = useState<FilaZona>();
  const [filas, setFilas] = useState<FilaZona[]>();
  const [tendencia, setTendencia] = useState<DiaPrecio[]>([]);
  const [orden, setOrden] = useState<Orden>("capturas");
  const [asc, setAsc] = useState(false);

  const vivo = useVivo(async () => {
    const [f, t] = await Promise.all([
      api<FilaZona[]>(`/admin/estadisticas?dias=${dias}${estado ? `&estado=${estado.clave}` : ""}`),
      api<DiaPrecio[]>(`/admin/tendencia?dias=${dias || 365}${estado ? `&estado=${estado.clave}` : ""}`),
    ]);
    setFilas(f);
    setTendencia(t);
    // C21: solo DGTIC; la API responde 403 a cualquier otro rol
    if (esAdmin) setCuest(await api<IndCuest>(`/admin/cuestionarios/indicadores${estado ? `?estado=${estado.clave}` : ""}`).catch(() => undefined));
  }, 30_000, [dias, estado?.clave, esAdmin]);
  /** % con cuestionario aplicado de cada zona de la tabla (estado o, con un estado elegido, municipio) */
  const pctCuest = useMemo(() => {
    const l = estado ? cuest?.municipios : cuest?.estados;
    return new Map((l ?? []).map((z) => [z.clave, z]));
  }, [cuest, estado]);

  const valor = (f: FilaZona, k: Orden): number | string => {
    if (k === "nombre") return f.nombre;
    if (k === "tortillerias" || k === "con_precios" || k === "capturas") return f[k];
    if (k === "nuevas" || k === "denue_visitadas") return f[k] ?? 0;
    return f[producto]?.[k] ?? -1;
  };
  const ordenadas = useMemo(() => {
    const l = [...(filas ?? [])];
    l.sort((a, b) => {
      const x = valor(a, orden);
      const y = valor(b, orden);
      const c = typeof x === "string" ? x.localeCompare(String(y), "es") : (x as number) - (y as number);
      return asc ? c : -c;
    });
    return l;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, orden, asc, producto]);

  const totales = useMemo(() => {
    const f = filas ?? [];
    // Promedio entre tortillerías (una tortillería = un valor): cada zona pesa por las tortillerías con las que se promedió, no por sus capturas
    const conteo = f.reduce((a, x) => a + (x[producto]?.tortillerias ?? 0), 0);
    const ponderado = f.reduce((a, x) => a + (x[producto] ? x[producto]!.promedio * (x[producto]!.tortillerias ?? 0) : 0), 0);
    return {
      tortillerias: f.reduce((a, x) => a + x.tortillerias, 0),
      nuevas: f.reduce((a, x) => a + (x.nuevas ?? 0), 0),
      denue: f.reduce((a, x) => a + (x.denue_visitadas ?? 0), 0),
      con: f.reduce((a, x) => a + x.con_precios, 0),
      capturas: f.reduce((a, x) => a + x.capturas, 0),
      promedio: conteo ? ponderado / conteo : null,
      zonas: f.length,
    };
  }, [filas, producto]);

  const maxProm = Math.max(0, ...(filas ?? []).map((f) => f[producto]?.promedio ?? 0));
  const ordenarPor = (k: Orden) => {
    if (orden === k) setAsc(!asc);
    else {
      setOrden(k);
      setAsc(k === "nombre");
    }
  };

  const abrir = (f: FilaZona) => {
    if (!estado) {
      setEstado(f);
      setFilas(undefined);
      setOrden("capturas");
      setAsc(false);
    } else alMapa({ bbox: f.bbox, estado: estado.clave, municipio: f.clave, n: f.tortillerias });
  };

  const [descargando, setDescargando] = useState(false);
  const [errorDescarga, setErrorDescarga] = useState("");
  /** Baja la base de capturas (una fila por precio, sin datos personales) con los filtros que están en pantalla: estado y periodo */
  async function descargarCapturas() {
    setDescargando(true);
    setErrorDescarga("");
    try {
      const p = new URLSearchParams();
      if (estado) p.set("estado", estado.clave);
      if (dias > 0) {
        const d = new Date(Date.now() - dias * 86400000);
        p.set("desde", `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      }
      await apiDescargar(`/admin/exportar/capturas?${p}`, "capturas.csv");
    } catch (e: any) {
      setErrorDescarga(e.message);
    } finally {
      setDescargando(false);
    }
  }

  function exportar() {
    const conCuest = esAdmin && !!cuest;
    const encabezado = [
      estado ? "Municipio" : "Estado", "Tortillerías", "Nuevas", "DENUE visitadas", "Con precios", "Capturas", "Tortilla promedio", "Tortilla mínimo", "Tortilla máximo", "Masa promedio", "Masa mínimo", "Masa máximo",
      ...(conCuest ? ["Visitadas (cuestionario)", "Con cuestionario", "Con cuestionario (%)"] : []),
    ];
    const cel = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lineas = (filas ?? []).map((f) => {
      const z = pctCuest.get(f.clave);
      return [
        f.nombre, f.tortillerias, f.nuevas ?? 0, f.denue_visitadas ?? 0, f.con_precios, f.capturas, f.maiz?.promedio, f.maiz?.minimo, f.maiz?.maximo, f.masa?.promedio, f.masa?.minimo, f.masa?.maximo,
        ...(conCuest ? [z?.visitadas ?? 0, z?.aplicados ?? 0, z?.porcentaje ?? 0] : []),
      ].map(cel).join(",");
    });
    const blob = new Blob(["﻿" + [encabezado.map(cel).join(","), ...lineas].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `estadisticas-${estado ? estado.nombre.toLowerCase().replace(/\s+/g, "-") : "estados"}-${dias === 0 ? "todo" : dias + "d"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const chip = (on: boolean) => `shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${on ? "bg-guinda text-white shadow" : "bg-white text-stone-600 ring-1 ring-stone-200"}`;
  const Th = ({ k, children, der }: { k: Orden; children: string; der?: boolean }) => (
    <th scope="col" className={`px-3 py-2.5 font-semibold ${der ? "text-right" : "text-left"}`}>
      <button onClick={() => ordenarPor(k)} className={`inline-flex items-center gap-1 hover:text-guinda ${orden === k ? "text-guinda" : ""}`}>
        {children}
        {orden === k && (asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Ubicación" className="flex min-w-0 items-center gap-1 text-sm">
          <button onClick={() => { setEstado(undefined); setFilas(undefined); }} className={`font-bold ${estado ? "text-guinda hover:underline" : ""}`}>Todos los estados</button>
          {estado && (
            <>
              <ChevronRight className="h-4 w-4 text-stone-400" aria-hidden />
              <span className="truncate font-bold">{estado.nombre}</span>
            </>
          )}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <EnVivo ultima={vivo.ultima} fallo={vivo.fallo} />
          {estado && (
            <button onClick={() => alMapa({ bbox: estado.bbox, estado: estado.clave, n: estado.tortillerias })} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-guinda ring-1 ring-stone-200 hover:ring-guinda/40">
              <MapaIcono className="h-4 w-4" aria-hidden /> Ver en el mapa
            </button>
          )}
          <button onClick={exportar} disabled={!filas?.length} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-stone-700 ring-1 ring-stone-200 hover:ring-guinda/40 disabled:opacity-40">
            <Download className="h-4 w-4" aria-hidden /> Descargar CSV
          </button>
          {puedeExportar && <button onClick={descargarCapturas} disabled={descargando} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-guinda px-3 text-xs font-semibold text-white shadow-sm active:scale-95 disabled:opacity-60">
            {descargando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="h-4 w-4" aria-hidden />} Descargar capturas (CSV)
          </button>}
        </div>
      </div>

      {errorDescarga && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">{errorDescarga}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">{PERIODOS.map(([d, t]) => <button key={d} className={chip(dias === d)} onClick={() => setDias(d)}>{t}</button>)}</div>
        <div className="ml-auto grid grid-cols-2 gap-1 rounded-xl bg-stone-200/70 p-1" role="tablist" aria-label="Producto">
          {([["maiz", "Tortilla", Wheat], ["masa", "Masa", Layers]] as const).map(([id, t, I]) => (
            <button key={id} role="tab" aria-selected={producto === id} onClick={() => setProducto(id)} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${producto === id ? "bg-white text-guinda shadow" : "text-stone-500"}`}>
              <I className="h-4 w-4" aria-hidden /> {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          ["Tortillerías", entero(totales.tortillerias), `en ${entero(totales.zonas)} ${estado ? "municipios" : "estados"}`],
          ["Con precios", entero(totales.con), totales.tortillerias ? `${((totales.con / totales.tortillerias) * 100).toFixed(2)} % del total` : ""],
          ["Capturas", entero(totales.capturas), dias === 0 ? "todo el historial" : `últimos ${dias} días`],
          [`Promedio de ${producto === "maiz" ? "tortilla" : "masa"}`, dinero(totales.promedio), "promedio entre tortillerías"],
        ].map(([t, v, s]) => (
          <Tarjeta key={t}>
            <div className="text-xs font-medium text-stone-500">{t}</div>
            <div className="mt-0.5 text-2xl font-bold leading-tight">{v}</div>
            <div className="text-[11px] text-stone-400">{s}</div>
          </Tarjeta>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* En computadora la tarjeta se estira a lo largo de la columna de la derecha y la tabla llena todo su alto (se desplaza por dentro): sin espacio en blanco */}
        <Tarjeta className="flex flex-col overflow-hidden !p-0">
          {!filas ? (
            <div className="grid place-items-center py-16 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : filas.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-stone-500">Todavía no hay información en este periodo.</p>
          ) : (
            <>
              {/* Computadora y tableta */}
              <div className="hidden max-h-[calc(100dvh-24rem)] min-h-[16rem] overflow-auto md:block xl:relative xl:max-h-none xl:flex-1 xl:overflow-hidden">
                <div className="xl:absolute xl:inset-0 xl:overflow-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="sticky top-0 z-10 bg-stone-50 text-xs text-stone-500 shadow-[0_1px_0_#e7e5e4]">
                    <tr>
                      <Th k="nombre">{estado ? "Municipio" : "Estado"}</Th>
                      <Th k="tortillerias" der>Tortillerías</Th>
                      <Th k="nuevas" der>Nuevas</Th>
                      <Th k="denue_visitadas" der>DENUE visitadas</Th>
                      <Th k="con_precios" der>Con precios</Th>
                      <Th k="capturas" der>Capturas</Th>
                      <Th k="promedio" der>{`Promedio ${producto === "maiz" ? "tortilla" : "masa"}`}</Th>
                      <Th k="minimo" der>Mín.</Th>
                      <Th k="maximo" der>Máx.</Th>
                      {esAdmin && cuest && <th scope="col" className="px-3 py-2.5 text-right font-semibold" title="Tortillerías visitadas con cuestionario aplicado">Cuestionario</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {ordenadas.map((f) => {
                      const s = f[producto];
                      return (
                        <tr key={f.clave} onClick={() => abrir(f)} className="cursor-pointer border-t border-stone-100 transition hover:bg-guinda/5">
                          <td className="px-3 py-2.5 font-medium">{f.nombre}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{entero(f.tortillerias)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{entero(f.nuevas ?? 0)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{entero(f.denue_visitadas ?? 0)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{entero(f.con_precios)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{entero(f.capturas)}</td>
                          <td className="w-44 px-3 py-2.5">
                            {s ? (
                              <div className="flex items-center gap-2"><div className="w-20 flex-1"><BarraValor valor={s.promedio} max={maxProm} /></div><span className="w-14 text-right font-semibold tabular-nums">{dinero(s.promedio)}</span></div>
                            ) : (
                              <span className="block text-right text-stone-300">sin datos</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{dinero(s?.minimo)}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-guinda">{dinero(s?.maximo)}</td>
                          {esAdmin && cuest && (
                            <td className="px-3 py-2.5 text-right tabular-nums">
                              {pctCuest.get(f.clave) ? <span className={pctCuest.get(f.clave)!.porcentaje >= 80 ? "font-semibold text-emerald-700" : "font-semibold text-stone-700"}>{pctCuest.get(f.clave)!.porcentaje} %</span> : <span className="text-stone-300">—</span>}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>

              {/* Celular */}
              <ul className="divide-y divide-stone-100 md:hidden">
                {ordenadas.map((f) => {
                  const s = f[producto];
                  return (
                    <li key={f.clave}>
                      <button onClick={() => abrir(f)} className="block w-full space-y-1.5 px-3 py-3 text-left active:bg-guinda/5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-semibold">{f.nombre}</span>
                          <span className="shrink-0 text-base font-bold">{dinero(s?.promedio)}</span>
                        </div>
                        {s && <BarraValor valor={s.promedio} max={maxProm} />}
                        <div className="flex flex-wrap gap-x-3 text-xs text-stone-500">
                          <span><Store className="mr-0.5 inline h-3 w-3" aria-hidden />{entero(f.tortillerias)}</span>
                          <span>{entero(f.denue_visitadas ?? 0)} DENUE visitadas</span>
                          <span>{entero(f.nuevas ?? 0)} nuevas</span>
                          <span>{entero(f.con_precios)} con precios</span>
                          <span>{entero(f.capturas)} capturas</span>
                          {s && <span>{dinero(s.minimo)} – {dinero(s.maximo)}</span>}
                          {esAdmin && pctCuest.get(f.clave) && <span className="font-semibold text-stone-700">{pctCuest.get(f.clave)!.porcentaje} % con cuestionario</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Tarjeta>

        <div className="space-y-3 self-start">
        <Tarjeta className="space-y-2">
          <h2 className="text-sm font-bold">Tendencia {estado ? `· ${estado.nombre}` : "· nacional"}</h2>
          <Tendencia datos={tendencia} alto={220} />
          <p className="text-[11px] text-stone-400">Promedio diario de todas las capturas (sin contar las rechazadas).</p>
        </Tarjeta>

        {esAdmin && <Cuestionarios ind={cuest} estado={estado} />}
        <SinFiscal estado={estado} />
        <Bajas estado={estado} />
        <Elaboracion estado={estado} dias={dias} />
        </div>
      </div>
    </>
  );
}

/**
 * C21 · Avance del cuestionario (SOLO DGTIC): % de tortillerías visitadas con cuestionario aplicado, "no se pudo aplicar" por motivo
 * y la descarga para el análisis espacial (una fila por tortillería, con su diccionario de datos).
 */
function Cuestionarios({ ind, estado }: { ind?: IndCuest; estado?: FilaZona }) {
  const [bajando, setBajando] = useState<"" | "datos" | "dic">("");
  const [error, setError] = useState("");
  const z = estado ? ind?.estados.find((e) => e.clave === estado.clave) : ind?.nacional;
  const noAplicados = ind?.motivos.reduce((a, m) => a + m.n, 0) ?? 0;
  async function bajar(cual: "datos" | "dic") {
    setBajando(cual);
    setError("");
    try {
      if (cual === "dic") await apiDescargar("/admin/exportar/cuestionarios/diccionario", `cuestionarios-diccionario-${CUESTIONARIO_VERSION}.csv`);
      else await apiDescargar(`/admin/exportar/cuestionarios${estado ? `?estado=${estado.clave}` : ""}`, "cuestionarios.csv");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBajando("");
    }
  }
  return (
    <Tarjeta className="space-y-2.5">
      <h2 className="flex items-center gap-2 text-sm font-bold"><ClipboardCheck className="h-4 w-4 text-guinda" aria-hidden /> Cuestionario {estado ? `· ${estado.nombre}` : "· nacional"}</h2>
      {!ind ? (
        <div className="grid place-items-center py-6 text-stone-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-3xl font-bold leading-none tabular-nums">{z ? z.porcentaje : 0} %</div>
              <div className="mt-1 text-xs text-stone-500">{entero(z?.aplicados ?? 0)} de {entero(z?.visitadas ?? 0)} tortillerías visitadas</div>
            </div>
            {!estado && noAplicados > 0 && <div className="text-right text-xs text-stone-500"><b className="text-amber-700">{entero(noAplicados)}</b> sin aplicar<br />en el último intento</div>}
          </div>
          <BarraValor valor={z?.porcentaje ?? 0} max={100} />
          {!estado && ind.motivos.length > 0 && (
            <ul className="space-y-1 border-t border-stone-100 pt-2 text-xs">
              {ind.motivos.map((m) => (
                <li key={m.motivo} className="flex justify-between gap-2"><span className="text-stone-600">{textoMotivoNoAplica(m.motivo)}</span><b className="tabular-nums">{entero(m.n)}</b></li>
              ))}
            </ul>
          )}
          <div className="grid gap-1.5 pt-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <button onClick={() => bajar("datos")} disabled={!!bajando} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full bg-guinda px-3 text-xs font-semibold text-white shadow-sm active:scale-95 disabled:opacity-60">
              {bajando === "datos" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="h-4 w-4" aria-hidden />} Descargar cuestionarios
            </button>
            <button onClick={() => bajar("dic")} disabled={!!bajando} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-stone-700 ring-1 ring-stone-200 hover:ring-guinda/40 disabled:opacity-60">
              {bajando === "dic" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <BookOpen className="h-4 w-4" aria-hidden />} Diccionario de datos
            </button>
          </div>
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
          <p className="text-[11px] text-stone-400">Solo DGTIC ve las respuestas. La descarga no incluye RFC, razón social, celular ni CURP.</p>
        </>
      )}
    </Tarjeta>
  );
}

type ResumenSinFiscal = {
  total: number; sin_fiscal: number; porcentaje: number; por_motivo: Record<string, number>;
  zonas: { clave: string; nombre: string; tortillerias: number; sin_fiscal: number; porcentaje: number; por_motivo: Record<string, number> }[];
};

/** Tortillerías que no tienen datos fiscales, por qué y dónde (por estado o, con un estado elegido, por municipio) */
function SinFiscal({ estado }: { estado?: FilaZona }) {
  const [r, setR] = useState<ResumenSinFiscal>();
  useEffect(() => {
    let vigente = true;
    setR(undefined);
    api<ResumenSinFiscal>(`/admin/sin-fiscal${estado ? `?estado=${estado.clave}` : ""}`)
      .then((x) => vigente && setR(x))
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, [estado?.clave]);

  const motivos = [...MOTIVOS_SIN_FISCAL.map((m) => m.clave as string), "sin_intento"];
  const texto = (k: string) => (k === "sin_intento" ? "Sin registro de motivo" : textoMotivoSinFiscal(k));
  const maxMotivo = Math.max(1, ...motivos.map((k) => r?.por_motivo[k] ?? 0));
  return (
    <Tarjeta className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-100 text-amber-700"><FileX className="h-4 w-4" aria-hidden /></span>
        Sin datos fiscales {estado ? `· ${estado.nombre}` : ""}
      </h2>
      {!r ? (
        <div className="grid place-items-center py-4 text-stone-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold leading-none">{entero(r.sin_fiscal)}</span>
            <span className="text-xs text-stone-500">sin datos fiscales · <b className="text-stone-700">{r.porcentaje} %</b></span>
          </div>
          <p className="text-[11px] leading-snug text-stone-500">
            De las <b>{entero(r.total)} tortillerías visitadas</b>, <b>{entero(r.sin_fiscal)}</b> (<b>{r.porcentaje} %</b>) no tienen datos fiscales. Una tortillería está visitada si tiene un precio capturado, es nueva o tiene un intento sin datos.
          </p>
          <ul className="space-y-1.5">
            {motivos.filter((k) => r.por_motivo[k]).map((k) => (
              <li key={k} className="text-xs">
                <div className="flex justify-between gap-2"><span className="truncate">{texto(k)}</span><b>{entero(r.por_motivo[k])}</b></div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-amber-500" style={{ width: `${(r.por_motivo[k] / maxMotivo) * 100}%` }} /></div>
              </li>
            ))}
            {!Object.keys(r.por_motivo).length && <li className="text-xs text-stone-500">Todas las visitadas tienen datos fiscales.</li>}
          </ul>
          <div className="border-t border-stone-100 pt-2">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{estado ? "Por municipio" : "Por estado"}</p>
            <ul className="max-h-60 divide-y divide-stone-100 overflow-y-auto text-xs">
              {r.zonas.filter((z) => z.sin_fiscal > 0).slice(0, 30).map((z) => (
                <li key={z.clave} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate">{z.nombre}</span>
                  <span className="shrink-0 text-stone-500">
                    {Object.entries(z.por_motivo).filter(([k]) => k === "inseguridad").map(([, n]) => <span key="i" className="mr-2 rounded-full bg-red-50 px-1.5 py-0.5 text-red-700">{n} por inseguridad</span>)}
                    <b className="text-stone-800">{entero(z.sin_fiscal)}</b> ({z.porcentaje}%)
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </Tarjeta>
  );
}

type ResumenBajas = { total: number; por_motivo: Record<string, number>; zonas: { clave: string; nombre: string; total: number; por_motivo: Record<string, number> }[] };

/** Tortillerías dadas de baja ("ya no funcionan"): total, por motivo y por estado (o por municipio con un estado elegido) */
function Bajas({ estado }: { estado?: FilaZona }) {
  const [r, setR] = useState<ResumenBajas>();
  useEffect(() => {
    let vigente = true;
    setR(undefined);
    api<ResumenBajas>(`/admin/bajas/resumen${estado ? `?estado=${estado.clave}` : ""}`)
      .then((x) => vigente && setR(x))
      .catch(() => {});
    return () => { vigente = false; };
  }, [estado?.clave]);
  const maxMotivo = Math.max(1, ...MOTIVOS_BAJA.map((m) => r?.por_motivo[m.clave] ?? 0));
  return (
    <Tarjeta className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-red-50 text-red-700"><Ban className="h-4 w-4" aria-hidden /></span>
        Dadas de baja {estado ? `· ${estado.nombre}` : ""}
      </h2>
      {!r ? (
        <div className="grid place-items-center py-4 text-stone-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold leading-none">{entero(r.total)}</span>
            <span className="text-xs text-stone-500">tortillerías que ya no funcionan (salen del total del censo)</span>
          </div>
          <ul className="space-y-1.5">
            {MOTIVOS_BAJA.filter((m) => r.por_motivo[m.clave]).sort((a, b) => r.por_motivo[b.clave] - r.por_motivo[a.clave]).map((m) => (
              <li key={m.clave} className="text-xs">
                <div className="flex justify-between gap-2"><span className="truncate">{textoMotivoBaja(m.clave)}</span><b>{entero(r.por_motivo[m.clave])}</b></div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-stone-100"><div className="h-full rounded-full bg-red-400" style={{ width: `${(r.por_motivo[m.clave] / maxMotivo) * 100}%` }} /></div>
              </li>
            ))}
            {!r.total && <li className="text-xs text-stone-500">Ninguna tortillería dada de baja.</li>}
          </ul>
          {r.zonas.length > 0 && (
            <div className="border-t border-stone-100 pt-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{estado ? "Por municipio" : "Por estado"}</p>
              <ul className="max-h-48 divide-y divide-stone-100 overflow-y-auto text-xs">
                {r.zonas.slice(0, 30).map((z) => (
                  <li key={z.clave} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="min-w-0 truncate">{z.nombre}</span>
                    <b className="shrink-0 text-stone-800">{entero(z.total)}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Tarjeta>
  );
}

type ResumenElab = {
  nacional: { visitadas: Record<string, number>; promedio: Record<string, number | null> };
  zonas: { clave: string; nombre: string; visitadas: Record<string, number>; promedio: Record<string, number | null> }[];
};
const TIPOS_ELAB = [...ELABORACION.map((e) => ({ clave: e.clave as string, texto: e.corto })), { clave: "sin_dato", texto: "Sin dato" }];

/** Tortillerías visitadas por tipo de elaboración (y sin dato) y precio promedio de la tortilla por tipo, por estado o por municipio */
function Elaboracion({ estado, dias }: { estado?: FilaZona; dias: number }) {
  const [r, setR] = useState<ResumenElab>();
  useEffect(() => {
    let vigente = true;
    setR(undefined);
    api<ResumenElab>(`/admin/estadisticas/elaboracion?dias=${dias}${estado ? `&estado=${estado.clave}` : ""}`)
      .then((x) => vigente && setR(x))
      .catch(() => {});
    return () => { vigente = false; };
  }, [estado?.clave, dias]);
  const total = r ? TIPOS_ELAB.reduce((a, t) => a + (r.nacional.visitadas[t.clave] ?? 0), 0) : 0;
  return (
    <Tarjeta className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-guinda/10 text-guinda"><Cog className="h-4 w-4" aria-hidden /></span>
        Tipo de elaboración {estado ? `· ${estado.nombre}` : ""}
      </h2>
      {!r ? (
        <div className="grid place-items-center py-4 text-stone-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <>
          <ul className="space-y-2">
            {TIPOS_ELAB.map((t) => {
              const n = r.nacional.visitadas[t.clave] ?? 0;
              const p = r.nacional.promedio[t.clave];
              return (
                <li key={t.clave} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{t.texto}</span>
                    <span className="text-stone-500"><b className="text-stone-800">{entero(n)}</b> tortillerías · tortilla <b className="text-stone-800">{p == null ? "—" : dinero(p)}</b></span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-stone-100"><div className={`h-full rounded-full ${t.clave === "sin_dato" ? "bg-stone-400" : "bg-guinda"}`} style={{ width: `${total ? (n / total) * 100 : 0}%` }} /></div>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] leading-snug text-stone-500">Tortillerías visitadas (con al menos un precio que cuenta). El promedio es el último precio de cada tortillería en el periodo.</p>
          {r.zonas.length > 0 && (
            <div className="border-t border-stone-100 pt-2">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">{estado ? "Por municipio" : "Por estado"}</p>
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-white text-stone-400">
                    <tr><th className="py-1 text-left font-semibold">{estado ? "Municipio" : "Estado"}</th>{TIPOS_ELAB.map((t) => <th key={t.clave} className="px-1 py-1 text-right font-semibold">{t.texto}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {r.zonas.slice(0, 40).map((z) => (
                      <tr key={z.clave}>
                        <td className="max-w-[8rem] truncate py-1.5">{z.nombre}</td>
                        {TIPOS_ELAB.map((t) => (
                          <td key={t.clave} className="px-1 py-1.5 text-right tabular-nums">
                            <b className="text-stone-800">{entero(z.visitadas[t.clave] ?? 0)}</b>
                            {t.clave !== "sin_dato" && z.promedio[t.clave] != null && <span className="block text-stone-400">{dinero(z.promedio[t.clave] as number)}</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </Tarjeta>
  );
}
