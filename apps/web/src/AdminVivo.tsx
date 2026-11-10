import { useEffect, useRef, useState } from "react";

/* ---------------------------------------------------------------------------------------------------------------
 * Información al momento: cada vista se actualiza sola mientras la pantalla está visible y al volver a ella.
 * --------------------------------------------------------------------------------------------------------------- */

/** Ejecuta `cargar` al montar, cada `ms` milisegundos mientras la pestaña esté visible y al volver a primer plano. Devuelve la hora de la última carga buena. */
export function useVivo(cargar: () => Promise<unknown> | void, ms: number, deps: unknown[] = []) {
  const [ultima, setUltima] = useState<number>();
  const [fallo, setFallo] = useState(false);
  const fn = useRef(cargar);
  fn.current = cargar;

  useEffect(() => {
    let vivo = true;
    const correr = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        await fn.current();
        if (vivo) {
          setUltima(Date.now());
          setFallo(false);
        }
      } catch {
        if (vivo) setFallo(true);
      }
    };
    correr();
    const t = setInterval(correr, ms);
    const alVolver = () => document.visibilityState === "visible" && correr();
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("online", correr);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", correr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);

  return { ultima, fallo };
}

const hace = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return "ahora";
  if (s < 60) return `hace ${s} s`;
  return `hace ${Math.round(s / 60)} min`;
};

/** Indicador "En vivo" con la hora de la última actualización */
export function EnVivo({ ultima, fallo, oscuro }: { ultima?: number; fallo?: boolean; oscuro?: boolean }) {
  const [, tic] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tic((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${
        oscuro ? "bg-white/10 text-white/90 ring-white/20" : "bg-white text-stone-600 ring-stone-200"
      }`}
      title="Los datos se actualizan solos"
    >
      <span className="relative flex h-2 w-2">
        {!fallo && ultima && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${fallo ? "bg-red-500" : ultima ? "bg-emerald-500" : "bg-stone-400"}`} />
      </span>
      {fallo ? "Sin conexión" : ultima ? `En vivo · ${hace(ultima)}` : "Cargando…"}
    </span>
  );
}

/* ---------------------------------------------------------------------------------------------------------------
 * Formato y color
 * --------------------------------------------------------------------------------------------------------------- */

