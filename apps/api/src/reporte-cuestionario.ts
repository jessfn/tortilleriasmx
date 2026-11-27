import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  APOYOS, CONOCE_ACUERDO, DECLARACION_ANUAL, HIGIENE_PUNTOS, IMSS, INSUMO, LICENCIA, MOTIVO_NO_ADHESION, NUM_TRABAJADORES, PREGUNTAS, PROPIEDAD,
  respuestaHigiene, textoDe, UBICACION_TIPO, VOLUMEN_SEMANAL,
} from "@tortillerias/shared";
import { pool } from "./db.js";
import { etiquetaHora, MESES, sumar, textosRango, ZONA, type Rango } from "./reportes.js";
import { pdfBase, type DocPdf } from "./reporte-pdf.js";
import { SQL_VISITADAS } from "./rutas/cuestionario.js";

/**
 * Reporte del CUESTIONARIO DE SUPERVISIÓN (C21) por día, semana, mes, año o rango (hora de la Ciudad de México), en PDF o Excel.
 * Mismo diseño que el de Extras. Solo lo descarga quien tiene la vista "Cuestionarios" (permiso reservado).
 * Cuenta los cuestionarios APLICADOS en el periodo; si una tortillería se actualizó varias veces, vale su último registro del periodo.
 */

type Op = { readonly clave: string; readonly texto: string };
export type Distrib = { clave: string; texto: string; n: number }[];
export type TotalesCuest = { tortillerias: number; registros: number; nuevos: number; actualizados: number; censadores: number; estados: number };
export type ReporteCuest = {
  rango: Rango;
  estado: { clave: string; nombre: string } | null;
  generado: string;
  totales: TotalesCuest;
  anterior: TotalesCuest;
  avance: { visitadas: number; conCuestionario: number; porcentaje: number };
  serie: { k: string; etiqueta: string; v: number }[];
  estados: { clave: string; nombre: string; visitadas: number; periodo: number; acumulado: number; porcentaje: number }[];
  /** respuestas de las tortillerías con cuestionario en el periodo (una por tortillería) */
  base: number;
  a1: Distrib;
  higiene: { clave: string; pregunta: string; buena: number; total: number }[];
  b1: Distrib; b2: Distrib; b3: Distrib; b4: Distrib; b5: Distrib;
  b6: Distrib; b6Base: number; b7: { si: number; no: number }; b8: Distrib;
  c1: Distrib; c2: Distrib; c3: Distrib;
  otros: { pregunta: string; texto: string; n: number }[];
};

const VENTANA = (d: string, h: string) =>
  `coalesce(k.capturado_en, k.creado_en) >= ${d}::date::timestamp AT TIME ZONE '${ZONA}' AND coalesce(k.capturado_en, k.creado_en) < ${h}::date::timestamp AT TIME ZONE '${ZONA}'`;
const MOMENTO = `(coalesce(k.capturado_en, k.creado_en) AT TIME ZONE '${ZONA}')`;
const pad = (n: number) => String(n).padStart(2, "0");

async function totalesDe(desde: string, hastaExcl: string, estado: string | null): Promise<TotalesCuest> {
  const { rows: [t] } = await pool.query(
    `WITH r AS (SELECT k.*, t.estado_clave FROM tortilleria_cuestionarios k JOIN tortillerias t ON t.id = k.tortilleria_id
                 WHERE k.estatus = 'aplicado' AND ${VENTANA("$1", "$2")} AND ($3::text IS NULL OR t.estado_clave = $3))
     SELECT count(*)::int AS registros, count(DISTINCT tortilleria_id)::int AS tortillerias, count(DISTINCT capturista_id)::int AS censadores,
            count(DISTINCT estado_clave)::int AS estados,
            count(DISTINCT tortilleria_id) FILTER (WHERE NOT EXISTS (
              SELECT 1 FROM tortilleria_cuestionarios a WHERE a.tortilleria_id = r.tortilleria_id AND a.estatus = 'aplicado'
                 AND coalesce(a.capturado_en, a.creado_en) < $1::date::timestamp AT TIME ZONE '${ZONA}'))::int AS nuevos
       FROM r`,
    [desde, hastaExcl, estado],
  );
  return { tortillerias: t.tortillerias, registros: t.registros, nuevos: t.nuevos, actualizados: t.tortillerias - t.nuevos, censadores: t.censadores, estados: t.estados };
}

const contar = (lista: readonly Op[], valores: (string | null | undefined)[]): Distrib => {
  const m = new Map<string, number>();
  for (const v of valores) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  const conocidas = lista.map((o) => ({ clave: o.clave, texto: o.texto, n: m.get(o.clave) ?? 0 }));
  // códigos de versiones anteriores que ya no se ofrecen (se muestran con su texto)
  const extra = [...m.entries()].filter(([c]) => !lista.some((o) => o.clave === c)).map(([c, n]) => ({ clave: c, texto: textoDe(lista, c), n }));
  return [...conocidas, ...extra];
};
const contarMulti = (lista: readonly Op[], valores: (string[] | null)[]): Distrib => contar(lista, valores.flatMap((v) => v ?? []));

