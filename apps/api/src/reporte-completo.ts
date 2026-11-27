import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { textoElaboracion } from "@tortillerias/shared";
import { pool } from "./db.js";
import { reunirReporte, textosRango, ZONA, type Rango, type Reporte } from "./reportes.js";
import { paginasPrecios, pdfBase } from "./reporte-pdf.js";
import { llenarXlsxPrecios } from "./reporte-xlsx.js";
import { llenarXlsxCuestionario, paginasCuestionario, reunirReporteCuestionario, type ReporteCuest } from "./reporte-cuestionario.js";

/**
 * REPORTE COMPLETO (vista Cuestionarios): en un solo archivo, una portada, el reporte de precios (el de Extras) y el del
 * cuestionario de supervisión, SOLO de tortillerías que elaboran a máquina. Por día, semana, mes, año, rango o de siempre.
 */

export type Universo = { clave: string; texto: string; n: number }[];
export type ReporteCompleto = { rango: Rango; generado: string; precios: Reporte; cuestionario: ReporteCuest; universo: Universo };

/** Primer registro de tortillerías de máquina (precio o cuestionario), para el periodo "de siempre" */
export async function inicioDeSiempre(): Promise<string | null> {
  const { rows: [r] } = await pool.query(
    `SELECT to_char(least(
        (SELECT min(coalesce(p.capturado_en, p.creado_en)) FROM precios_que_cuentan p WHERE p.elaboracion_tortilleria = 'maquina'),
        (SELECT min(coalesce(k.capturado_en, k.creado_en)) FROM tortilleria_cuestionarios k JOIN tortillerias t ON t.id = k.tortilleria_id
          WHERE k.estatus = 'aplicado' AND t.elaboracion = 'maquina')
      ) AT TIME ZONE '${ZONA}', 'YYYY-MM-DD') AS d`,
  );
  return r?.d ?? null;
}

export async function reunirReporteCompleto(rango: Rango): Promise<ReporteCompleto> {
  const [precios, cuestionario, u] = await Promise.all([
    reunirReporte(rango, { soloMaquina: true }),
    reunirReporteCuestionario(rango, null, true),
    pool.query(`SELECT coalesce(elaboracion, 'sin_dato') AS e, count(*)::int AS n FROM tortillerias WHERE estatus <> 'rechazada' AND operacion = 'activa' GROUP BY 1`),
  ]);
  const universo = ["maquina", "ambas", "mano", "sin_dato"].map((clave) => ({
    clave, texto: clave === "sin_dato" ? "Sin dato" : textoElaboracion(clave), n: u.rows.find((x: any) => x.e === clave)?.n ?? 0,
  }));
  return { rango, generado: new Date().toISOString(), precios, cuestionario, universo };
}

export function textosCompleto(r: ReporteCompleto) {
  const t = textosRango(r.rango);
  const tipo = t.tipo.replace("Reporte", "Reporte integral").replace(" de precios", "");
  return { ...t, tipo, nombreArchivo: t.nombreArchivo.replace("TortilleriasMX_Reporte", "TortilleriasMX_ReporteCompleto_Maquina") };
}

/* =============================================================== PDF =============================================================== */

const { tx, parrafo, ancho, degradado, fuente, fmtN, pct, money, assets, colores, W, H, MX } = pdfBase;
const { G, G2, GD, O, V, GRIS } = colores;
type Doc = InstanceType<typeof PDFDocument>;