export const dinero = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
export const entero = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("es-MX"));
export const diaCorto = (s: string) => {
  const [a, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
};

export const COLOR_BAJO = "#2f9e5a";
export const COLOR_MEDIO = "#e2b13a";
export const COLOR_ALTO = "#9D2449";

/** Color de un precio dentro del rango visible: verde (barato) → amarillo → guinda (caro) */
export function colorPrecio(p: number, lo: number, hi: number) {
  if (hi <= lo) return COLOR_MEDIO;
  const t = Math.min(1, Math.max(0, (p - lo) / (hi - lo)));
  const mezcla = (a: string, b: string, k: number) => {
    const x = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const y = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join("");
  };
  return t < 0.5 ? mezcla(COLOR_BAJO, COLOR_MEDIO, t * 2) : mezcla(COLOR_MEDIO, COLOR_ALTO, (t - 0.5) * 2);
}

/** Percentil 10 y 90 de una lista de precios (para que unos pocos extremos no aplasten la escala de color) */
export function rangoPrecios(precios: number[], porDefecto: [number, number] = [20, 32]): [number, number] {
  if (precios.length < 2) return precios.length === 1 ? [precios[0] - 2, precios[0] + 2] : porDefecto;
  const o = [...precios].sort((a, b) => a - b);
  const q = (p: number) => o[Math.min(o.length - 1, Math.max(0, Math.round((o.length - 1) * p)))];
  const lo = q(0.1);
  const hi = q(0.9);
  return hi - lo < 0.5 ? [lo - 1, hi + 1] : [lo, hi];
}

/* ---------------------------------------------------------------------------------------------------------------
 * Gráfica de tendencia (SVG, sin librerías): promedio diario de maíz y masa
 * --------------------------------------------------------------------------------------------------------------- */

export type DiaPrecio = { fecha: string; maiz: number | null; masa: number | null; n: number };

export function Tendencia({ datos, alto = 200 }: { datos: DiaPrecio[]; alto?: number }) {
  const [sobre, setSobre] = useState<number>();
  const ancho = 640;
  const m = { t: 14, r: 14, b: 26, l: 44 };
  const valores = datos.flatMap((d) => [d.maiz, d.masa]).filter((v): v is number => v != null);
  if (datos.length === 0 || valores.length === 0)
    return <div className="grid place-items-center rounded-xl bg-stone-50 text-sm text-stone-400" style={{ height: alto }}>Todavía no hay precios en este periodo.</div>;

  let lo = Math.min(...valores);
  let hi = Math.max(...valores);
  if (hi - lo < 1) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.12;
  lo -= pad;
  hi += pad;
  const x = (i: number) => m.l + (datos.length === 1 ? (ancho - m.l - m.r) / 2 : (i * (ancho - m.l - m.r)) / (datos.length - 1));
  const y = (v: number) => m.t + ((hi - v) / (hi - lo)) * (alto - m.t - m.b);
  const linea = (k: "maiz" | "masa") => {
    let d = "";
    datos.forEach((p, i) => {
      if (p[k] == null) return;
      d += `${d && datos[i - 1]?.[k] != null ? "L" : "M"}${x(i).toFixed(1)},${y(p[k]!).toFixed(1)}`;
    });
    return d;
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + (hi - lo) * t);
  const etiquetas = datos.length <= 6 ? datos.map((_, i) => i) : [0, Math.floor(datos.length / 3), Math.floor((2 * datos.length) / 3), datos.length - 1];
  const h = sobre != null ? datos[sobre] : undefined;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${ancho} ${alto}`}
        className="w-full touch-pan-y select-none"
        role="img"
        aria-label="Tendencia del precio promedio de tortilla y masa"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * ancho;
          const i = Math.round(((px - m.l) / (ancho - m.l - m.r)) * (datos.length - 1));
          setSobre(Math.min(datos.length - 1, Math.max(0, i)));
        }}
        onPointerLeave={() => setSobre(undefined)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={ancho - m.r} y1={y(t)} y2={y(t)} stroke="#e7e5e4" strokeWidth="1" />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#78716c">${t.toFixed(0)}</text>
          </g>
        ))}
        {etiquetas.map((i) => (
          <text key={i} x={x(i)} y={alto - 6} textAnchor={i === 0 ? "start" : i === datos.length - 1 ? "end" : "middle"} fontSize="11" fill="#78716c">{diaCorto(datos[i].fecha)}</text>
        ))}
        <path d={linea("masa")} fill="none" stroke="#235b4e" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={linea("maiz")} fill="none" stroke={COLOR_ALTO} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {datos.map((d, i) => (
          <g key={d.fecha}>
            {d.masa != null && <circle cx={x(i)} cy={y(d.masa)} r={sobre === i ? 5 : 3} fill="#235b4e" stroke="#fff" strokeWidth="1.5" />}
            {d.maiz != null && <circle cx={x(i)} cy={y(d.maiz)} r={sobre === i ? 5 : 3} fill={COLOR_ALTO} stroke="#fff" strokeWidth="1.5" />}
          </g>
        ))}
        {sobre != null && <line x1={x(sobre)} x2={x(sobre)} y1={m.t} y2={alto - m.b} stroke="#a8a29e" strokeDasharray="3 3" />}
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-600">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR_ALTO }} /> Tortilla</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#235b4e]" /> Masa</span>
        {h ? (
          <span className="ml-auto font-semibold text-stone-800">
            {diaCorto(h.fecha)} · Tortilla {dinero(h.maiz)} · Masa {dinero(h.masa)} · {h.n} capturas
          </span>
        ) : (
          <span className="ml-auto text-stone-400">Toca o pasa el cursor sobre la gráfica</span>
        )}
      </div>
    </div>
  );
}

/** Barra horizontal proporcional (promedios por estado, etc.) */
export function BarraValor({ valor, max, color = "from-guinda to-dorado" }: { valor: number; max: number; color?: string }) {
  return (
    <div className="h-2 overflow-hidden rounded-full bg-stone-100">
      <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700`} style={{ width: `${Math.max(2, (valor / Math.max(max, 0.0001)) * 100)}%` }} />
    </div>
  );
}