/** Todo lo que lleva el reporte del cuestionario (PDF, Excel y vista previa salen de aquí) */
export async function reunirReporteCuestionario(rango: Rango, estado: string | null): Promise<ReporteCuest> {
  const [totales, anterior] = await Promise.all([totalesDe(rango.desde, rango.hastaExcl, estado), totalesDe(rango.ant.desde, rango.ant.hastaExcl, estado)]);
  const nombres = new Map<string, string>((await pool.query("SELECT clave, nombre FROM estados")).rows.map((e: any) => [e.clave, e.nombre]));

  // Avance acumulado al cierre del periodo: tortillerías visitadas (activas) con un cuestionario aplicado hasta ese momento
  const av = await pool.query(
    `WITH v AS (${SQL_VISITADAS})
     SELECT t.estado_clave AS clave, count(*)::int AS visitadas,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM tortilleria_cuestionarios k WHERE k.tortilleria_id = t.id AND k.estatus = 'aplicado'
                                             AND coalesce(k.capturado_en, k.creado_en) < $1::date::timestamp AT TIME ZONE '${ZONA}'))::int AS acumulado
       FROM tortillerias t JOIN v ON v.id = t.id WHERE t.estado_clave IS NOT NULL GROUP BY t.estado_clave`,
    [rango.hastaExcl],
  );
  const per = await pool.query(
    `SELECT t.estado_clave AS clave, count(DISTINCT k.tortilleria_id)::int AS n FROM tortilleria_cuestionarios k JOIN tortillerias t ON t.id = k.tortilleria_id
      WHERE k.estatus = 'aplicado' AND ${VENTANA("$1", "$2")} GROUP BY t.estado_clave`,
    [rango.desde, rango.hastaExcl],
  );
  const estados = [...nombres.keys()]
    .filter((c) => !estado || c === estado)
    .map((clave) => {
      const a = av.rows.find((r: any) => r.clave === clave);
      const visitadas = a?.visitadas ?? 0, acumulado = a?.acumulado ?? 0;
      return { clave, nombre: nombres.get(clave) ?? clave, visitadas, periodo: per.rows.find((r: any) => r.clave === clave)?.n ?? 0, acumulado, porcentaje: visitadas ? Math.round((acumulado / visitadas) * 1000) / 10 : 0 };
    })
    .sort((a, b) => b.porcentaje - a.porcentaje || b.visitadas - a.visitadas || a.nombre.localeCompare(b.nombre, "es"));
  const visitadas = estados.reduce((s, e) => s + e.visitadas, 0), conCuestionario = estados.reduce((s, e) => s + e.acumulado, 0);

  // Serie en el tiempo: cuestionarios aplicados por hora, día o mes
  const bucket = rango.granularidad === "hora" ? `extract(hour from ${MOMENTO})::int::text` : rango.granularidad === "dia" ? `to_char(${MOMENTO}, 'YYYY-MM-DD')` : `to_char(${MOMENTO}, 'YYYY-MM')`;
  const sr = await pool.query(
    `SELECT ${bucket} AS k, count(*)::int AS v FROM tortilleria_cuestionarios k JOIN tortillerias t ON t.id = k.tortilleria_id
      WHERE k.estatus = 'aplicado' AND ${VENTANA("$1", "$2")} AND ($3::text IS NULL OR t.estado_clave = $3) GROUP BY 1`,
    [rango.desde, rango.hastaExcl, estado],
  );
  const claves: string[] = [];
  if (rango.granularidad === "hora") for (let h = 0; h < 24; h++) claves.push(String(h));
  else if (rango.granularidad === "dia") for (let i = 0; i < rango.dias; i++) claves.push(sumar(rango.desde, i));
  else {
    let [a, m] = [Number(rango.desde.slice(0, 4)), Number(rango.desde.slice(5, 7))];
    const [af, mf] = [Number(rango.hasta.slice(0, 4)), Number(rango.hasta.slice(5, 7))];
    while (a < af || (a === af && m <= mf)) { claves.push(`${a}-${pad(m)}`); if (++m > 12) { m = 1; a++; } }
  }
  const serie = claves.map((k) => ({
    k,
    etiqueta: rango.granularidad === "hora" ? etiquetaHora(Number(k)) : rango.granularidad === "dia" ? `${Number(k.slice(8))} ${MESES[Number(k.slice(5, 7)) - 1].slice(0, 3)}` : `${MESES[Number(k.slice(5, 7)) - 1].slice(0, 3)} ${k.slice(0, 4)}`,
    v: sr.rows.find((r: any) => r.k === k)?.v ?? 0,
  }));

  // Respuestas: el último cuestionario aplicado de cada tortillería dentro del periodo
  const { rows: u } = await pool.query(
    `SELECT DISTINCT ON (k.tortilleria_id) k.* FROM tortilleria_cuestionarios k JOIN tortillerias t ON t.id = k.tortilleria_id
      WHERE k.estatus = 'aplicado' AND ${VENTANA("$1", "$2")} AND ($3::text IS NULL OR t.estado_clave = $3)
      ORDER BY k.tortilleria_id, coalesce(k.capturado_en, k.creado_en) DESC, k.creado_en DESC`,
    [rango.desde, rango.hastaExcl, estado],
  );
  const col = (c: string) => u.map((r: any) => r[c] as string | null);
  const conB6 = u.filter((r: any) => r.b5_conoce_acuerdo === "CONOCE_NO_ADHERIDA");
  const conB7 = u.filter((r: any) => r.b7_interes !== null && r.b7_interes !== undefined);
  const otros: ReporteCuest["otros"] = [];
  const juntar = (pregunta: string, campo: string) => {
    const m = new Map<string, number>();
    for (const r of u) { const t = String(r[campo] ?? "").trim(); if (t) m.set(t.toUpperCase(), (m.get(t.toUpperCase()) ?? 0) + 1); }
    for (const [texto, n] of m) otros.push({ pregunta, texto, n });
  };
  juntar("A1 · Dónde está", "a1_otro"); juntar("B1 · Con qué hace la tortilla", "b1_otro"); juntar("B3 · De quién es el negocio", "b3_otro");
  juntar("B6 · Por qué no se ha adherido", "b6_otro"); juntar("B8 · Otro apoyo o programa", "b8_otro");
  otros.sort((a, b) => b.n - a.n || a.pregunta.localeCompare(b.pregunta));

  return {
    rango, estado: estado ? { clave: estado, nombre: nombres.get(estado) ?? estado } : null, generado: new Date().toISOString(), totales, anterior,
    avance: { visitadas, conCuestionario, porcentaje: visitadas ? Math.round((conCuestionario / visitadas) * 1000) / 10 : 0 },
    serie, estados, base: u.length,
    a1: contar(UBICACION_TIPO, col("a1_ubicacion")),
    higiene: HIGIENE_PUNTOS.map((h) => {
      const vals = u.map((r: any) => r[`a2_${h.col}`] as boolean | null).filter((v) => v !== null && v !== undefined);
      return { clave: h.clave, pregunta: h.pregunta, buena: vals.filter(Boolean).length, total: vals.length };
    }),
    b1: contar(INSUMO, col("b1_insumo")), b2: contar(VOLUMEN_SEMANAL, col("b2_volumen")), b3: contar(PROPIEDAD, col("b3_propiedad")),
    b4: contar(NUM_TRABAJADORES, col("b4_trabajadores")), b5: contar(CONOCE_ACUERDO, col("b5_conoce_acuerdo")),
    b6: contarMulti(MOTIVO_NO_ADHESION, conB6.map((r: any) => r.b6_motivos)), b6Base: conB6.length,
    b7: { si: conB7.filter((r: any) => r.b7_interes).length, no: conB7.filter((r: any) => !r.b7_interes).length },
    b8: contarMulti(APOYOS, u.map((r: any) => r.b8_apoyos)),
    c1: contar(LICENCIA, col("c1_licencia")), c2: contar(IMSS, col("c2_imss")), c3: contar(DECLARACION_ANUAL, col("c3_declaracion")),
    otros,
  };
}

