import { z } from "zod";
import { textoElaboracion, textoMotivoBaja, textoMotivoSinFiscal } from "@tortillerias/shared";
import { pool } from "./db.js";

/* ===================== Periodos (siempre en hora de la Ciudad de México) ===================== */

export const ZONA = "America/Mexico_City";
export const PERIODOS = ["dia", "semana", "mes", "anio", "rango"] as const;
export type Periodo = (typeof PERIODOS)[number];
export type Granularidad = "hora" | "dia" | "mes";

export type Rango = {
  periodo: Periodo;
  /** Primer día incluido (YYYY-MM-DD) */
  desde: string;
  /** Último día incluido */
  hasta: string;
  /** Día siguiente al último: el periodo termina a las 11:59:59 p. m. del último día, o sea justo antes de las 12:00 a. m. de este día */
  hastaExcl: string;
  dias: number;
  granularidad: Granularidad;
  /** Periodo inmediatamente anterior, del mismo tamaño */
  ant: { desde: string; hastaExcl: string };
};

export const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MAX_DIAS_RANGO = 366;

const aFecha = (s: string) => new Date(`${s}T00:00:00Z`);
const aTexto = (d: Date) => d.toISOString().slice(0, 10);
export const sumar = (s: string, dias: number) => aTexto(new Date(aFecha(s).getTime() + dias * 86400000));
const diasEntre = (a: string, b: string) => Math.round((aFecha(b).getTime() - aFecha(a).getTime()) / 86400000);
const fechaValida = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && aTexto(aFecha(s)) === s;

/** Hoy en la Ciudad de México (YYYY-MM-DD) */
export const hoyMx = (ahora = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);

export const consultaSchema = z.object({
  periodo: z.enum(PERIODOS),
  fecha: z.string().refine(fechaValida, "Fecha inválida"),
  hasta: z.string().refine(fechaValida, "Fecha inválida").optional(),
  formato: z.enum(["pdf", "xlsx"]).default("pdf"),
});

/** Calcula el rango exacto. Devuelve un texto de error si la combinación no es válida. */
export function calcularRango(periodo: Periodo, fecha: string, hasta: string | undefined, hoy = hoyMx()): Rango | string {
  if (fecha > hoy) return "No se puede pedir un reporte de una fecha que aún no llega";
  let desde = fecha;
  let fin: string; // incluido
  let ant: { desde: string; hastaExcl: string };
  if (periodo === "dia") {
    fin = fecha;
    ant = { desde: sumar(fecha, -1), hastaExcl: fecha };
  } else if (periodo === "semana") {
    const dow = (aFecha(fecha).getUTCDay() + 6) % 7; // lunes = 0
    desde = sumar(fecha, -dow);
    fin = sumar(desde, 6);
    ant = { desde: sumar(desde, -7), hastaExcl: desde };
  } else if (periodo === "mes") {
    desde = `${fecha.slice(0, 7)}-01`;
    const d = aFecha(desde);
    const sig = aTexto(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
    fin = sumar(sig, -1);
    ant = { desde: aTexto(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))), hastaExcl: desde };
  } else if (periodo === "anio") {
    const a = Number(fecha.slice(0, 4));
    desde = `${a}-01-01`;
    fin = `${a}-12-31`;
    ant = { desde: `${a - 1}-01-01`, hastaExcl: desde };
  } else {
    if (!hasta) return "Elige la fecha final del rango";
    if (hasta < fecha) return "La fecha final no puede ser anterior a la inicial";
    if (hasta > hoy) return "La fecha final no puede ser futura";
    fin = hasta;
    const n = diasEntre(fecha, hasta) + 1;
    if (n > MAX_DIAS_RANGO) return `El rango puede ser de máximo ${MAX_DIAS_RANGO} días`;
    ant = { desde: sumar(fecha, -n), hastaExcl: fecha };
  }
  const dias = diasEntre(desde, fin) + 1;
  const granularidad: Granularidad = dias === 1 ? "hora" : periodo === "anio" || dias > 62 ? "mes" : "dia";
  return { periodo, desde, hasta: fin, hastaExcl: sumar(fin, 1), dias, granularidad, ant };
}