/** Portada a página completa: periodo, cifras clave del universo de máquina y el índice (se llena al final, ya con los números de página) */
function portada(doc: Doc, r: ReporteCompleto) {
  const t = textosCompleto(r);
  const pr = r.precios.totales, cu = r.cuestionario;
  // fondo guinda con luces
  degradado(doc, 0, 0, W, H, 0, GD, "#7a1a41", false);
  doc.save().circle(W - 120, 120, 330).fillOpacity(0.06).fill("#ffffff").restore();
  doc.save().circle(80, H + 40, 300).fillOpacity(0.1).fill(O).restore();
  doc.save().circle(W * 0.55, H + 120, 220).fillOpacity(0.05).fill("#ffffff").restore();
  doc.fillOpacity(1);
  // logos
  doc.image(assets("logo-gobierno-blanco.png"), MX, 34, { height: 44 });
  doc.save().rect(MX + 160, 36, 1, 40).fillOpacity(0.3).fill("#ffffff").restore();
  doc.image(assets("logo-agricultura-blanco.png"), MX + 182, 38, { height: 37 });
  doc.save().rect(MX + 384, 36, 1, 40).fillOpacity(0.3).fill("#ffffff").restore();
  doc.image(assets("logo-dgtic-blanco.png"), MX + 406, 34, { fit: [170, 42], valign: "center" });
  const a = ancho(doc, "Tortillerías", "Titulo", 27), b = ancho(doc, "MX", "Cuerpo-Bold", 24), xt = W - MX - a - b;
  doc.save().roundedRect(xt - 66, 30, 54, 54, 14).clip();
  doc.image(assets("logo-tortilleriasmx.png"), xt - 66, 30, { width: 54, height: 54 });
  doc.restore();
  tx(doc, "Tortillerías", xt, 42, { font: "Titulo", size: 27, color: "#ffffff" });
  tx(doc, "MX", xt + a, 45, { font: "Cuerpo-Bold", size: 24, color: O });
  doc.rect(MX, 108, W - 2 * MX, 0.8).fillOpacity(0.25).fill("#ffffff");
  doc.fillOpacity(1);

  // ---- columna izquierda: qué es y de qué periodo
  const LX = MX, LW = 640;
  tx(doc, t.tipo.toUpperCase(), LX, 142, { font: "Cuerpo-Bold", size: 12, color: O, spacing: 2.6, width: LW });
  tx(doc, "Tortillerías", LX, 166, { font: "Titulo", size: 66, color: "#ffffff", width: LW });
  tx(doc, "de máquina", LX, 236, { font: "Titulo", size: 66, color: O, width: LW });
  const tam = t.titulo.length > 34 ? 26 : 32;
  tx(doc, t.titulo, LX, 324, { font: "Titulo", size: tam, color: "#ffffff", width: LW });
  doc.roundedRect(LX, 370, 64, 4, 2).fill(O);
  doc.font("Cuerpo-Bold").fontSize(10.5);
  const hh = doc.heightOfString(t.horario, { width: LW - 60 });
  doc.roundedRect(LX, 388, LW - 20, hh + 22, 12).fillOpacity(0.13).fill("#ffffff");
  doc.fillOpacity(1);
  doc.circle(LX + 18, 388 + (hh + 22) / 2, 4).fill(O);
  doc.font("Cuerpo-Bold").fontSize(10.5).fillColor("#ffffff").text(t.horario, LX + 34, 399, { width: LW - 60 });
  parrafo(
    doc,
    "Reporte que reúne en un solo documento los precios de la tortilla y la masa y los resultados del cuestionario de supervisión. Considera únicamente las tortillerías que elaboran a máquina; las que elaboran a mano o de ambas formas no se incluyen.",
    LX, 388 + hh + 40, LW - 20, { size: 12, color: "#ecdde2", gap: 4 },
  );

  // ---- columna derecha: cifras clave
  const RX = 724, RW = W - MX - RX, RY = 142;
  doc.roundedRect(RX, RY, RW, 400, 22).fillOpacity(0.1).fill("#ffffff");
  doc.fillOpacity(1);
  tx(doc, "CIFRAS CLAVE DEL PERIODO", RX + 26, RY + 22, { font: "Cuerpo-Bold", size: 9.5, color: O, spacing: 1.8 });
  const maq = r.universo.find((x) => x.clave === "maquina")?.n ?? 0;
  const cifras: [string, string, string][] = [
    [fmtN(maq), "tortillerías de máquina", "activas en el catálogo"],
    [fmtN(pr.capturas), "capturas de precio", `${fmtN(pr.visitadas)} tortillerías visitadas`],
    [money(pr.maiz.promedio), "tortilla · promedio por kilo", pr.maiz.minimo == null ? "sin precios en el periodo" : `de ${money(pr.maiz.minimo)} a ${money(pr.maiz.maximo)}`],
    [fmtN(cu.totales.tortillerias), "cuestionarios aplicados", `avance acumulado ${pct(cu.avance.porcentaje)}`],
  ];
  cifras.forEach(([v, n, s], i) => {
    const y = RY + 50 + i * 66;
    if (i) doc.save().rect(RX + 26, y - 8, RW - 52, 0.6).fillOpacity(0.2).fill("#ffffff").restore();
    tx(doc, v, RX + 26, y, { font: "Titulo", size: 30, color: "#ffffff", width: 210 });
    tx(doc, n, RX + 236, y + 6, { font: "Cuerpo-Bold", size: 11, color: "#ffffff", width: RW - 262 });
    tx(doc, s, RX + 236, y + 24, { size: 9.5, color: "#e3cfd6", width: RW - 262 });
  });
  // composición del catálogo por tipo de elaboración
  const tot = Math.max(1, r.universo.reduce((s, x) => s + x.n, 0));
  const by = RY + 324, bw = RW - 52;
  tx(doc, `${pct((maq / tot) * 100)} del catálogo activo elabora a máquina`, RX + 26, by, { font: "Cuerpo-Bold", size: 10.5, color: "#ffffff", width: bw });
  const cols = [O, "#f3e7ec", "#c98aa3", "#9a5671"];
  let x = RX + 26;
  doc.save().roundedRect(x, by + 22, bw, 12, 6).clip();
  r.universo.forEach((u, i) => { const w = (bw * u.n) / tot; if (w > 0) doc.rect(x, by + 22, w, 12).fill(cols[i]); x += w; });
  doc.restore();
  let lx = RX + 26;
  r.universo.forEach((u, i) => {
    doc.roundedRect(lx, by + 44, 9, 9, 2).fill(cols[i]);
    const etiqueta = `${u.texto} ${fmtN(u.n)}`;
    tx(doc, etiqueta, lx + 13, by + 42, { size: 8.5, color: "#ffffff" });
    lx += 13 + ancho(doc, etiqueta, "Cuerpo", 8.5) + 14;
  });
}