/** Textos del encabezado del reporte del cuestionario */
export function textosCuestionario(r: ReporteCuest) {
  const t = textosRango(r.rango);
  return {
    ...t,
    tipo: t.tipo.replace("de precios", "del cuestionario"),
    nombreArchivo: t.nombreArchivo.replace("TortilleriasMX_Reporte", "TortilleriasMX_Cuestionario") + (r.estado ? `_${r.estado.nombre.normalize("NFD").replace(/[^\w]+/g, "")}` : ""),
    ambito: r.estado ? r.estado.nombre : "Nacional",
  };
}

/* =============================================================== PDF =============================================================== */

const { tx, parrafo, ancho, tarjeta, degradado, nuevaPagina, titulo, dona, barrasVerticales, diferencia, kpi, fuente, fmtN, pct, colores, W, MX } = pdfBase;
const { G, G2, GD, O, V, GRIS } = colores;
const PALETA = [G2, O, V, "#6b4e8c", "#2f6f9a", "#c4693d", "#8a7a80", "#b58b4b"];

/** Tarjeta con la distribución de respuestas de una pregunta: barra, número y porcentaje (sobre `base`) */
function distribucion(doc: DocPdf, x: number, y: number, w: number, h: number, titulo_: string, items: Distrib, base: number, color = G2, nota?: string) {
  tarjeta(doc, x, y, w, h);
  doc.font("Cuerpo-Bold").fontSize(12);
  const hT = doc.heightOfString(titulo_, { width: w - 40 });
  doc.fillColor(G).text(titulo_, x + 20, y + 14, { width: w - 40 });
  let yy = y + 14 + hT + 4;
  if (nota) { tx(doc, nota, x + 20, yy, { size: 9, color: GRIS, width: w - 40 }); yy += 14; }
  yy += 4;
  if (!base) {
    tx(doc, "Sin respuestas en el periodo", x + 20, yy + 10, { size: 11, color: GRIS, width: w - 40 });
    return;
  }
  const vis = items.filter((i) => i.n > 0 || items.length <= 8);
  const fila = Math.min(30, (y + h - 12 - yy) / Math.max(1, vis.length));
  const anchoTxt = Math.min(250, (w - 40) * 0.5), bx = x + 20 + anchoTxt + 8, bw = w - 40 - anchoTxt - 8 - 78;
  const max = Math.max(1, ...vis.map((i) => i.n));
  vis.forEach((it, i) => {
    const fy = yy + i * fila;
    tx(doc, it.texto, x + 20, fy + fila / 2 - 6, { size: fila < 22 ? 9 : 10, color: "#4a3a40", width: anchoTxt });
    doc.roundedRect(bx, fy + fila / 2 - 5, bw, 10, 5).fill("#f1e8da");
    if (it.n > 0) degradado(doc, bx, fy + fila / 2 - 5, Math.max(10, (bw * it.n) / max), 10, 5, color, color);
    tx(doc, fmtN(it.n), bx + bw + 6, fy + fila / 2 - 6, { font: "Cuerpo-Bold", size: 10, color: G, width: 30, align: "right" });
    tx(doc, pct((it.n / base) * 100, 0), bx + bw + 38, fy + fila / 2 - 6, { size: 9.5, color: GRIS, width: 40, align: "right" });
  });
}

/** Comparación con el periodo anterior (mismo estilo que Extras, con "cuestionarios" en lugar de "capturas") */
function difC(doc: DocPdf, x: number, y: number, actual: number, previo: number, anterior: string, w: number) {
  if (previo === 0 && actual > 0) return tx(doc, `Sin cuestionarios ${anterior}`, x, y, { size: 9.5, color: GRIS, width: w });
  diferencia(doc, x, y, actual, previo, "conteo", anterior, w);
}