const fechaLarga = (s: string, conDia = false) => {
  const d = aFecha(s);
  return `${conDia ? DIAS[d.getUTCDay()] + " " : ""}${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
};
const mayus = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const corta = (s: string) => {
  const d = aFecha(s);
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;
};

/** Textos del encabezado del reporte */
export function textosRango(r: Rango) {
  let titulo: string;
  let tipo: string;
  if (r.periodo === "dia") {
    tipo = "Reporte diario de precios";
    titulo = mayus(fechaLarga(r.desde, true));
  } else if (r.periodo === "semana") {
    tipo = "Reporte semanal de precios";
    const a = aFecha(r.desde), b = aFecha(r.hasta);
    titulo = a.getUTCMonth() === b.getUTCMonth()
      ? `Semana del ${a.getUTCDate()} al ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]} de ${b.getUTCFullYear()}`
      : `Semana del ${a.getUTCDate()} de ${MESES[a.getUTCMonth()]} al ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]} de ${b.getUTCFullYear()}`;
  } else if (r.periodo === "mes") {
    tipo = "Reporte mensual de precios";
    titulo = mayus(`${MESES[aFecha(r.desde).getUTCMonth()]} de ${aFecha(r.desde).getUTCFullYear()}`);
  } else if (r.periodo === "anio") {
    tipo = "Reporte anual de precios";
    titulo = `Año ${r.desde.slice(0, 4)}`;
  } else {
    tipo = "Reporte de precios por rango de fechas";
    titulo = r.dias === 1 ? mayus(fechaLarga(r.desde, true)) : `Del ${corta(r.desde)} al ${corta(r.hasta)}`;
  }
  const horario =
    r.dias === 1
      ? "12:00 a. m. a 11:59 p. m. · hora de la Ciudad de México"
      : `Del ${corta(r.desde)}, 12:00 a. m. al ${corta(r.hasta)}, 11:59 p. m. · hora de la Ciudad de México`;
  const anterior = r.periodo === "dia" ? "ayer" : r.periodo === "semana" ? "la semana anterior" : r.periodo === "mes" ? "el mes anterior" : r.periodo === "anio" ? "el año anterior" : "el periodo anterior";
  const nombreArchivo = `TortilleriasMX_Reporte_${r.periodo}_${r.desde}${r.dias > 1 && r.periodo !== "semana" && r.periodo !== "mes" && r.periodo !== "anio" ? "_a_" + r.hasta : ""}`;
  const porUnidad = r.granularidad === "hora" ? "hora por hora" : r.granularidad === "dia" ? "día por día" : "mes por mes";
  return { titulo, tipo, horario, anterior, nombreArchivo, porUnidad };
}

/* ===================== Datos ===================== */

export type Estadistica = { tiendas: number; promedio: number | null; minimo: number | null; maximo: number | null };
export type FilaEstado = {
  clave: string; nombre: string; capturas: number; visitadas: number; nuevas: number; maiz: Estadistica; masa: Estadistica;
};
export type Totales = {
  capturas: number; visitadas: number; censadores: number; nuevas: number;
  capMaiz: number; capMasa: number; revisadas: number;
  maiz: Estadistica; masa: Estadistica;
};
export type Reporte = {
  rango: Rango;
  generado: string;
  totales: Totales;
  anterior: Totales;
  serie: { k: string; etiqueta: string; capturas: number; maiz: number | null; masa: number | null }[];
  estados: FilaEstado[];
  censo: { catalogo: number; conPrecio: number };
  motivos: { clave: string; texto: string; n: number }[];
  /** Actualización del catálogo: tortillerías que los censadores dieron de baja en el periodo */
  bajas: { total: number; porMotivo: { clave: string; texto: string; n: number }[]; porEstado: { clave: string; nombre: string; n: number }[] };
  /** Tipo de elaboración: tortillerías con precio en el periodo y precio promedio de la tortilla por tipo */
  elaboracion: { clave: string; texto: string; tortillerias: number; promedio: number | null }[];
};

const VENTANA = (desdeP: string, hastaP: string) =>
  `coalesce(p.capturado_en, p.creado_en) >= ${desdeP}::date::timestamp AT TIME ZONE '${ZONA}' AND coalesce(p.capturado_en, p.creado_en) < ${hastaP}::date::timestamp AT TIME ZONE '${ZONA}'`;
const MOMENTO = `(coalesce(p.capturado_en, p.creado_en) AT TIME ZONE '${ZONA}')`;
const VACIA: Estadistica = { tiendas: 0, promedio: null, minimo: null, maximo: null };
const est = (r: any): Estadistica => (r ? { tiendas: r.tiendas, promedio: r.prom == null ? null : Math.round(r.prom * 100) / 100, minimo: r.minimo, maximo: r.maximo } : { ...VACIA });

async function totalesDe(desde: string, hastaExcl: string): Promise<Totales> {
  const { rows: [t] } = await pool.query(
    `SELECT count(*)::int AS capturas, count(DISTINCT p.tortilleria_id)::int AS visitadas, count(DISTINCT p.capturista_id)::int AS censadores,
            (count(*) FILTER (WHERE p.producto = 'maiz'))::int AS cap_maiz, (count(*) FILTER (WHERE p.producto = 'masa'))::int AS cap_masa,
            (count(*) FILTER (WHERE p.aprobacion = 'manual'))::int AS revisadas
       FROM precios_que_cuentan p WHERE ${VENTANA("$1", "$2")}`,
    [desde, hastaExcl],
  );
  const { rows: [n] } = await pool.query(
    `SELECT count(*)::int AS n FROM tortillerias t
      WHERE t.origen = 'nueva' AND t.estatus <> 'rechazada'
        AND t.creado_en >= $1::date::timestamp AT TIME ZONE '${ZONA}' AND t.creado_en < $2::date::timestamp AT TIME ZONE '${ZONA}'`,
    [desde, hastaExcl],
  );
  // Promedio de cada producto: el último precio de cada tortillería en el periodo (una tortillería = un valor)
  const { rows } = await pool.query(
    `WITH u AS (
       SELECT DISTINCT ON (p.tortilleria_id, p.producto) p.tortilleria_id, p.producto, p.precio_kg::float8 AS precio
         FROM precios_que_cuentan p WHERE ${VENTANA("$1", "$2")}
        ORDER BY p.tortilleria_id, p.producto, coalesce(p.capturado_en, p.creado_en) DESC, p.creado_en DESC)
     SELECT producto, count(*)::int AS tiendas, avg(precio) AS prom, min(precio) AS minimo, max(precio) AS maximo FROM u GROUP BY producto`,
    [desde, hastaExcl],
  );
  return {
    capturas: t.capturas, visitadas: t.visitadas, censadores: t.censadores, nuevas: n.n,
    capMaiz: t.cap_maiz, capMasa: t.cap_masa, revisadas: t.revisadas,
    maiz: est(rows.find((r: any) => r.producto === "maiz")), masa: est(rows.find((r: any) => r.producto === "masa")),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
export const etiquetaHora = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? " a. m." : " p. m."}`;