/** Índice de la portada, con los números de página reales */
function indice(doc: Doc, pagPrecios: number, pagCuest: number, total: number, generado: string) {
  const y = 572, w = (W - 2 * MX - 20) / 2;
  const partes: [string, string, string, number][] = [
    ["PARTE 1", "Precios de la tortilla y la masa", "Capturas, precio por estado, avance del censo, bajas y evolución", pagPrecios],
    ["PARTE 2", "Cuestionario de supervisión", "Avance por estado y respuestas de los bloques A, B y C", pagCuest],
  ];
  partes.forEach(([k, titulo_, sub, pag], i) => {
    const x = MX + i * (w + 20);
    doc.roundedRect(x, y, w, 76, 16).fillOpacity(0.12).fill("#ffffff");
    doc.fillOpacity(1);
    tx(doc, k, x + 22, y + 14, { font: "Cuerpo-Bold", size: 9, color: O, spacing: 1.6 });
    tx(doc, titulo_, x + 22, y + 30, { font: "Titulo", size: 19, color: "#ffffff", width: w - 130 });
    tx(doc, sub, x + 22, y + 54, { size: 9, color: "#e3cfd6", width: w - 130 });
    tx(doc, "PÁGINA", x + w - 100, y + 16, { font: "Cuerpo-Bold", size: 8.5, color: O, spacing: 1.2, width: 80, align: "right" });
    tx(doc, String(pag).padStart(2, "0"), x + w - 100, y + 28, { font: "Titulo", size: 32, color: "#ffffff", width: 80, align: "right" });
  });
  tx(doc, "Secretaría de Agricultura y Desarrollo Rural · Información sensible · uso exclusivo de DGTIC", MX, 676, { size: 10, color: "#e3cfd6" });
  tx(doc, `Generado el ${generado} · ${total} páginas`, W / 2, 676, { size: 10, color: "#e3cfd6", width: W / 2 - MX, align: "right" });
}

