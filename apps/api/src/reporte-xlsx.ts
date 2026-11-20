import ExcelJS from "exceljs";
import { capturasDelPeriodo, MAX_FILAS_DETALLE, textosRango, type Reporte } from "./reportes.js";

/** Reporte en Excel: resumen, por estado, por periodo y el detalle de capturas (sin datos personales ni nombres de tortillerías) */
const GUINDA = "FF611232", DORADO = "FFBC955C", ARENA = "FFF3EADB";

function encabezado(h: ExcelJS.Row) {
  h.height = 24;
  h.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GUINDA } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
}
const dinero = '"$"#,##0.00';

export async function reporteXlsx(r: Reporte): Promise<Buffer> {
  const t = textosRango(r.rango), a = r.totales, p = r.anterior;
  const wb = new ExcelJS.Workbook();
  wb.creator = "TortilleríasMX";
  wb.created = new Date(r.generado);

  // ---- Resumen
  const s1 = wb.addWorksheet("Resumen", { views: [{ showGridLines: false }] });
  s1.columns = [{ width: 38 }, { width: 18 }, { width: 18 }, { width: 18 }];
  s1.mergeCells("A1:D1");
  s1.getCell("A1").value = "TortilleríasMX · Secretaría de Agricultura y Desarrollo Rural";
  s1.getCell("A1").font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  s1.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: GUINDA } };
  s1.getRow(1).height = 26;
  s1.getCell("A1").alignment = { vertical: "middle", indent: 1 };
  s1.mergeCells("A2:D2");
  s1.getCell("A2").value = `${t.tipo}: ${t.titulo}`;
  s1.getCell("A2").font = { bold: true, size: 16, color: { argb: GUINDA } };
  s1.getRow(2).height = 30;
  s1.mergeCells("A3:D3");
  s1.getCell("A3").value = t.horario;
  s1.getCell("A3").font = { color: { argb: "FF6B5A60" } };
  s1.getRow(4).height = 8;
  const cab = s1.getRow(5);
  cab.values = ["Indicador", "Este periodo", `Anterior`, "Diferencia"];
  encabezado(cab);
  const filas: [string, number | null, number | null, string | null][] = [
    ["Capturas que cuentan", a.capturas, p.capturas, "0"],
    ["Tortillerías visitadas", a.visitadas, p.visitadas, "0"],
    ["Tortillerías nuevas", a.nuevas, p.nuevas, "0"],
    ["Censadores activos", a.censadores, p.censadores, "0"],
    ["Capturas de tortilla", a.capMaiz, p.capMaiz, "0"],
    ["Capturas de masa", a.capMasa, p.capMasa, "0"],
    ["Precios atípicos revisados", a.revisadas, p.revisadas, "0"],
    ["Tortilla · promedio por kilo", a.maiz.promedio, p.maiz.promedio, dinero],
    ["Tortilla · mínimo", a.maiz.minimo, p.maiz.minimo, dinero],
    ["Tortilla · máximo", a.maiz.maximo, p.maiz.maximo, dinero],
    ["Masa · promedio por kilo", a.masa.promedio, p.masa.promedio, dinero],
    ["Masa · mínimo", a.masa.minimo, p.masa.minimo, dinero],
    ["Masa · máximo", a.masa.maximo, p.masa.maximo, dinero],
  ];
  filas.forEach(([n, v, pv, fmt], i) => {
    const row = s1.getRow(6 + i);
    row.getCell(1).value = n;
    row.getCell(2).value = v;
    row.getCell(3).value = pv;
    row.getCell(4).value = v != null && pv != null ? { formula: `B${6 + i}-C${6 + i}`, result: v - pv } : null;
    for (const c of [2, 3, 4]) row.getCell(c).numFmt = fmt ?? "0";
    if (i % 2 === 1) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCF9F4" } }; });
  });
  const n0 = 6 + filas.length + 1;
  s1.getCell(`A${n0}`).value = `El periodo anterior es ${t.anterior}. Solo cuentan los precios aprobados de tortillerías validadas; el promedio es entre tortillerías (último precio de cada una en el periodo).`;
  s1.getCell(`A${n0}`).font = { italic: true, size: 10, color: { argb: "FF8A7A80" } };
  s1.mergeCells(`A${n0}:D${n0 + 1}`);
  s1.getCell(`A${n0}`).alignment = { wrapText: true, vertical: "top" };
  s1.getCell(`A${n0 + 3}`).value = `Generado el ${new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" }).format(new Date(r.generado))} (hora de la Ciudad de México)`;
  s1.getCell(`A${n0 + 3}`).font = { size: 10, color: { argb: "FF8A7A80" } };

  // ---- Por estado
  const s2 = wb.addWorksheet("Por estado", { views: [{ state: "frozen", ySplit: 1 }] });
  s2.columns = [
    { header: "Estado", key: "e", width: 26 }, { header: "Capturas", key: "c", width: 12 }, { header: "Tortillerías visitadas", key: "v", width: 14 }, { header: "Nuevas", key: "n", width: 10 },
    { header: "Tortilla · tortillerías con precio", key: "mt", width: 16 }, { header: "Tortilla · promedio", key: "mp", width: 14 }, { header: "Tortilla · mínimo", key: "mm", width: 13 }, { header: "Tortilla · máximo", key: "mx", width: 13 },
    { header: "Masa · tortillerías con precio", key: "at", width: 16 }, { header: "Masa · promedio", key: "ap", width: 14 }, { header: "Masa · mínimo", key: "am", width: 13 }, { header: "Masa · máximo", key: "ax", width: 13 },
  ];
  encabezado(s2.getRow(1));
  for (const e of r.estados)
    s2.addRow({ e: e.nombre, c: e.capturas, v: e.visitadas, n: e.nuevas, mt: e.maiz.tiendas, mp: e.maiz.promedio, mm: e.maiz.minimo, mx: e.maiz.maximo, at: e.masa.tiendas, ap: e.masa.promedio, am: e.masa.minimo, ax: e.masa.maximo });
  const tot = s2.addRow({ e: "Total nacional", c: a.capturas, v: a.visitadas, n: a.nuevas, mt: a.maiz.tiendas, mp: a.maiz.promedio, mm: a.maiz.minimo, mx: a.maiz.maximo, at: a.masa.tiendas, ap: a.masa.promedio, am: a.masa.minimo, ax: a.masa.maximo });
  tot.eachCell((c) => { c.font = { bold: true, color: { argb: GUINDA } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARENA } }; });
  for (const col of ["F", "G", "H", "J", "K", "L"]) s2.getColumn(col).numFmt = dinero;
  s2.autoFilter = { from: "A1", to: "L1" };

  // ---- Por periodo
  const s3 = wb.addWorksheet(r.rango.granularidad === "hora" ? "Por hora" : r.rango.granularidad === "dia" ? "Por día" : "Por mes", { views: [{ state: "frozen", ySplit: 1 }] });
  s3.columns = [{ header: r.rango.granularidad === "hora" ? "Hora" : r.rango.granularidad === "dia" ? "Día" : "Mes", key: "k", width: 18 }, { header: "Capturas", key: "c", width: 12 }, { header: "Tortilla · promedio", key: "m", width: 16 }, { header: "Masa · promedio", key: "a", width: 16 }];
  encabezado(s3.getRow(1));
  for (const q of r.serie) s3.addRow({ k: r.rango.granularidad === "dia" ? q.k : q.etiqueta, c: q.capturas, m: q.maiz, a: q.masa });
  s3.getColumn("C").numFmt = dinero;
  s3.getColumn("D").numFmt = dinero;

  // ---- Sin datos fiscales
  const s4 = wb.addWorksheet("Sin datos fiscales");
  s4.columns = [{ header: "Motivo", key: "m", width: 56 }, { header: "Intentos", key: "n", width: 12 }];
  encabezado(s4.getRow(1));
  for (const m of r.motivos) s4.addRow({ m: m.texto, n: m.n });

  // ---- Actualización del catálogo (bajas)
  const s6 = wb.addWorksheet("Bajas");
  s6.columns = [{ header: "Concepto", key: "c", width: 60 }, { header: "Tortillerías", key: "n", width: 14 }];
  encabezado(s6.getRow(1));
  s6.addRow({ c: "Total dadas de baja en el periodo", n: r.bajas.total }).font = { bold: true };
  s6.addRow({});
  s6.addRow({ c: "Por motivo" }).font = { bold: true, color: { argb: GUINDA } };
  for (const m of r.bajas.porMotivo) s6.addRow({ c: m.texto, n: m.n });
  s6.addRow({});
  s6.addRow({ c: "Por estado" }).font = { bold: true, color: { argb: GUINDA } };
  for (const e of r.bajas.porEstado) s6.addRow({ c: e.nombre, n: e.n });

  // ---- Tipo de elaboración
  const s7 = wb.addWorksheet("Elaboración");
  s7.columns = [{ header: "Tipo de elaboración", key: "t", width: 26 }, { header: "Tortillerías con precio", key: "n", width: 20 }, { header: "Tortilla · promedio por kilo", key: "p", width: 26 }];
  encabezado(s7.getRow(1));
  for (const e of r.elaboracion) s7.addRow({ t: e.texto, n: e.tortillerias, p: e.promedio });
  s7.getColumn("C").numFmt = dinero;

  // ---- Detalle de capturas
  const d = await capturasDelPeriodo(r.rango);
  const s5 = wb.addWorksheet("Capturas", { views: [{ state: "frozen", ySplit: 1 }] });
  s5.columns = [
    { header: "Fecha", key: "fecha", width: 12 }, { header: "Hora", key: "hora", width: 8 }, { header: "Estado", key: "estado", width: 24 }, { header: "Municipio", key: "municipio", width: 28 },
    { header: "Producto", key: "producto", width: 11 }, { header: "Precio por kilo", key: "precio", width: 14 }, { header: "Aprobación", key: "aprobacion", width: 13 }, { header: "Origen de la tortillería", key: "origen", width: 14 },
  ];
  encabezado(s5.getRow(1));
  for (const f of d.filas) s5.addRow({ ...f, origen: f.origen === "denue" ? "DENUE" : f.origen === "nueva" ? "Nueva" : "Propia" });
  s5.getColumn("F").numFmt = dinero;
  s5.autoFilter = { from: "A1", to: "H1" };
  if (d.truncado) {
    const n = s5.addRow([`Solo se incluyen las primeras ${MAX_FILAS_DETALLE.toLocaleString("es-MX")} capturas; elige un periodo más corto para ver todas.`]);
    n.font = { italic: true, color: { argb: DORADO } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