/** Todo lo que lleva el reporte (PDF, Excel y vista previa salen de aquí) */
export async function reunirReporte(rango: Rango): Promise<Reporte> {
  const [totales, anterior] = await Promise.all([totalesDe(rango.desde, rango.hastaExcl), totalesDe(rango.ant.desde, rango.ant.hastaExcl)]);

  // Por estado: capturas, tortillerías visitadas, nuevas y promedios
  const porEstado = await pool.query(
    `SELECT p.estado_clave AS clave, count(*)::int AS capturas, count(DISTINCT p.tortilleria_id)::int AS visitadas
       FROM precios_que_cuentan p WHERE ${VENTANA("$1", "$2")} AND p.estado_clave IS NOT NULL GROUP BY p.estado_clave`,
    [rango.desde, rango.hastaExcl],
  );
  const nuevasEstado = await pool.query(
    `SELECT t.estado_clave AS clave, count(*)::int AS n FROM tortillerias t
      WHERE t.origen = 'nueva' AND t.estatus <> 'rechazada' AND t.estado_clave IS NOT NULL
        AND t.creado_en >= $1::date::timestamp AT TIME ZONE '${ZONA}' AND t.creado_en < $2::date::timestamp AT TIME ZONE '${ZONA}' GROUP BY t.estado_clave`,
    [rango.desde, rango.hastaExcl],
  );
  const promEstado = await pool.query(
    `WITH u AS (
       SELECT DISTINCT ON (p.tortilleria_id, p.producto) p.tortilleria_id, p.producto, p.estado_clave, p.precio_kg::float8 AS precio
         FROM precios_que_cuentan p WHERE ${VENTANA("$1", "$2")}
        ORDER BY p.tortilleria_id, p.producto, coalesce(p.capturado_en, p.creado_en) DESC, p.creado_en DESC)
     SELECT estado_clave AS clave, producto, count(*)::int AS tiendas, avg(precio) AS prom, min(precio) AS minimo, max(precio) AS maximo
       FROM u WHERE estado_clave IS NOT NULL GROUP BY estado_clave, producto`,
    [rango.desde, rango.hastaExcl],
  );
  const nombres = new Map<string, string>((await pool.query("SELECT clave, nombre FROM estados")).rows.map((e: any) => [e.clave, e.nombre]));
  const nuevasPor = new Map<string, number>(nuevasEstado.rows.map((r: any) => [r.clave, r.n]));
  // Siempre salen todos los estados, aunque no tengan capturas en el periodo
  const claves = new Set<string>([...nombres.keys()]);
  const estados: FilaEstado[] = [...claves].map((clave) => {
    const b = porEstado.rows.find((r: any) => r.clave === clave);
    return {
      clave, nombre: nombres.get(clave) ?? clave, capturas: b?.capturas ?? 0, visitadas: b?.visitadas ?? 0, nuevas: nuevasPor.get(clave) ?? 0,
      maiz: est(promEstado.rows.find((r: any) => r.clave === clave && r.producto === "maiz")),
      masa: est(promEstado.rows.find((r: any) => r.clave === clave && r.producto === "masa")),
    };
  }).sort((a, b) => b.capturas - a.capturas || a.nombre.localeCompare(b.nombre, "es"));

  // Serie en el tiempo: capturas y promedio de cada producto por hora, día o mes
  const bucket = rango.granularidad === "hora" ? `extract(hour from ${MOMENTO})::int::text` : rango.granularidad === "dia" ? `to_char(${MOMENTO}, 'YYYY-MM-DD')` : `to_char(${MOMENTO}, 'YYYY-MM')`;
  const sr = await pool.query(
    `WITH b AS (SELECT ${bucket} AS k, p.tortilleria_id, p.producto, p.precio_kg::float8 AS precio, coalesce(p.capturado_en, p.creado_en) AS m
                  FROM precios_que_cuentan p WHERE ${VENTANA("$1", "$2")}),
          u AS (SELECT DISTINCT ON (k, tortilleria_id, producto) k, producto, precio FROM b ORDER BY k, tortilleria_id, producto, m DESC)
     SELECT 'c' AS t, k, NULL::text AS producto, count(*)::float8 AS v FROM b GROUP BY k
     UNION ALL SELECT 'p', k, producto, avg(precio) FROM u GROUP BY k, producto`,
    [rango.desde, rango.hastaExcl],
  );
  const claveSerie: string[] = [];
  if (rango.granularidad === "hora") for (let h = 0; h < 24; h++) claveSerie.push(String(h));
  else if (rango.granularidad === "dia") for (let i = 0; i < rango.dias; i++) claveSerie.push(sumar(rango.desde, i));
  else {
    let [a, m] = [Number(rango.desde.slice(0, 4)), Number(rango.desde.slice(5, 7))];
    const [af, mf] = [Number(rango.hasta.slice(0, 4)), Number(rango.hasta.slice(5, 7))];
    while (a < af || (a === af && m <= mf)) { claveSerie.push(`${a}-${pad(m)}`); if (++m > 12) { m = 1; a++; } }
  }
  const serie = claveSerie.map((k) => {
    const c = sr.rows.find((r: any) => r.t === "c" && r.k === k);
    const pm = sr.rows.find((r: any) => r.t === "p" && r.k === k && r.producto === "maiz");
    const pa = sr.rows.find((r: any) => r.t === "p" && r.k === k && r.producto === "masa");
    const etiqueta =
      rango.granularidad === "hora" ? etiquetaHora(Number(k))
      : rango.granularidad === "dia" ? `${Number(k.slice(8))} ${MESES[Number(k.slice(5, 7)) - 1].slice(0, 3)}`
      : `${MESES[Number(k.slice(5, 7)) - 1].slice(0, 3)} ${k.slice(0, 4)}`;
    return { k, etiqueta, capturas: c ? Math.round(c.v) : 0, maiz: pm ? Math.round(pm.v * 100) / 100 : null, masa: pa ? Math.round(pa.v * 100) / 100 : null };
  });

  // Avance del censo y motivos por los que no se obtuvieron datos fiscales en el periodo
  // el catálogo y el avance se calculan sin las tortillerías dadas de baja
  const { rows: [cat] } = await pool.query(`SELECT count(*)::int AS n FROM tortillerias WHERE estatus <> 'rechazada' AND operacion = 'activa'`);
  const { rows: [con] } = await pool.query(`SELECT count(DISTINCT tortilleria_id)::int AS n FROM precios_que_cuentan p WHERE p.operacion_tortilleria = 'activa' AND coalesce(p.capturado_en, p.creado_en) < $1::date::timestamp AT TIME ZONE '${ZONA}'`, [rango.hastaExcl]);
  const baj = await pool.query(
    `SELECT b.motivo, t.estado_clave AS clave, count(*)::int AS n
       FROM tortilleria_bajas b JOIN tortillerias t ON t.id = b.tortilleria_id
      WHERE coalesce(b.capturado_en, b.creado_en) >= $1::date::timestamp AT TIME ZONE '${ZONA}' AND coalesce(b.capturado_en, b.creado_en) < $2::date::timestamp AT TIME ZONE '${ZONA}'
      GROUP BY b.motivo, t.estado_clave`,
    [rango.desde, rango.hastaExcl],
  );
  const porMotivoB = new Map<string, number>();
  const porEstadoB = new Map<string, number>();
  for (const b of baj.rows) {
    porMotivoB.set(b.motivo, (porMotivoB.get(b.motivo) ?? 0) + b.n);
    porEstadoB.set(b.clave ?? "", (porEstadoB.get(b.clave ?? "") ?? 0) + b.n);
  }
  const elab = await pool.query(
    `WITH u AS (
       SELECT DISTINCT ON (p.tortilleria_id) p.tortilleria_id, p.elaboracion_tortilleria AS tipo, p.precio_kg::float8 AS precio
         FROM precios_que_cuentan p WHERE p.producto = 'maiz' AND ${VENTANA("$1", "$2")}
        ORDER BY p.tortilleria_id, coalesce(p.capturado_en, p.creado_en) DESC, p.creado_en DESC)
     SELECT coalesce(tipo, 'sin_dato') AS tipo, count(*)::int AS n, avg(precio) AS prom FROM u GROUP BY coalesce(tipo, 'sin_dato')`,
    [rango.desde, rango.hastaExcl],
  );
  const ORDEN_ELAB = ["maquina", "mano", "ambas", "sin_dato"];
  const mot = await pool.query(
    `SELECT motivo, count(*)::int AS n FROM fiscal_negativas
      WHERE creado_en >= $1::date::timestamp AT TIME ZONE '${ZONA}' AND creado_en < $2::date::timestamp AT TIME ZONE '${ZONA}' GROUP BY motivo ORDER BY n DESC`,
    [rango.desde, rango.hastaExcl],
  );
  return {
    rango, generado: new Date().toISOString(), totales, anterior, serie, estados,
    censo: { catalogo: cat.n, conPrecio: con.n },
    motivos: mot.rows.map((m: any) => ({ clave: m.motivo, texto: textoMotivoSinFiscal(m.motivo), n: m.n })),
    bajas: {
      total: [...porMotivoB.values()].reduce((a, b) => a + b, 0),
      porMotivo: [...porMotivoB.entries()].map(([clave, n]) => ({ clave, texto: textoMotivoBaja(clave), n })).sort((a, b) => b.n - a.n),
      porEstado: [...porEstadoB.entries()].map(([clave, n]) => ({ clave, nombre: nombres.get(clave) ?? clave, n })).sort((a, b) => b.n - a.n || a.nombre.localeCompare(b.nombre, "es")),
    },
    elaboracion: ORDEN_ELAB.map((clave) => {
      const f = elab.rows.find((x: any) => x.tipo === clave);
      return { clave, texto: clave === "sin_dato" ? "Sin dato" : textoElaboracion(clave), tortillerias: f?.n ?? 0, promedio: f?.prom == null ? null : Math.round(f.prom * 100) / 100 };
    }),
  };
}