function pPortada(doc: DocPdf, r: ReporteCuest) {
  const t = textosCuestionario(r);
  const a = r.totales, p = r.anterior;
  const PX = MX, PY = 110, PW = 530, PH = 550;
  degradado(doc, PX, PY, PW, PH, 22, GD, "#7a1a41", false);
  doc.save().roundedRect(PX, PY, PW, PH, 22).clip();
  doc.circle(PX + PW - 30, PY + 70, 170).fillOpacity(0.07).fill("#ffffff");
  doc.circle(PX + 40, PY + PH + 10, 190).fillOpacity(0.08).fill(O);
  doc.restore();
  doc.fillOpacity(1);
  tx(doc, t.tipo.toUpperCase(), PX + 36, PY + 34, { font: "Cuerpo-Bold", size: 11, color: O, spacing: 2.2, width: PW - 72 });
  const tam = t.titulo.length > 40 ? 34 : t.titulo.length > 26 ? 40 : 46;
  doc.font("Titulo").fontSize(tam);
  const hT = doc.heightOfString(t.titulo, { width: PW - 72 });
  doc.fillColor("#ffffff").text(t.titulo, PX + 36, PY + 62, { width: PW - 72 });
  let y = PY + 62 + hT + 12;
  doc.roundedRect(PX + 36, y, 56, 4, 2).fill(O);
  y += 24;
  const linea = `${t.ambito} · ${t.horario}`;
  doc.font("Cuerpo-Bold").fontSize(10.5);
  const hh = doc.heightOfString(linea, { width: PW - 108 });
  doc.roundedRect(PX + 36, y, PW - 72, hh + 22, 12).fillOpacity(0.13).fill("#ffffff");
  doc.fillOpacity(1);
  doc.circle(PX + 54, y + (hh + 22) / 2, 4).fill(O);
  doc.font("Cuerpo-Bold").fontSize(10.5).fillColor("#ffffff").text(linea, PX + 70, y + 11, { width: PW - 108 });
  y += hh + 22 + 18;
  parrafo(doc, "Resultados del cuestionario de supervisión que los censadores aplican una sola vez en cada tortillería: dónde está, cómo trabaja, el Acuerdo Maíz-Tortilla, los apoyos y su situación de licencia, IMSS y SAT.", PX + 36, y, PW - 72, { size: 12, color: "#ecdde2", gap: 4 });
  const items: [number, string][] = [[2, `Cuestionarios ${t.porUnidad}`], [3, "Avance por estado"], [4, "Bloque A · Lo que se observa"], [5, "Bloque B · Insumos y negocio"], [6, "Bloque B · Acuerdo y apoyos"], [7, "Bloque C · Licencia, IMSS y SAT"]];
  const ly = PY + PH - 40 - items.length * 30;
  tx(doc, "EN ESTE REPORTE", PX + 36, ly - 26, { font: "Cuerpo-Bold", size: 9, color: O, spacing: 1.6 });
  items.forEach(([n, texto], i) => {
    const yy = ly + i * 30;
    doc.save().rect(PX + 36, yy - 4, PW - 72, 0.6).fillOpacity(0.2).fill("#ffffff").restore();
    tx(doc, String(n).padStart(2, "0"), PX + 36, yy + 6, { font: "Titulo", size: 15, color: O });
    tx(doc, texto, PX + 76, yy + 8, { size: 11, color: "#ffffff", width: PW - 130 });
  });

  const X = 590, cw = 204, gap = 17, kh = 168;
  const col = (i: number) => X + i * (cw + gap);
  kpi(doc, col(0), 110, cw, kh, G2, "Cuestionarios aplicados", fmtN(a.tortillerias), null, "tortillerías en el periodo", (x, yy, w) => difC(doc, x, yy, a.tortillerias, p.tortillerias, t.anterior, w));
  kpi(doc, col(1), 110, cw, kh, O, "Primera vez", fmtN(a.nuevos), null, "tortillerías sin cuestionario previo", (x, yy, w) => difC(doc, x, yy, a.nuevos, p.nuevos, t.anterior, w));
  kpi(doc, col(2), 110, cw, kh, V, "Actualizados", fmtN(a.actualizados), null, "ya tenían uno y se actualizó", (x, yy, w) => difC(doc, x, yy, a.actualizados, p.actualizados, t.anterior, w));
  kpi(doc, col(0), 295, cw, kh, G, "Censadores", fmtN(a.censadores), null, "aplicaron cuestionarios", (x, yy, w) => difC(doc, x, yy, a.censadores, p.censadores, t.anterior, w));
  if (r.estado) kpi(doc, col(1), 295, cw, kh, O, "Registros", fmtN(a.registros), null, "cuestionarios guardados (con actualizaciones)", (x, yy, w) => difC(doc, x, yy, a.registros, p.registros, t.anterior, w));
  else kpi(doc, col(1), 295, cw, kh, O, "Estados", fmtN(a.estados), null, "con cuestionarios en el periodo", (x, yy) => tx(doc, `${fmtN(a.registros)} registros en total`, x, yy, { size: 9.5, color: GRIS }));
  kpi(doc, col(2), 295, cw, kh, V, "Avance acumulado", pct(r.avance.porcentaje), null, `${fmtN(r.avance.conCuestionario)} de ${fmtN(r.avance.visitadas)} visitadas`, (x, yy) => tx(doc, "al cierre del periodo", x, yy, { size: 9.5, color: GRIS }));
  // higiene observada
  const hy = 480, hw = 3 * cw + 2 * gap, hh2 = 180;
  tarjeta(doc, X, hy, hw, hh2);
  tx(doc, "Higiene observada · tortillerías con buena práctica", X + 20, hy + 14, { font: "Cuerpo-Bold", size: 12, color: G, width: hw - 40 });
  const cortos = ["Área limpia", "Sin moscas ni roedores", "Insumos tapados", "Personal limpio", "Basura con tapa"];
  r.higiene.forEach((h, i) => {
    const yy = hy + 40 + i * 26, v = h.total ? (h.buena / h.total) * 100 : 0;
    tx(doc, cortos[i], X + 20, yy + 2, { size: 10, color: "#4a3a40", width: 170 });
    doc.roundedRect(X + 196, yy + 4, hw - 300, 10, 5).fill("#f1e8da");
    if (h.total) degradado(doc, X + 196, yy + 4, Math.max(10, ((hw - 300) * v) / 100), 10, 5, v >= 70 ? V : v >= 40 ? O : G2, v >= 70 ? V : v >= 40 ? O : G2);
    tx(doc, h.total ? pct(v, 0) : "—", X + hw - 96, yy + 2, { font: "Cuerpo-Bold", size: 10.5, color: G, width: 76, align: "right" });
  });
}

