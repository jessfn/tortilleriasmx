import { useEffect, useMemo, useState } from "react";
import { MOTIVOS_SIN_FISCAL, textoMotivoSinFiscal } from "@tortillerias/shared";
import { ArrowDown, ArrowUp, ChevronRight, Download, FileSpreadsheet, FileX, Layers, Loader2, Map as MapaIcono, Store, Wheat } from "lucide-react";
import { api, apiDescargar } from "./api";
import { dinero, entero, EnVivo, Tendencia, useVivo, type DiaPrecio } from "./AdminVivo";
import { BarraValor } from "./AdminVivo";
import type { FilaZona, FocoMapa } from "./AdminMapa";
import { Tarjeta } from "./ui";

const PERIODOS: [number, string][] = [[7, "7 días"], [30, "30 días"], [90, "90 días"], [0, "Todo"]];
type Orden = "nombre" | "tortillerias" | "nuevas" | "denue_visitadas" | "con_precios" | "capturas" | "promedio" | "minimo" | "maximo";

/** Estadísticas por estado y municipio, con tendencia, exportación y salto al mapa */
export default function AdminEstadisticas({ alMapa, puedeExportar = true }: { alMapa: (f: FocoMapa) => void; puedeExportar?: boolean }) {
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
  }, 30_000, [dias, estado?.clave]);

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
    const encabezado = [estado ? "Municipio" : "Estado", "Tortillerías", "Nuevas", "DENUE visitadas", "Con precios", "Capturas", "Tortilla promedio", "Tortilla mínimo", "Tortilla máximo", "Masa promedio", "Masa mínimo", "Masa máximo"];
    const cel = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lineas = (filas ?? []).map((f) =>
      [f.nombre, f.tortillerias, f.nuevas ?? 0, f.denue_visitadas ?? 0, f.con_precios, f.capturas, f.maiz?.promedio, f.maiz?.minimo, f.maiz?.maximo, f.masa?.promedio, f.masa?.minimo, f.masa?.maximo].map(cel).join(","),
    );
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
        <Tarjeta className="overflow-hidden !p-0">
          {!filas ? (
            <div className="grid place-items-center py-16 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : filas.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-stone-500">Todavía no hay información en este periodo.</p>
          ) : (
            <>
              {/* Computadora y tableta */}
              <div className="hidden max-h-[calc(100dvh-24rem)] min-h-[16rem] overflow-auto md:block">
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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

        <SinFiscal estado={estado} />
        </div>
      </div>
    </>
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