export async function reporteCompletoPdf(r: ReporteCompleto): Promise<Buffer> {
  const t = textosCompleto(r);
  const doc = new PDFDocument({ size: [W, H], margin: 0, bufferPages: true, info: { Title: `${t.tipo} · Tortillerías de máquina · ${t.titulo}`, Author: "TortilleríasMX", Subject: "Precios y cuestionario de supervisión · tortillerías de máquina" } });
  doc.registerFont("Cuerpo", fuente("Montserrat-400.woff"));
  doc.registerFont("Cuerpo-Bold", fuente("Montserrat-700.woff"));
  doc.registerFont("Titulo", fuente("Patria-Regular.otf"));
  const trozos: Buffer[] = [];
  const fin = new Promise<Buffer>((ok, mal) => {
    doc.pipe(new Writable({ write(c, _e, cb) { trozos.push(c); cb(); }, final(cb) { ok(Buffer.concat(trozos)); cb(); } }));
    doc.on("error", mal);
  });
  portada(doc, r);
  paginasPrecios(doc, r.precios, false, 1);
  const antesCuest = doc.bufferedPageRange().count;
  paginasCuestionario(doc, r.cuestionario, false, antesCuest);
  const rango = doc.bufferedPageRange();
  const generado = new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, dateStyle: "long", timeStyle: "short" }).format(new Date(r.generado));
  doc.switchToPage(0);
  indice(doc, 2, antesCuest + 1, rango.count, generado);
  for (let i = 1; i < rango.count; i++) {
    doc.switchToPage(i);
    doc.save().moveTo(MX, 684).lineTo(W - MX, 684).lineWidth(0.7).stroke("#e8dfd2").restore();
    tx(doc, "TortilleríasMX", MX, 693, { font: "Cuerpo-Bold", size: 10.5, color: G });
    tx(doc, `· ${i < antesCuest ? "Parte 1 · Precios" : "Parte 2 · Cuestionario"} · solo tortillerías de máquina`, MX + ancho(doc, "TortilleríasMX", "Cuerpo-Bold", 10.5) + 6, 693, { size: 10.5, color: GRIS });
    tx(doc, `${t.tipo} · ${t.titulo} · Página ${i + 1} de ${rango.count}`, W / 2, 693, { size: 10.5, color: GRIS, width: W / 2 - MX, align: "right" });
  }
  doc.end();
  return fin;
}

/* =============================================================== Excel =============================================================== */

const GUINDA = "FF611232";
const logoDgtic = fileURLToPath(new URL("../assets/logo-dgtic-blanco.png", import.meta.url));