function pSerie(doc: DocPdf, r: ReporteCuest) {
  const t = textosCuestionario(r);
  nuevaPagina(doc);
  titulo(doc, "Ritmo de trabajo", `Cuestionarios aplicados ${t.porUnidad}`);
  tarjeta(doc, MX, 182, 850, 478);
  tx(doc, `${fmtN(r.totales.registros)} cuestionarios aplicados en el periodo (incluye actualizaciones)`, MX + 20, 198, { font: "Cuerpo-Bold", size: 13.5, color: G, width: 810 });
  barrasVerticales(doc, MX + 20, 236, 810, 400, r.serie, { colorPico: true });
  const X = 912, wc = 324;
  tarjeta(doc, X, 182, wc, 478);
  tx(doc, r.estado ? "Avance del estado" : "Estados con más avance", X + 20, 198, { font: "Cuerpo-Bold", size: 13.5, color: G, width: wc - 40 });
  const top = r.estados.filter((e) => e.visitadas > 0).slice(0, 10);
  if (!top.length) tx(doc, "Aún no hay tortillerías visitadas", X + 20, 236, { size: 11, color: GRIS, width: wc - 40 });
  top.forEach((e, i) => {
    const yy = 232 + i * 42;
    tx(doc, e.nombre, X + 20, yy, { font: "Cuerpo-Bold", size: 10.5, color: "#4a3a40", width: wc - 110 });
    tx(doc, pct(e.porcentaje), X + wc - 90, yy, { font: "Cuerpo-Bold", size: 10.5, color: G, width: 70, align: "right" });
    doc.roundedRect(X + 20, yy + 17, wc - 40, 8, 4).fill("#f1e8da");
    if (e.porcentaje > 0) degradado(doc, X + 20, yy + 17, Math.max(8, ((wc - 40) * e.porcentaje) / 100), 8, 4, G2, O);
    tx(doc, `${fmtN(e.acumulado)} de ${fmtN(e.visitadas)} visitadas`, X + 20, yy + 27, { size: 8.5, color: GRIS, width: wc - 40 });
  });
}

function pEstados(doc: DocPdf, r: ReporteCuest) {
  const filas = r.estados;
  const porPagina = 32;
  for (let p = 0; p < Math.max(1, Math.ceil(filas.length / porPagina)); p++) {
    nuevaPagina(doc);
    titulo(doc, "Avance por estado", "Tortillerías visitadas con cuestionario aplicado");
    const lote = filas.slice(p * porPagina, (p + 1) * porPagina);
    const mitad = Math.ceil(lote.length / 2);
    [lote.slice(0, mitad), lote.slice(mitad)].forEach((col, c) => {
      const x = MX + c * 604, w = 588;
      tarjeta(doc, x, 182, w, 478);
      tx(doc, "ESTADO", x + 20, 198, { font: "Cuerpo-Bold", size: 8.5, color: GRIS, spacing: 0.7 });
      tx(doc, "AVANCE ACUMULADO", x + 220, 198, { font: "Cuerpo-Bold", size: 8.5, color: GRIS, spacing: 0.7 });
      tx(doc, "EN EL PERIODO", x + w - 120, 198, { font: "Cuerpo-Bold", size: 8.5, color: GRIS, spacing: 0.7, width: 100, align: "right" });
      col.forEach((e, i) => {
        const yy = 220 + i * 27;
        if (i % 2 === 1) doc.save().roundedRect(x + 10, yy - 5, w - 20, 27, 6).fillOpacity(0.35).fill("#f7f0e4").restore();
        tx(doc, e.nombre, x + 20, yy + 2, { size: 10, color: "#4a3a40", width: 190 });
        doc.roundedRect(x + 220, yy + 5, 170, 8, 4).fill("#f1e8da");
        if (e.porcentaje > 0) degradado(doc, x + 220, yy + 5, Math.max(8, (170 * e.porcentaje) / 100), 8, 4, G2, O);
        tx(doc, `${pct(e.porcentaje)} · ${fmtN(e.acumulado)}/${fmtN(e.visitadas)}`, x + 396, yy + 2, { font: "Cuerpo-Bold", size: 9.5, color: G, width: 110 });
        tx(doc, fmtN(e.periodo), x + w - 120, yy + 2, { size: 10, color: "#4a3a40", width: 100, align: "right" });
      });
    });
  }
}