/** Filas de capturas del periodo para la hoja de detalle del Excel (sin datos personales ni nombres de las tortillerías) */
export const MAX_FILAS_DETALLE = 50000;
export async function capturasDelPeriodo(rango: Rango) {
  const { rows } = await pool.query(
    `SELECT to_char(${MOMENTO}, 'YYYY-MM-DD') AS fecha, to_char(${MOMENTO}, 'HH24:MI') AS hora, e.nombre AS estado, m.nombre AS municipio,
            CASE p.producto WHEN 'maiz' THEN 'Tortilla' ELSE 'Masa' END AS producto, p.precio_kg::float8 AS precio,
            CASE WHEN p.aprobacion = 'manual' THEN 'Revisado' ELSE 'Automática' END AS aprobacion, p.origen_tortilleria AS origen
       FROM precios_que_cuentan p
       LEFT JOIN estados e ON e.clave = p.estado_clave LEFT JOIN municipios m ON m.clave = p.municipio_clave
      WHERE ${VENTANA("$1", "$2")}
      ORDER BY coalesce(p.capturado_en, p.creado_en) LIMIT ${MAX_FILAS_DETALLE + 1}`,
    [rango.desde, rango.hastaExcl],
  );
  return { filas: rows.slice(0, MAX_FILAS_DETALLE), truncado: rows.length > MAX_FILAS_DETALLE };
}