export async function reporteCompletoXlsx(r: ReporteCompleto): Promise<Buffer> {
  const t = textosCompleto(r);
  const wb = new ExcelJS.Workbook();
  wb.creator = "TortilleríasMX";
  wb.created = new Date(r.generado);

  // ---- Portada
  const s = wb.addWorksheet("Portada", { views: [{ showGridLines: false }] });
  s.columns = [{ width: 46 }, { width: 22 }, { width: 22 }, { width: 22 }];
  s.mergeCells("A1:D1");
  s.getCell("A1").value = "TortilleríasMX · Secretaría de Agricultura y Desarrollo Rural";
  s.getCell("A1").font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  s.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: GUINDA } };
  s.getCell("A1").alignment = { vertical: "middle", indent: 1 };
  s.getRow(1).height = 40;
  s.addImage(wb.addImage({ filename: logoDgtic, extension: "png" }), { tl: { col: 2.6, row: 0.1 }, ext: { width: 119, height: 34 } });
  s.mergeCells("A2:D2");
  s.getCell("A2").value = `${t.tipo} · Tortillerías de máquina`;
  s.getCell("A2").font = { bold: true, size: 18, color: { argb: GUINDA } };
  s.getRow(2).height = 32;
  s.mergeCells("A3:D3");
  s.getCell("A3").value = t.titulo;
  s.getCell("A3").font = { bold: true, size: 13, color: { argb: "FFBC955C" } };
  s.mergeCells("A4:D4");
  s.getCell("A4").value = t.horario;
  s.getCell("A4").font = { color: { argb: "FF6B5A60" } };
  s.mergeCells("A5:D6");
  s.getCell("A5").value = "Reúne los precios de la tortilla y la masa y los resultados del cuestionario de supervisión. Solo tortillerías que elaboran a máquina; no incluye las que elaboran a mano o de ambas formas. Sin datos personales.";
  s.getCell("A5").alignment = { wrapText: true, vertical: "top" };
  s.getCell("A5").font = { italic: true, size: 10, color: { argb: "FF8A7A80" } };

  const cab = (fila: number, valores: string[]) => {
    const row = s.getRow(fila);
    row.values = valores;
    row.height = 22;
    row.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GUINDA } }; c.alignment = { vertical: "middle", horizontal: "center" }; });
  };
  cab(8, ["Cifra clave", "Valor"]);
  const pr = r.precios.totales, cu = r.cuestionario;
  const filas: [string, number | string | null, string?][] = [
    ["Tortillerías de máquina activas en el catálogo", r.universo.find((x) => x.clave === "maquina")?.n ?? 0],
    ["Capturas de precio en el periodo", pr.capturas],
    ["Tortillerías visitadas con precio", pr.visitadas],
    ["Tortilla · promedio por kilo", pr.maiz.promedio, '"$"#,##0.00'],
    ["Masa · promedio por kilo", pr.masa.promedio, '"$"#,##0.00'],
    ["Cuestionarios aplicados (tortillerías)", cu.totales.tortillerias],
    ["Avance acumulado del cuestionario (%)", cu.avance.porcentaje, '0.0" %"'],
  ];
  filas.forEach(([n, v, f], i) => {
    const row = s.getRow(9 + i);
    row.getCell(1).value = n;
    row.getCell(2).value = v;
    if (f) row.getCell(2).numFmt = f;
    if (i % 2) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCF9F4" } }; });
  });
  const f0 = 9 + filas.length + 1;
  cab(f0, ["Catálogo activo por tipo de elaboración", "Tortillerías", "%"]);
  const tot = Math.max(1, r.universo.reduce((a, x) => a + x.n, 0));
  r.universo.forEach((u, i) => {
    const row = s.getRow(f0 + 1 + i);
    row.values = [u.texto + (u.clave === "maquina" ? " (incluidas en este reporte)" : ""), u.n, Math.round((u.n / tot) * 1000) / 10];
    row.getCell(3).numFmt = '0.0" %"';
    if (u.clave === "maquina") row.font = { bold: true, color: { argb: GUINDA } };
  });
  const c0 = f0 + 1 + r.universo.length + 1;
  cab(c0, ["Contenido del libro", "Hojas"]);
  s.getRow(c0 + 1).values = ["Parte 1 · Precios de la tortilla y la masa", "Hojas que empiezan con «Precios ·»"];
  s.getRow(c0 + 2).values = ["Parte 2 · Cuestionario de supervisión", "Hojas que empiezan con «Cuestionario ·»"];
  s.getCell(`A${c0 + 4}`).value = `Generado el ${new Intl.DateTimeFormat("es-MX", { timeZone: ZONA, dateStyle: "long", timeStyle: "short" }).format(new Date(r.generado))} (hora de la Ciudad de México)`;
  s.getCell(`A${c0 + 4}`).font = { size: 10, color: { argb: "FF8A7A80" } };

  await llenarXlsxPrecios(wb, r.precios, "Precios · ");
  llenarXlsxCuestionario(wb, r.cuestionario, "Cuestionario · ");
  return Buffer.from(await wb.xlsx.writeBuffer());
}