function pBloqueA(doc: DocPdf, r: ReporteCuest) {
  nuevaPagina(doc);
  titulo(doc, "Bloque A · Lo que observa el censador", "Ubicación e higiene de la tortillería");
  distribucion(doc, MX, 182, 560, 478, `A1. ${PREGUNTAS.a1}`, r.a1, r.base, G2, `${fmtN(r.base)} tortillerías con cuestionario en el periodo`);
  const X = MX + 576, w = W - MX - X;
  tarjeta(doc, X, 182, w, 478);
  tx(doc, "A2. Higiene — respuestas a cada pregunta", X + 20, 196, { font: "Cuerpo-Bold", size: 12, color: G, width: w - 40 });
  tx(doc, "Verde: buena práctica · Guinda: hay que atender", X + 20, 214, { size: 9, color: GRIS, width: w - 40 });
  r.higiene.forEach((h, i) => {
    const yy = 244 + i * 82;
    const p = HIGIENE_PUNTOS.find((x) => x.clave === h.clave)!;
    tx(doc, h.pregunta, X + 20, yy, { font: "Cuerpo-Bold", size: 10.5, color: "#4a3a40", width: w - 40 });
    if (!h.total) return void tx(doc, "Sin respuestas", X + 20, yy + 22, { size: 10, color: GRIS });
    const buena = h.buena / h.total, bw = w - 40;
    doc.roundedRect(X + 20, yy + 24, bw, 14, 7).fill(G2);
    if (buena > 0) doc.save().roundedRect(X + 20, yy + 24, bw, 14, 7).clip().rect(X + 20, yy + 24, bw * buena, 14).fill(V).restore();
    const si = respuestaHigiene(p, true) ? h.buena : h.total - h.buena;
    tx(doc, `Sí ${fmtN(si)} (${pct((si / h.total) * 100, 0)})`, X + 20, yy + 44, { font: "Cuerpo-Bold", size: 9.5, color: respuestaHigiene(p, true) ? V : G2, width: bw / 2 });
    tx(doc, `No ${fmtN(h.total - si)} (${pct(((h.total - si) / h.total) * 100, 0)})`, X + 20 + bw / 2, yy + 44, { font: "Cuerpo-Bold", size: 9.5, color: respuestaHigiene(p, true) ? G2 : V, width: bw / 2, align: "right" });
  });
}

function pBloqueB1(doc: DocPdf, r: ReporteCuest) {
  nuevaPagina(doc);
  titulo(doc, "Bloque B · Preguntas al encargado", "Insumos, volumen y tamaño del negocio");
  const w = (W - 2 * MX - 16) / 2;
  distribucion(doc, MX, 182, w, 231, `B1. ${PREGUNTAS.b1}`, r.b1, r.base, G2);
  distribucion(doc, MX + w + 16, 182, w, 231, "B2. Cuánto insumo compra a la semana", r.b2, r.base, O);
  distribucion(doc, MX, 429, w, 231, `B3. ${PREGUNTAS.b3}`, r.b3, r.base, V);
  distribucion(doc, MX + w + 16, 429, w, 231, `B4. ${PREGUNTAS.b4}`, r.b4, r.base, "#6b4e8c");
}

function pBloqueB2(doc: DocPdf, r: ReporteCuest) {
  nuevaPagina(doc);
  titulo(doc, "Bloque B · Acuerdo Maíz-Tortilla y apoyos", "¿Conocen el Acuerdo y qué les impide adherirse?");
  // B5 con dona
  tarjeta(doc, MX, 182, 380, 478);
  tx(doc, `B5. ${PREGUNTAS.b5}`, MX + 20, 196, { font: "Cuerpo-Bold", size: 12, color: G, width: 340 });
  const cols = [V, O, G2];
  const ad = r.b5.find((x) => x.clave === "ADHERIDA")?.n ?? 0;
  dona(doc, MX + 190, 330, 84, 26, r.b5.map((x, i) => ({ v: x.n, c: cols[i % 3] })), r.base ? pct((ad / r.base) * 100, 0) : "—", "adheridas");
  r.b5.forEach((x, i) => {
    const yy = 440 + i * 34;
    doc.roundedRect(MX + 24, yy + 2, 12, 12, 3).fill(cols[i % 3]);
    tx(doc, x.texto, MX + 44, yy, { size: 10.5, color: "#4a3a40", width: 230 });
    tx(doc, `${fmtN(x.n)} · ${r.base ? pct((x.n / r.base) * 100, 0) : "—"}`, MX + 270, yy, { font: "Cuerpo-Bold", size: 10.5, color: G, width: 90, align: "right" });
  });
  const totB7 = r.b7.si + r.b7.no;
  tx(doc, `B7. Le interesa información para adherirse: ${totB7 ? `${pct((r.b7.si / totB7) * 100, 0)} sí (${fmtN(r.b7.si)} de ${fmtN(totB7)})` : "sin respuestas"}`, MX + 20, 610, { font: "Cuerpo-Bold", size: 10, color: V, width: 340 });
  const X = MX + 396, w = W - MX - X;
  distribucion(doc, X, 182, w, 262, `B6. ${PREGUNTAS.b6}`, r.b6, r.b6Base, G2, `Solo quienes conocen el Acuerdo y no están adheridas (${fmtN(r.b6Base)}) · pueden marcar varias`);
  distribucion(doc, X, 460, w, 200, `B8. ${PREGUNTAS.b8}`, r.b8, r.base, V, "Pueden marcar varias");
}

function pBloqueC(doc: DocPdf, r: ReporteCuest) {
  nuevaPagina(doc);
  titulo(doc, "Bloque C · Situación del negocio", "Licencia de funcionamiento, IMSS y SAT");
  const w = (W - 2 * MX - 32) / 3;
  distribucion(doc, MX, 182, w, 300, `C1. ${PREGUNTAS.c1}`, r.c1, r.base, G2);
  distribucion(doc, MX + w + 16, 182, w, 300, `C2. ${PREGUNTAS.c2}`, r.c2, r.base, O);
  distribucion(doc, MX + 2 * (w + 16), 182, w, 300, `C3. ${PREGUNTAS.c3}`, r.c3, r.base, V);
  tarjeta(doc, MX, 498, W - 2 * MX, 162);
  tx(doc, "Cómo se calcula", MX + 20, 512, { font: "Cuerpo-Bold", size: 13, color: G });
  parrafo(
    doc,
    "Cuenta los cuestionarios aplicados en el periodo (días de 12:00 a. m. a 11:59 p. m., hora de la Ciudad de México; los hechos sin conexión cuentan en el momento en que se aplicaron). Si una tortillería se actualizó varias veces, sus respuestas son las de su último cuestionario del periodo. Los porcentajes son sobre las tortillerías con cuestionario en el periodo, salvo B6 (solo las que conocen el Acuerdo y no están adheridas). El avance acumulado es sobre las tortillerías visitadas y activas. Información sensible: no incluye nombres, RFC, celular ni CURP.",
    MX + 20, 536, W - 2 * MX - 40, { size: 11, gap: 3 },
  );
}

export async function reporteCuestionarioPdf(r: ReporteCuest): Promise<Buffer> {
  const t = textosCuestionario(r);
  const doc = new PDFDocument({ size: [1280, 720], margin: 0, bufferPages: true, info: { Title: `${t.tipo} · ${t.titulo}`, Author: "TortilleríasMX", Subject: "Cuestionario de supervisión de tortillerías" } });
  doc.registerFont("Cuerpo", fuente("Montserrat-400.woff"));
  doc.registerFont("Cuerpo-Bold", fuente("Montserrat-700.woff"));
  doc.registerFont("Titulo", fuente("Patria-Regular.otf"));
  const trozos: Buffer[] = [];
  const fin = new Promise<Buffer>((ok, mal) => {
    doc.pipe(new Writable({ write(c, _e, cb) { trozos.push(c); cb(); }, final(cb) { ok(Buffer.concat(trozos)); cb(); } }));
    doc.on("error", mal);
  });
  nuevaPagina(doc, true);
  pPortada(doc, r);
  pSerie(doc, r);
  pEstados(doc, r);
  pBloqueA(doc, r);
  pBloqueB1(doc, r);
  pBloqueB2(doc, r);
  pBloqueC(doc, r);
  const rango = doc.bufferedPageRange();
  const generado = new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, dateStyle: "long", timeStyle: "short" }).format(new Date(r.generado));
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(i);
    doc.save().moveTo(MX, 684).lineTo(W - MX, 684).lineWidth(0.7).stroke("#e8dfd2").restore();
    tx(doc, "TortilleríasMX", MX, 693, { font: "Cuerpo-Bold", size: 10.5, color: G });
    tx(doc, "· Información sensible · uso exclusivo de DGTIC", MX + ancho(doc, "TortilleríasMX", "Cuerpo-Bold", 10.5) + 6, 693, { size: 10.5, color: GRIS });
    tx(doc, `${t.tipo} · ${t.ambito} · generado el ${generado} · Página ${i + 1} de ${rango.count}`, W / 2 - 80, 693, { size: 10.5, color: GRIS, width: W / 2 - MX + 80, align: "right" });
  }
  doc.end();
  return fin;
}

/* =============================================================== Excel =============================================================== */

const GUINDA = "FF611232";
const logoDgtic = fileURLToPath(new URL("../assets/logo-dgtic-blanco.png", import.meta.url));
function encabezado(h: ExcelJS.Row) {
  h.height = 24;
  h.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GUINDA } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}
const porc = '0.0" %"';

export async function reporteCuestionarioXlsx(r: ReporteCuest): Promise<Buffer> {
  const t = textosCuestionario(r);
  const wb = new ExcelJS.Workbook();
  wb.creator = "TortilleríasMX";
  wb.created = new Date(r.generado);

  // ---- Resumen
  const s1 = wb.addWorksheet("Resumen", { views: [{ showGridLines: false }] });
  s1.columns = [{ width: 44 }, { width: 18 }, { width: 18 }, { width: 18 }];
  s1.mergeCells("A1:D1");
  s1.getCell("A1").value = "TortilleríasMX · Cuestionario de supervisión";
  s1.getCell("A1").font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  s1.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: GUINDA } };
  s1.getCell("A1").alignment = { vertical: "middle", indent: 1 };
  s1.getRow(1).height = 40;
  s1.addImage(wb.addImage({ filename: logoDgtic, extension: "png" }), { tl: { col: 2.35, row: 0.1 }, ext: { width: 119, height: 34 } });
  s1.mergeCells("A2:D2");
  s1.getCell("A2").value = `${t.tipo}: ${t.titulo} · ${t.ambito}`;
  s1.getCell("A2").font = { bold: true, size: 15, color: { argb: GUINDA } };
  s1.getRow(2).height = 28;
  s1.mergeCells("A3:D3");
  s1.getCell("A3").value = t.horario;
  s1.getCell("A3").font = { color: { argb: "FF6B5A60" } };
  const cab = s1.getRow(5);
  cab.values = ["Indicador", "Este periodo", "Anterior", "Diferencia"];
  encabezado(cab);
  const filas: [string, number, number][] = [
    ["Tortillerías con cuestionario aplicado", r.totales.tortillerias, r.anterior.tortillerias],
    ["Primera vez (sin cuestionario previo)", r.totales.nuevos, r.anterior.nuevos],
    ["Actualizados", r.totales.actualizados, r.anterior.actualizados],
    ["Cuestionarios registrados (con actualizaciones)", r.totales.registros, r.anterior.registros],
    ["Censadores que aplicaron", r.totales.censadores, r.anterior.censadores],
  ];
  filas.forEach(([n, v, a], i) => {
    const row = s1.getRow(6 + i);
    row.values = [n, v, a, { formula: `B${6 + i}-C${6 + i}`, result: v - a }];
  });
  const n0 = 6 + filas.length + 1;
  s1.getCell(`A${n0}`).value = "Avance acumulado al cierre del periodo";
  s1.getCell(`A${n0}`).font = { bold: true };
  s1.getCell(`B${n0}`).value = r.avance.porcentaje;
  s1.getCell(`B${n0}`).numFmt = porc;
  s1.getCell(`C${n0}`).value = `${r.avance.conCuestionario} de ${r.avance.visitadas} visitadas`;
  s1.getCell(`A${n0 + 2}`).value = "Las respuestas son las del último cuestionario de cada tortillería en el periodo. Sin datos personales (nombres, RFC, celular ni CURP).";
  s1.getCell(`A${n0 + 2}`).font = { italic: true, size: 10, color: { argb: "FF8A7A80" } };
  s1.mergeCells(`A${n0 + 2}:D${n0 + 3}`);
  s1.getCell(`A${n0 + 2}`).alignment = { wrapText: true, vertical: "top" };

  // ---- Por estado
  const s2 = wb.addWorksheet("Por estado", { views: [{ state: "frozen", ySplit: 1 }] });
  s2.columns = [{ header: "Estado", key: "e", width: 30 }, { header: "Tortillerías visitadas", key: "v", width: 20 }, { header: "Con cuestionario (acumulado)", key: "a", width: 26 }, { header: "Avance (%)", key: "p", width: 14 }, { header: "Aplicados en el periodo", key: "n", width: 22 }];
  encabezado(s2.getRow(1));
  for (const e of r.estados) s2.addRow({ e: e.nombre, v: e.visitadas, a: e.acumulado, p: e.porcentaje, n: e.periodo });
  s2.getColumn("p").numFmt = porc;

  // ---- Respuestas (pregunta por pregunta)
  const s3 = wb.addWorksheet("Respuestas", { views: [{ state: "frozen", ySplit: 1 }] });
  s3.columns = [{ header: "Bloque", key: "b", width: 10 }, { header: "Pregunta", key: "q", width: 62 }, { header: "Respuesta", key: "r", width: 52 }, { header: "Tortillerías", key: "n", width: 14 }, { header: "%", key: "p", width: 10 }, { header: "Base", key: "base", width: 10 }];
  encabezado(s3.getRow(1));
  const poner = (b: string, q: string, d: Distrib, base: number) => { for (const x of d) s3.addRow({ b, q, r: x.texto, n: x.n, p: base ? Math.round((x.n / base) * 1000) / 10 : 0, base }); };
  poner("A", `A1. ${PREGUNTAS.a1}`, r.a1, r.base);
  for (const h of r.higiene) {
    const p = HIGIENE_PUNTOS.find((x) => x.clave === h.clave)!;
    const si = respuestaHigiene(p, true) ? h.buena : h.total - h.buena;
    poner("A", `A2. ${h.pregunta}`, [{ clave: "SI", texto: "Sí", n: si }, { clave: "NO", texto: "No", n: h.total - si }], h.total);
  }
  poner("B", `B1. ${PREGUNTAS.b1}`, r.b1, r.base);
  poner("B", "B2. Cuánto insumo compra a la semana", r.b2, r.base);
  poner("B", `B3. ${PREGUNTAS.b3}`, r.b3, r.base);
  poner("B", `B4. ${PREGUNTAS.b4}`, r.b4, r.base);
  poner("B", `B5. ${PREGUNTAS.b5}`, r.b5, r.base);
  poner("B", `B6. ${PREGUNTAS.b6} (varias)`, r.b6, r.b6Base);
  poner("B", `B7. ${PREGUNTAS.b7}`, [{ clave: "SI", texto: "Sí", n: r.b7.si }, { clave: "NO", texto: "No", n: r.b7.no }], r.b7.si + r.b7.no);
  poner("B", `B8. ${PREGUNTAS.b8} (varias)`, r.b8, r.base);
  poner("C", `C1. ${PREGUNTAS.c1}`, r.c1, r.base);
  poner("C", `C2. ${PREGUNTAS.c2}`, r.c2, r.base);
  poner("C", `C3. ${PREGUNTAS.c3}`, r.c3, r.base);
  s3.getColumn("p").numFmt = porc;

  // ---- Respuestas "Otro" (texto libre)
  const s4 = wb.addWorksheet("Respuestas Otro", { views: [{ state: "frozen", ySplit: 1 }] });
  s4.columns = [{ header: "Pregunta", key: "q", width: 36 }, { header: "Lo que escribieron", key: "t", width: 70 }, { header: "Veces", key: "n", width: 10 }];
  encabezado(s4.getRow(1));
  for (const o of r.otros) s4.addRow({ q: o.pregunta, t: o.texto, n: o.n });
  if (!r.otros.length) s4.addRow({ q: "Sin respuestas \"Otro\" en el periodo" });

  // ---- Serie
  const s5 = wb.addWorksheet("Por periodo", { views: [{ state: "frozen", ySplit: 1 }] });
  s5.columns = [{ header: r.rango.granularidad === "hora" ? "Hora" : r.rango.granularidad === "dia" ? "Día" : "Mes", key: "k", width: 18 }, { header: "Cuestionarios aplicados", key: "v", width: 24 }];
  encabezado(s5.getRow(1));
  for (const x of r.serie) s5.addRow({ k: x.etiqueta, v: x.v });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
