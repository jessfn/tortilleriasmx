import PDFDocument from "pdfkit";
import { Writable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { textosRango, type Estadistica, type FilaEstado, type Reporte, type Totales } from "./reportes.js";

/** Reporte en PDF, estilo presentación (16:9): gráficas dibujadas a mano, sin dependencias de navegador */

const G = "#611232", G2 = "#9D2449", GD = "#3a081e", O = "#BC955C", V = "#285C4D", CREMA = "#FAF7F2", TX = "#4a3a40", GRIS = "#8a7a80", LINEA = "#eadfce", ARENA = "#F3EADB";
const W = 1280, H = 720, MX = 44, TOPE = 660; // márgenes: el contenido va de y=182 a y=660 y el pie a partir de 686
const imgCache = new Map<string, Buffer>();
const assets = (n: string) => {
  let b = imgCache.get(n);
  if (!b) imgCache.set(n, (b = readFileSync(fileURLToPath(new URL(`../assets/${n}`, import.meta.url)))));
  return b;
};

const fuente = (n: string) => readFileSync(fileURLToPath(new URL(`../assets/fonts/${n}`, import.meta.url)));
type Doc = InstanceType<typeof PDFDocument>;
const fmtN = (n: number) => n.toLocaleString("es-MX");
const money = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
const pct = (n: number, d = 1) => `${n.toFixed(d)} %`;

type Opc = { size?: number; font?: string; color?: string; width?: number; align?: "left" | "center" | "right"; spacing?: number; ellipsis?: boolean; opacity?: number };
function tx(doc: Doc, texto: string, x: number, y: number, o: Opc = {}) {
  doc.font(o.font ?? "Cuerpo").fontSize(o.size ?? 12).fillColor(o.color ?? TX).fillOpacity(o.opacity ?? 1);
  doc.text(texto, x, y, { width: o.width, align: o.align ?? "left", lineBreak: false, ellipsis: o.ellipsis ?? !!o.width, characterSpacing: o.spacing ?? 0 });
  doc.fillOpacity(1);
}
/** Texto de varias líneas; devuelve la altura que ocupó */
function parrafo(doc: Doc, texto: string, x: number, y: number, ancho: number, o: Opc & { gap?: number } = {}) {
  doc.font(o.font ?? "Cuerpo").fontSize(o.size ?? 12).fillColor(o.color ?? TX);
  const h = doc.heightOfString(texto, { width: ancho, lineGap: o.gap ?? 2 });
  doc.text(texto, x, y, { width: ancho, lineGap: o.gap ?? 2 });
  return h;
}
const ancho = (doc: Doc, t: string, font: string, size: number, spacing = 0) => doc.font(font).fontSize(size).widthOfString(t, { characterSpacing: spacing });

function tarjeta(doc: Doc, x: number, y: number, w: number, h: number, r = 16) {
  doc.save().roundedRect(x, y + 3, w, h, r).fillOpacity(0.07).fill(G).restore();
  doc.save().roundedRect(x, y, w, h, r).fillColor("#ffffff").fill().restore();
  doc.save().roundedRect(x, y, w, h, r).lineWidth(0.6).strokeOpacity(0.12).stroke(G).restore();
  doc.fillOpacity(1).strokeOpacity(1);
}
function degradado(doc: Doc, x: number, y: number, w: number, h: number, r: number, c1: string, c2: string, horizontal = true) {
  const g = horizontal ? doc.linearGradient(x, y, x + w, y) : doc.linearGradient(x, y, x, y + h);
  g.stop(0, c1).stop(1, c2);
  doc.save().roundedRect(x, y, w, h, r).fill(g).restore();
}
function triangulo(doc: Doc, x: number, y: number, arriba: boolean, color: string, s = 9) {
  doc.save();
  if (arriba) doc.polygon([x, y + s], [x + s, y + s], [x + s / 2, y]);
  else doc.polygon([x, y], [x + s, y], [x + s / 2, y + s]);
  doc.fillColor(color).fill().restore();
}

/* ---------- estructura común ---------- */

function fondo(doc: Doc) {
  doc.rect(0, 0, W, H).fill(CREMA);
  doc.save().circle(1130, 330, 260).fillOpacity(0.05).fill(G2).restore();
  doc.save().circle(70, 700, 190).fillOpacity(0.09).fill(O).restore();
  doc.fillOpacity(1);
}
function encabezado(doc: Doc) {
  degradado(doc, 0, 0, W, 78, 0, GD, "#7a1a41");
  doc.image(assets("logo-gobierno-blanco.png"), MX, 19, { height: 40 });
  doc.save().rect(MX + 150, 21, 1, 36).fillOpacity(0.3).fill("#ffffff").restore();
  doc.image(assets("logo-agricultura-blanco.png"), MX + 172, 22, { height: 34 });
  const a = ancho(doc, "Tortillerías", "Titulo", 25), b = ancho(doc, "MX", "Cuerpo-Bold", 22);
  const xt = W - MX - a - b;
  tx(doc, "Tortillerías", xt, 24, { font: "Titulo", size: 25, color: "#ffffff" });
  tx(doc, "MX", xt + a, 27, { font: "Cuerpo-Bold", size: 22, color: O });
  doc.save().roundedRect(xt - 62, 14, 50, 50, 13).clip();
  doc.image(assets("logo-tortilleriasmx.png"), xt - 62, 14, { width: 50, height: 50 });
  doc.restore();
  doc.rect(0, 78, W, 4).fill(O);
}
function nuevaPagina(doc: Doc, primera = false) {
  if (!primera) doc.addPage();
  fondo(doc);
  encabezado(doc);
}
function titulo(doc: Doc, kick: string, t: string) {
  tx(doc, kick.toUpperCase(), MX, 100, { font: "Cuerpo-Bold", size: 12, color: O, spacing: 2.4 });
  tx(doc, t, MX, 118, { font: "Titulo", size: 32, color: G, width: W - MX * 2 });
  doc.roundedRect(MX, 160, 56, 4, 2).fill(O);
}

/* ---------- gráficas ---------- */

function dona(doc: Doc, cx: number, cy: number, r: number, grosor: number, partes: { v: number; c: string }[], centro: string, sub: string) {
  const tot = partes.reduce((a, p) => a + p.v, 0);
  if (tot <= 0) doc.save().circle(cx, cy, r).lineWidth(grosor).stroke("#efe6d8").restore();
  else {
    const vivas = partes.filter((p) => p.v > 0);
    if (vivas.length === 1) doc.save().circle(cx, cy, r).lineWidth(grosor).stroke(vivas[0].c).restore();
    else {
      let a0 = -Math.PI / 2;
      for (const p of vivas) {
        const a1 = a0 + (p.v / tot) * Math.PI * 2;
        const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1 - 0.015), y1 = cy + r * Math.sin(a1 - 0.015);
        doc.save().path(`M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`).lineWidth(grosor).lineCap("butt").stroke(p.c).restore();
        a0 = a1;
      }
    }
  }
  tx(doc, centro, cx - r + grosor / 2, cy - 11, { font: "Cuerpo-Bold", size: r > 40 ? 17 : 15, color: G, width: (r - grosor / 2) * 2, align: "center" });
  tx(doc, sub, cx - r + grosor / 2, cy + 7, { size: 8.5, color: GRIS, width: (r - grosor / 2) * 2, align: "center" });
}

function ejes(doc: Doc, x: number, y: number, w: number, h: number, max: number, pasos: number, formato: (n: number) => string, lado: "izq" | "der" = "izq") {
  for (let i = 0; i <= pasos; i++) {
    const yy = y + h - (h * i) / pasos;
    if (lado === "izq") doc.save().moveTo(x, yy).lineTo(x + w, yy).lineWidth(0.7).stroke(LINEA).restore();
    const t = formato((max * i) / pasos);
    if (lado === "izq") tx(doc, t, x - 40, yy - 5, { size: 9.5, color: GRIS, width: 34, align: "right" });
    else tx(doc, t, x + w + 6, yy - 5, { size: 9.5, color: GRIS, width: 40 });
  }
}
/** Máximo "redondo" para que los números del eje queden limpios */
function techo(v: number, pasos = 4) {
  if (v <= 0) return pasos;
  const crudo = v / pasos, mag = Math.pow(10, Math.floor(Math.log10(crudo)));
  const paso = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= crudo) ?? 10 * mag;
  return paso * pasos;
}

/** Máximo de un eje de conteos: números enteros y limpios (4 divisiones) */
function techoConteo(v: number) {
  const crudo = Math.max(1, v / 4), mag = Math.pow(10, Math.floor(Math.log10(crudo)));
  return ([1, 2, 5, 10].map((m) => m * mag).find((p) => p >= crudo) ?? 10 * mag) * 4;
}

function barrasVerticales(doc: Doc, x: number, y: number, w: number, h: number, serie: { etiqueta: string; v: number }[], opciones: { colorPico?: boolean } = {}) {
  const max = techoConteo(Math.max(0, ...serie.map((s) => s.v)));
  const izq = 44, baja = 26; // espacio para el eje y las etiquetas
  const ax = x + izq, ay = y, aw = w - izq, ah = h - baja;
  ejes(doc, ax, ay, aw, ah, max, 4, (n) => fmtN(Math.round(n)));
  const n = serie.length, bw = aw / n;
  const pico = serie.reduce((m, s, i) => (s.v > serie[m].v ? i : m), 0);
  const cada = Math.max(1, Math.ceil(n / Math.floor(aw / 54)));
  serie.forEach((s, i) => {
    const bh = (ah * s.v) / max, bx = ax + i * bw + Math.min(4, bw * 0.12), bwid = Math.max(1.5, bw - 2 * Math.min(4, bw * 0.12));
    if (bh > 0.4) {
      if (opciones.colorPico && i === pico && s.v > 0) doc.roundedRect(bx, ay + ah - bh, bwid, bh, Math.min(4, bwid / 2)).fill(G2);
      else degradado(doc, bx, ay + ah - bh, bwid, bh, Math.min(4, bwid / 2), O, "#e6d2ae", false);
    }
    if (i % cada === 0) tx(doc, s.etiqueta, ax + i * bw + bw / 2 - 30, ay + ah + 8, { size: 9.5, color: GRIS, width: 60, align: "center" });
  });
  if (serie[pico]?.v > 0) {
    const bh = (ah * serie[pico].v) / max;
    tx(doc, fmtN(serie[pico].v), ax + pico * bw + bw / 2 - 30, ay + ah - bh - 15, { font: "Cuerpo-Bold", size: 11, color: G2, width: 60, align: "center" });
  }
}

/* ---------- textos de diferencia contra el periodo anterior ---------- */

function diferencia(doc: Doc, x: number, y: number, actual: number | null, previo: number | null, tipo: "conteo" | "precio", anterior: string, ancho_: number) {
  if (tipo === "conteo" && previo === 0 && actual === 0) {
    tx(doc, `Igual que ${anterior}`, x, y, { font: "Cuerpo-Bold", size: 9.5, color: GRIS, width: ancho_ });
    return;
  }
  if (actual == null || previo == null) {
    tx(doc, `Sin datos para comparar con ${anterior}`, x, y, { size: 9.5, color: GRIS, width: ancho_ });
    return;
  }
  if (tipo === "conteo" && previo === 0) {
    tx(doc, `Sin capturas ${anterior}`, x, y, { size: 9.5, color: GRIS, width: ancho_ });
    return;
  }
  const d = actual - previo;
  if (Math.abs(d) < 0.005) {
    tx(doc, `Igual que ${anterior}`, x, y, { font: "Cuerpo-Bold", size: 9.5, color: GRIS, width: ancho_ });
    return;
  }
  const sube = d > 0;
  // en conteos subir es bueno; en precios, subir cuesta más
  const color = (tipo === "conteo") === sube ? V : G2;
  triangulo(doc, x, y + 1.5, sube, color, 8);
  const relativo = Math.abs((d / previo) * 100);
  const texto = tipo === "precio" ? `${money(Math.abs(d))} vs. ${anterior}` : relativo >= 300 ? `${fmtN(Math.abs(d))} más que ${anterior}`.replace("más", d > 0 ? "más" : "menos") : `${pct(relativo)} vs. ${anterior}`;
  tx(doc, texto, x + 13, y, { font: "Cuerpo-Bold", size: 9.5, color, width: ancho_ - 13 });
}

/* ---------- páginas ---------- */

function kpi(doc: Doc, x: number, y: number, w: number, h: number, color: string, titulo_: string, valor: string, unidad: string | null, nota: string, dif: (x: number, y: number, w: number) => void) {
  tarjeta(doc, x, y, w, h, 18);
  doc.save().roundedRect(x, y + 14, 5, h - 28, 2.5).fill(color).restore();
  tx(doc, titulo_.toUpperCase(), x + 20, y + 18, { font: "Cuerpo-Bold", size: 8.5, color: GRIS, spacing: 0.7, width: w - 34 });
  tx(doc, valor, x + 20, y + 40, { font: "Titulo", size: 38, color: G, width: w - 34 });
  if (unidad) tx(doc, unidad, x + 20 + ancho(doc, valor, "Titulo", 38) + 5, y + 62, { size: 11, color: GRIS });
  tx(doc, nota, x + 20, y + 92, { size: 9.5, color: GRIS, width: w - 34 });
  doc.save().rect(x + 20, y + h - 40, w - 40, 0.7).fillOpacity(0.12).fill(G).restore();
  dif(x + 20, y + h - 28, w - 34);
}

function pPortada(doc: Doc, r: Reporte, nTabla: number) {
  const t = textosRango(r.rango);
  const { totales: a, anterior: p } = r;
  // ---- panel izquierdo: de qué periodo es el reporte
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
  doc.font("Cuerpo-Bold").fontSize(10.5);
  const hh = doc.heightOfString(t.horario, { width: PW - 108 });
  doc.roundedRect(PX + 36, y, PW - 72, hh + 22, 12).fillOpacity(0.13).fill("#ffffff");
  doc.fillOpacity(1);
  doc.circle(PX + 54, y + (hh + 22) / 2, 4).fill(O);
  doc.font("Cuerpo-Bold").fontSize(10.5).fillColor("#ffffff").text(t.horario, PX + 70, y + 11, { width: PW - 108 });
  y += hh + 22 + 18;
  parrafo(doc, "Resumen del trabajo del equipo de campo: cuántas capturas llegaron, qué tortillerías se visitaron y cómo se movió el precio de la tortilla y de la masa. Solo cuentan los precios aprobados de tortillerías validadas.", PX + 36, y, PW - 72, { size: 12, color: "#ecdde2", gap: 4 });
  // contenido del reporte (pegado abajo)
  const items: [number, string][] = [
    [2, `Capturas ${t.porUnidad}`],
    [3, "Precio promedio por estado"],
    [4, `Detalle de los ${r.estados.length} estados`],
    [4 + nTabla, "Avance del censo y calidad"],
    [5 + nTabla, "Bajas y tipo de elaboración"],
    [6 + nTabla, "Evolución del precio"],
  ];
  const ly = PY + PH - 40 - items.length * 30;
  tx(doc, "EN ESTE REPORTE", PX + 36, ly - 26, { font: "Cuerpo-Bold", size: 9, color: O, spacing: 1.6 });
  items.forEach(([n, texto], i) => {
    const yy = ly + i * 30;
    doc.save().rect(PX + 36, yy - 4, PW - 72, 0.6).fillOpacity(0.2).fill("#ffffff").restore();
    tx(doc, String(n).padStart(2, "0"), PX + 36, yy + 6, { font: "Titulo", size: 15, color: O });
    tx(doc, texto, PX + 76, yy + 8, { size: 11, color: "#ffffff", width: PW - 130 });
  });

  // ---- cifras del periodo (a la derecha)
  const X = 590, cw = 204, gap = 17, kh = 168;
  const col = (i: number) => X + i * (cw + gap);
  const ant = t.anterior;
  kpi(doc, col(0), 110, cw, kh, G2, "Capturas", fmtN(a.capturas), null, "que cuentan en el periodo", (x, yy, w) => diferencia(doc, x, yy, a.capturas, p.capturas, "conteo", ant, w));
  kpi(doc, col(1), 110, cw, kh, O, "Tortillerías visitadas", fmtN(a.visitadas), null, "con al menos un precio", (x, yy, w) => diferencia(doc, x, yy, a.visitadas, p.visitadas, "conteo", ant, w));
  kpi(doc, col(2), 110, cw, kh, V, "Tortillerías nuevas", fmtN(a.nuevas), null, "dadas de alta en el periodo", (x, yy, w) => diferencia(doc, x, yy, a.nuevas, p.nuevas, "conteo", ant, w));
  const y2 = 110 + kh + 16;
  kpi(doc, col(0), y2, cw, kh, G, "Censadores activos", fmtN(a.censadores), null, "personas que capturaron", (x, yy, w) => diferencia(doc, x, yy, a.censadores, p.censadores, "conteo", ant, w));
  kpi(doc, col(1), y2, cw, kh, G2, "Tortilla · promedio", money(a.maiz.promedio), a.maiz.promedio == null ? null : "/kg", "entre tortillerías", (x, yy, w) => diferencia(doc, x, yy, a.maiz.promedio, p.maiz.promedio, "precio", ant, w));
  kpi(doc, col(2), y2, cw, kh, O, "Masa · promedio", money(a.masa.promedio), a.masa.promedio == null ? null : "/kg", "entre tortillerías", (x, yy, w) => diferencia(doc, x, yy, a.masa.promedio, p.masa.promedio, "precio", ant, w));
  // tarjeta ancha
  const ay = y2 + kh + 16, aw = cw * 3 + gap * 2, ah = TOPE - ay;
  tarjeta(doc, X, ay, aw, ah, 18);
  doc.save().roundedRect(X, ay + 14, 5, ah - 28, 2.5).fill(V).restore();
  tx(doc, "PRECIO MÁS BAJO Y MÁS ALTO · TORTILLA", X + 20, ay + 16, { font: "Cuerpo-Bold", size: 8.5, color: GRIS, spacing: 0.7, width: 290 });
  tx(doc, a.maiz.minimo == null ? "—" : `${money(a.maiz.minimo)} - ${money(a.maiz.maximo)}`, X + 20, ay + 36, { font: "Titulo", size: 30, color: G, width: 290 });
  tx(doc, "por kilo, entre tortillerías", X + 20, ay + 76, { size: 9.5, color: GRIS, width: 290 });
  const solas = a.capturas > 0 ? ((a.capturas - a.revisadas) / a.capturas) * 100 : null;
  doc.save().rect(X + 326, ay + 18, 0.7, 84).fillOpacity(0.15).fill(G).restore();
  tx(doc, "REVISIÓN DE PRECIOS", X + 346, ay + 16, { font: "Cuerpo-Bold", size: 8.5, color: GRIS, spacing: 0.7, width: 280 });
  tx(doc, solas == null ? "—" : pct(solas), X + 346, ay + 36, { font: "Titulo", size: 30, color: G, width: 280 });
  tx(doc, solas == null ? "Sin capturas en el periodo" : `se aprobó sin revisión · ${fmtN(a.revisadas)} atípicos revisados`, X + 346, ay + 76, { size: 9.5, color: GRIS, width: 280 });
  // capturas por producto
  const by = ay + 116;
  doc.save().rect(X + 20, by - 8, aw - 40, 0.7).fillOpacity(0.12).fill(G).restore();
  tx(doc, "CAPTURAS POR PRODUCTO", X + 20, by + 2, { font: "Cuerpo-Bold", size: 8.5, color: GRIS, spacing: 0.7 });
  const bw = aw - 40, tot = Math.max(1, a.capMaiz + a.capMasa), wt = (bw * a.capMaiz) / tot;
  doc.roundedRect(X + 20, by + 20, bw, 12, 6).fill("#efe6d8");
  if (a.capMaiz > 0) degradado(doc, X + 20, by + 20, Math.max(12, wt), 12, 6, G2, G2);
  if (a.capMasa > 0 && wt < bw) doc.save().roundedRect(X + 20, by + 20, bw, 12, 6).clip().rect(X + 20 + wt, by + 20, bw - wt, 12).fill(O).restore();
  tx(doc, `Tortilla ${fmtN(a.capMaiz)}${a.capturas ? ` · ${pct((a.capMaiz / tot) * 100, 0)}` : ""}`, X + 20, by + 40, { font: "Cuerpo-Bold", size: 9.5, color: G2, width: bw / 2 });
  tx(doc, `Masa ${fmtN(a.capMasa)}${a.capturas ? ` · ${pct((a.capMasa / tot) * 100, 0)}` : ""}`, X + 20 + bw / 2, by + 40, { font: "Cuerpo-Bold", size: 9.5, color: "#8a6a35", width: bw / 2, align: "right" });
  if (a.capturas === 0) tx(doc, "No hay capturas que cuenten en este periodo.", X + 20, by + 60, { font: "Cuerpo-Bold", size: 10, color: G2, width: bw });
}

function pSerie(doc: Doc, r: Reporte) {
  const t = textosRango(r.rango), a = r.totales;
  nuevaPagina(doc);
  titulo(doc, "¿Cuántas se registraron?", `Capturas ${t.porUnidad}`);
  tarjeta(doc, MX, 182, 740, 478);
  tx(doc, `Capturas ${r.rango.granularidad === "hora" ? "por hora" : r.rango.granularidad === "dia" ? "por día" : "por mes"} (hora de México)`, MX + 20, 198, { font: "Cuerpo-Bold", size: 13.5, color: G, width: 700 });
  tx(doc, `${t.horario.split(" · ")[0]} · total ${fmtN(a.capturas)}`, MX + 20, 217, { size: 10.5, color: GRIS, width: 700 });
  barrasVerticales(doc, MX + 20, 250, 700, 380, r.serie.map((s) => ({ etiqueta: s.etiqueta, v: s.capturas })), { colorPico: true });

  const X = 802, w = 434;
  // por producto
  tarjeta(doc, X, 182, w, 150);
  tx(doc, "Por producto", X + 20, 198, { font: "Cuerpo-Bold", size: 13.5, color: G });
  dona(doc, X + 90, 268, 40, 15, [{ v: a.capMaiz, c: G2 }, { v: a.capMasa, c: O }], fmtN(a.capturas), "capturas");
  leyenda(doc, X + 176, 232, [{ t: "Tortilla", v: a.capMaiz, c: G2 }, { t: "Masa", v: a.capMasa, c: O }], w - 196);
  // revisión
  tarjeta(doc, X, 344, w, 150);
  tx(doc, "Revisión de precios", X + 20, 360, { font: "Cuerpo-Bold", size: 13.5, color: G });
  const solas = a.capturas - a.revisadas;
  dona(doc, X + 90, 430, 40, 15, [{ v: solas, c: V }, { v: a.revisadas, c: G2 }], a.capturas ? pct((solas / a.capturas) * 100, 0) : "—", "sin revisión");
  leyenda(doc, X + 176, 394, [{ t: "Aprobadas solas", v: solas, c: V }, { t: "Atípicas revisadas", v: a.revisadas, c: G2 }], w - 196);
  // pico
  tarjeta(doc, X, 506, w, 154);
  const pico = r.serie.reduce((m, s) => (s.capturas > m.capturas ? s : m), r.serie[0]);
  doc.save().roundedRect(X + 20, 560, 44, 44, 12).fill(ARENA).restore();
  doc.save().circle(X + 42, 582, 12).lineWidth(2).stroke(G).restore();
  doc.save().moveTo(X + 42, 582).lineTo(X + 42, 574).moveTo(X + 42, 582).lineTo(X + 48, 585).lineWidth(2).stroke(G).restore();
  const nombrePico = r.rango.granularidad === "hora" ? "La hora con más capturas" : r.rango.granularidad === "dia" ? "El día con más capturas" : "El mes con más capturas";
  tx(doc, nombrePico.toUpperCase(), X + 80, 548, { font: "Cuerpo-Bold", size: 9, color: GRIS, spacing: 0.6, width: w - 100 });
  tx(doc, pico && pico.capturas > 0 ? pico.etiqueta : "—", X + 80, 570, { font: "Titulo", size: 26, color: G, width: w - 100 });
  tx(doc, pico && pico.capturas > 0 ? `${fmtN(pico.capturas)} capturas` : "Sin capturas en el periodo", X + 80, 604, { size: 11, color: GRIS, width: w - 100 });
}

function leyenda(doc: Doc, x: number, y: number, items: { t: string; v: number; c: string }[], w: number) {
  items.forEach((it, i) => {
    const yy = y + i * 34;
    doc.roundedRect(x, yy + 3, 11, 11, 3).fill(it.c);
    tx(doc, it.t, x + 20, yy, { size: 11, color: GRIS, width: w - 20 });
    tx(doc, fmtN(it.v), x + 20, yy + 14, { font: "Cuerpo-Bold", size: 14, color: G, width: w - 20 });
  });
}

function pEstados(doc: Doc, r: Reporte) {
  const a = r.totales;
  nuevaPagina(doc);
  titulo(doc, "¿Cuánto cuesta?", "Precio promedio de la tortilla por estado");
  const conPrecio = r.estados.filter((e) => e.maiz.promedio != null);
  const bajo = conPrecio.reduce<FilaEstado | null>((m, e) => (m == null || (e.maiz.promedio ?? 0) < (m.maiz.promedio ?? 0) ? e : m), null);
  const alto = conPrecio.reduce<FilaEstado | null>((m, e) => (m == null || (e.maiz.promedio ?? 0) > (m.maiz.promedio ?? 0) ? e : m), null);
  const masaE = r.estados.filter((e) => e.masa.promedio != null);
  const mb = masaE.reduce<FilaEstado | null>((m, e) => (m == null || (e.masa.promedio ?? 0) < (m.masa.promedio ?? 0) ? e : m), null);
  const ma = masaE.reduce<FilaEstado | null>((m, e) => (m == null || (e.masa.promedio ?? 0) > (m.masa.promedio ?? 0) ? e : m), null);

  // ---- fila de cifras
  const gap = 16, w = (W - MX * 2 - gap * 3) / 4, y = 182, h = 96;
  const x = (i: number) => MX + i * (w + gap);
  tarjeta(doc, x(0), y, w, h, 16);
  degradado(doc, x(0), y, w, h, 16, G, GD, false);
  tx(doc, "PROMEDIO NACIONAL · TORTILLA", x(0) + 18, y + 14, { font: "Cuerpo-Bold", size: 8.5, color: "#ffffff", spacing: 0.7, opacity: 0.8, width: w - 30 });
  tx(doc, money(a.maiz.promedio), x(0) + 18, y + 30, { font: "Titulo", size: 36, color: "#ffffff", width: w - 30 });
  tx(doc, a.maiz.tiendas ? `por kilo · ${fmtN(a.maiz.tiendas)} tortillerías` : "sin precios en el periodo", x(0) + 18, y + 74, { size: 9.5, color: "#ffffff", opacity: 0.85, width: w - 30 });
  const extremo = (i: number, e: FilaEstado | null, abajo: boolean) => {
    tarjeta(doc, x(i), y, w, h, 16);
    doc.save().roundedRect(x(i) + 16, y + 16, 40, 40, 11).fill(abajo ? "#e3efe9" : "#f4dde4").restore();
    triangulo(doc, x(i) + 28, y + 30, !abajo, abajo ? V : G2, 16);
    tx(doc, abajo ? "MÁS BARATO" : "MÁS CARO", x(i) + 68, y + 16, { font: "Cuerpo-Bold", size: 8.5, color: GRIS, spacing: 0.7, width: w - 80 });
    tx(doc, e ? money(e.maiz.promedio) : "—", x(i) + 68, y + 30, { font: "Titulo", size: 26, color: G, width: w - 80 });
    tx(doc, e ? e.nombre : "Sin precios en el periodo", x(i) + 18, y + 70, { font: "Cuerpo-Bold", size: 10.5, color: TX, width: w - 34 });
  };
  extremo(1, bajo, true);
  extremo(2, alto, false);
  tarjeta(doc, x(3), y, w, h, 16);
  tx(doc, "MASA · PROMEDIO NACIONAL", x(3) + 18, y + 14, { font: "Cuerpo-Bold", size: 8.5, color: GRIS, spacing: 0.7, width: w - 30 });
  tx(doc, money(a.masa.promedio), x(3) + 18, y + 28, { font: "Titulo", size: 30, color: G, width: w - 30 });
  if (a.masa.promedio != null) tx(doc, "/kg", x(3) + 24 + ancho(doc, money(a.masa.promedio), "Titulo", 30), y + 44, { size: 10, color: GRIS });
  tx(doc, mb ? `Más barata: ${mb.nombre} ${money(mb.masa.promedio)}` : "Sin precios de masa", x(3) + 18, y + 68, { size: 8.5, color: GRIS, width: w - 30 });
  tx(doc, ma ? `Más cara: ${ma.nombre} ${money(ma.masa.promedio)}` : "", x(3) + 18, y + 80, { size: 8.5, color: GRIS, width: w - 30 });

  // ---- todos los estados (siempre los 32), del más caro al más barato; los que no tienen precio van al final
  const cy = y + h + 16, ch = TOPE - cy;
  tarjeta(doc, MX, cy, W - MX * 2, ch);
  tx(doc, `Precio promedio de la tortilla en los ${r.estados.length} estados · pesos por kilo`, MX + 20, cy + 14, { font: "Cuerpo-Bold", size: 12.5, color: G, width: 700 });
  tx(doc, "Promedio entre tortillerías: cada una cuenta una vez, con su último precio del periodo", MX + 20, cy + 32, { size: 9.5, color: GRIS, width: 800 });
  const lista = [...conPrecio.sort((p, q) => (q.maiz.promedio ?? 0) - (p.maiz.promedio ?? 0)), ...r.estados.filter((e) => e.maiz.promedio == null)];
  const columnas = lista.length > 14 ? 2 : 1;
  const porCol = Math.ceil(lista.length / columnas);
  const areaY = cy + 56, areaH = ch - 56 - 26;
  const fh = Math.min(30, areaH / porCol);
  const colW = (W - MX * 2 - 40 - (columnas - 1) * 36) / columnas;
  const max = techo(Math.max(1, ...conPrecio.map((e) => e.maiz.promedio ?? 0)), 4);
  for (let c = 0; c < columnas; c++) {
    const cx = MX + 20 + c * (colW + 36), nx = 168, x0 = cx + nx + 8, bwMax = colW - nx - 8 - 60;
    for (let i = 0; i <= 4; i++) {
      const xx = x0 + (bwMax * i) / 4;
      doc.save().moveTo(xx, areaY - 2).lineTo(xx, areaY + fh * porCol).lineWidth(0.6).stroke(LINEA).restore();
      tx(doc, `$${Math.round((max * i) / 4)}`, xx - 20, areaY + fh * porCol + 6, { size: 8.5, color: GRIS, width: 40, align: "center" });
    }
    lista.slice(c * porCol, (c + 1) * porCol).forEach((e, i) => {
      const yy = areaY + i * fh, bh = Math.min(14, fh - 5), ty = yy + (fh - 11) / 2;
      tx(doc, e.nombre, cx, ty, { font: "Cuerpo-Bold", size: fh < 20 ? 8.5 : 10, color: G, width: nx, align: "right" });
      if (e.maiz.promedio == null) {
        tx(doc, "Sin precios en el periodo", x0 + 8, ty, { size: 8.5, color: GRIS, width: bwMax });
        return;
      }
      const bw = Math.max(4, (bwMax * e.maiz.promedio) / max);
      degradado(doc, x0, yy + (fh - bh) / 2, bw, bh, Math.min(6, bh / 2), G, O);
      tx(doc, money(e.maiz.promedio), x0 + bw + 6, ty, { font: "Cuerpo-Bold", size: fh < 20 ? 8.5 : 10, color: G2, width: 56 });
    });
  }
}

const FILAS_POR_PAGINA = 14;
const paginasTabla = (n: number) => Math.max(1, Math.ceil(n / FILAS_POR_PAGINA));
function pTabla(doc: Doc, r: Reporte) {
  const grupos: FilaEstado[][] = [];
  const porPagina = Math.ceil(r.estados.length / paginasTabla(r.estados.length)) || 1; // reparto parejo: sin una última página casi vacía
  for (let i = 0; i < r.estados.length; i += porPagina) grupos.push(r.estados.slice(i, i + porPagina));
  if (grupos.length === 0) grupos.push([]);
  const cols = [250, 170, 140, 90, 150, 190, 178];
  const enc = ["Estado", "Capturas", "Visitadas", "Nuevas", "Tortilla · promedio", "Tortilla mín. – máx.", "Masa · promedio"];
  const maxCap = Math.max(1, ...r.estados.map((e) => e.capturas));
  grupos.forEach((g, gi) => {
    nuevaPagina(doc);
    titulo(doc, "Detalle", gi === 0 ? "Registros y precios, estado por estado" : "Registros y precios, estado por estado (continúa)");
    const ultima = gi === grupos.length - 1;
    tarjeta(doc, MX, 182, W - MX * 2, 478);
    // las filas se estiran para llenar la tarjeta (máximo 36, mínimo 24)
    const rh = Math.max(24, Math.min(36, Math.floor((478 - 12 - 30 - 16 - (ultima ? 44 : 0)) / Math.max(g.length, 1))));
    const ty = (rh - 11) / 2;
    let y = 194;
    const x0 = MX + 12;
    degradado(doc, x0, y, W - MX * 2 - 24, 30, 10, G, "#7a1a41");
    let x = x0;
    enc.forEach((e, i) => {
      tx(doc, e.toUpperCase(), x + (i === 0 ? 12 : 0), y + 10, { font: "Cuerpo-Bold", size: 9, color: "#ffffff", spacing: 0.5, width: cols[i] - (i === 0 ? 24 : 14), align: i === 0 ? "left" : "right" });
      x += cols[i];
    });
    y += 30;
    if (g.length === 0) tx(doc, "Sin capturas en el periodo", x0, y + 40, { size: 14, color: GRIS, width: W - MX * 2 - 24, align: "center" });
    g.forEach((e, ri) => {
      if (ri % 2 === 1) doc.save().rect(x0, y, W - MX * 2 - 24, rh).fill("#fcf9f4").restore();
      doc.save().moveTo(x0, y + rh).lineTo(x0 + W - MX * 2 - 24, y + rh).lineWidth(0.6).stroke("#efe6d8").restore();
      let cx = x0;
      const celda = (i: number, t: string, o: Opc = {}) => { tx(doc, t, cx + (i === 0 ? 12 : 0), y + ty, { size: 11, align: i === 0 ? "left" : "right", width: cols[i] - (i === 0 ? 24 : 14), ...o }); cx += cols[i]; };
      celda(0, e.nombre, { font: "Cuerpo-Bold", color: G });
      // capturas con barrita
      const bw = Math.max(3, (70 * e.capturas) / maxCap);
      degradado(doc, cx + cols[1] - 14 - 40 - bw - 0, y + (rh - 7) / 2, bw, 7, 3.5, G2, O);
      tx(doc, fmtN(e.capturas), cx, y + ty, { size: 11, width: cols[1] - 14, align: "right" });
      cx += cols[1];
      celda(2, fmtN(e.visitadas));
      celda(3, fmtN(e.nuevas));
      celda(4, money(e.maiz.promedio), { font: "Cuerpo-Bold", color: G2 });
      celda(5, e.maiz.minimo == null ? "—" : `${money(e.maiz.minimo)} – ${money(e.maiz.maximo)}`);
      celda(6, money(e.masa.promedio));
      y += rh;
    });
    if (gi === grupos.length - 1) {
      const a = r.totales;
      doc.save().roundedRect(x0, y + 6, W - MX * 2 - 24, 30, 10).fill(ARENA).restore();
      let cx = x0;
      const celda = (i: number, t: string) => { tx(doc, t, cx + (i === 0 ? 12 : 0), y + 15, { font: "Cuerpo-Bold", size: 11, color: G, align: i === 0 ? "left" : "right", width: cols[i] - (i === 0 ? 24 : 14) }); cx += cols[i]; };
      celda(0, "Total nacional"); celda(1, fmtN(a.capturas)); celda(2, fmtN(a.visitadas)); celda(3, fmtN(a.nuevas)); celda(4, money(a.maiz.promedio));
      celda(5, a.maiz.minimo == null ? "—" : `${money(a.maiz.minimo)} - ${money(a.maiz.maximo)}`); celda(6, money(a.masa.promedio));
    }
  });
}

function pAvance(doc: Doc, r: Reporte) {
  const t = textosRango(r.rango), a = r.totales, p = r.anterior;
  nuevaPagina(doc);
  titulo(doc, "Avance y calidad", "Cómo va el censo");
  const cw = 385, xs = [MX, MX + cw + 18, MX + (cw + 18) * 2], y = 182, h = 478;
  // 1: avance
  tarjeta(doc, xs[0], y, cw, h);
  tx(doc, "Avance del censo nacional", xs[0] + 20, y + 18, { font: "Cuerpo-Bold", size: 13.5, color: G, width: cw - 40 });
  const av = r.censo.catalogo > 0 ? (r.censo.conPrecio / r.censo.catalogo) * 100 : 0;
  tx(doc, pct(av, 2), xs[0] + 20, y + 48, { font: "Titulo", size: 54, color: G, width: cw - 40 });
  doc.roundedRect(xs[0] + 20, y + 140, cw - 40, 12, 6).fill("#efe6d8");
  if (av > 0) degradado(doc, xs[0] + 20, y + 140, Math.max(12, ((cw - 40) * Math.min(av, 100)) / 100), 12, 6, G2, O);
  parrafo(doc, `${fmtN(r.censo.conPrecio)} de ${fmtN(r.censo.catalogo)} tortillerías del catálogo tienen al menos un precio aprobado (acumulado hasta el fin del periodo). En este periodo se visitaron ${fmtN(a.visitadas)}.`, xs[0] + 20, y + 166, cw - 40, { size: 11, color: GRIS, gap: 3 });
  const filasA: [string, number][] = [["Tortillerías visitadas en el periodo", a.visitadas], ["Censadores activos", a.censadores], ["Tortillerías en el catálogo", r.censo.catalogo]];
  filasA.forEach(([n, v], i) => {
    const yy = y + 226 + i * 56;
    doc.save().rect(xs[0] + 20, yy, cw - 40, 0.7).fillOpacity(0.12).fill(G).restore();
    tx(doc, n, xs[0] + 20, yy + 20, { size: 10.5, color: GRIS, width: cw - 150 });
    tx(doc, fmtN(v), xs[0] + cw - 130, yy + 12, { font: "Titulo", size: 22, color: G, width: 110, align: "right" });
  });
  doc.save().roundedRect(xs[0] + 20, y + h - 84, 44, 44, 12).fill(ARENA).restore();
  tx(doc, "+", xs[0] + 20, y + h - 74, { font: "Cuerpo-Bold", size: 24, color: G, width: 44, align: "center" });
  tx(doc, `${fmtN(a.nuevas)} ${a.nuevas === 1 ? "tortillería nueva" : "tortillerías nuevas"}`, xs[0] + 78, y + h - 80, { font: "Titulo", size: 22, color: G, width: cw - 100 });
  tx(doc, "dadas de alta por los censadores en el periodo", xs[0] + 78, y + h - 54, { size: 10, color: GRIS, width: cw - 100 });
  // 2: sin datos fiscales
  tarjeta(doc, xs[1], y, cw, h);
  tx(doc, "Sin datos fiscales", xs[1] + 20, y + 18, { font: "Cuerpo-Bold", size: 13.5, color: G, width: cw - 40 });
  const totM = r.motivos.reduce((s, m) => s + m.n, 0);
  tx(doc, totM ? `${fmtN(totM)} ${totM === 1 ? "intento" : "intentos"} sin obtener los datos, por motivo` : "Ningún intento sin datos fiscales en el periodo", xs[1] + 20, y + 37, { size: 10.5, color: GRIS, width: cw - 40 });
  if (!r.motivos.length) tx(doc, "Sin intentos registrados", xs[1] + 20, y + h / 2 - 8, { size: 13, color: GRIS, width: cw - 40, align: "center" });
  const maxM = Math.max(1, ...r.motivos.map((m) => m.n));
  r.motivos.slice(0, 7).forEach((m, i) => {
    const yy = y + 78 + i * 56;
    tx(doc, m.texto, xs[1] + 20, yy, { font: "Cuerpo-Bold", size: 10.5, color: TX, width: cw - 40 });
    doc.roundedRect(xs[1] + 20, yy + 20, cw - 90, 12, 6).fill("#f1e8da");
    degradado(doc, xs[1] + 20, yy + 20, Math.max(10, ((cw - 90) * m.n) / maxM), 12, 6, [G, G2, O, V][i % 4], [G, G2, O, V][i % 4]);
    tx(doc, fmtN(m.n), xs[1] + cw - 66, yy + 18, { font: "Cuerpo-Bold", size: 13, color: G, width: 46, align: "right" });
  });
  // 3: frente al periodo anterior
  tarjeta(doc, xs[2], y, cw, h);
  tx(doc, `Frente a ${t.anterior}`, xs[2] + 20, y + 18, { font: "Cuerpo-Bold", size: 13.5, color: G, width: cw - 40 });
  const filas: { t: string; d: number | null; ant: number | null; act: number | null; precio: boolean }[] = [
    { t: "tortilla", d: a.maiz.promedio != null && p.maiz.promedio != null ? a.maiz.promedio - p.maiz.promedio : null, ant: p.maiz.promedio, act: a.maiz.promedio, precio: true },
    { t: "masa", d: a.masa.promedio != null && p.masa.promedio != null ? a.masa.promedio - p.masa.promedio : null, ant: p.masa.promedio, act: a.masa.promedio, precio: true },
    { t: "capturas", d: a.capturas - p.capturas, ant: p.capturas, act: a.capturas, precio: false },
  ];
  filas.forEach((f, i) => {
    const yy = y + 62 + i * 70;
    const sube = (f.d ?? 0) > 0, igual = f.d == null || Math.abs(f.d) < 0.005;
    const color = igual ? GRIS : f.precio ? (sube ? G2 : V) : sube ? V : G2;
    doc.save().roundedRect(xs[2] + 20, yy, 44, 44, 12).fill(igual ? ARENA : f.precio ? (sube ? "#f4dde4" : "#e3efe9") : sube ? "#e3efe9" : "#f4dde4").restore();
    if (!igual) triangulo(doc, xs[2] + 34, yy + 16, sube, color, 16);
    else doc.save().rect(xs[2] + 33, yy + 21, 18, 3).fill(GRIS).restore();
    const grande = f.d == null ? `Sin datos de ${f.t}` : igual ? `Sin cambio en ${f.t}` : f.precio ? `${sube ? "+" : "−"} ${money(Math.abs(f.d))} en ${f.t}` : `${sube ? "+" : "−"} ${fmtN(Math.abs(f.d))} ${f.t}`;
    tx(doc, grande, xs[2] + 78, yy + 3, { font: "Titulo", size: 20, color: G, width: cw - 98 });
    const detalle = f.d == null ? "No hubo precios en uno de los dos periodos" : f.precio ? `De ${money(f.ant)} a ${money(f.act)} por kilo` : `De ${fmtN(f.ant ?? 0)} a ${fmtN(f.act ?? 0)}`;
    tx(doc, detalle, xs[2] + 78, yy + 28, { size: 10.5, color: GRIS, width: cw - 98 });
  });
  const nota = "Cómo se calcula. Cuenta un precio si está aprobado y su tortillería está validada. El promedio es entre tortillerías: una tortillería es un valor, con su último precio del periodo. Los días van de 12:00 a. m. a 11:59 p. m., hora de la Ciudad de México.";
  doc.font("Cuerpo").fontSize(10.5);
  const hn = doc.heightOfString(nota, { width: cw - 68, lineGap: 3 });
  doc.roundedRect(xs[2] + 20, y + h - hn - 56, cw - 40, hn + 36, 12).fill(ARENA);
  parrafo(doc, nota, xs[2] + 34, y + h - hn - 38, cw - 68, { size: 10.5, gap: 3 });
}

function pCatalogo(doc: Doc, r: Reporte) {
  nuevaPagina(doc);
  titulo(doc, "Actualización del catálogo", "Bajas y tipo de elaboración");
  const cw = (W - MX * 2 - 18) / 2, y = 182, h = 478, x2 = MX + cw + 18;

  // ---- izquierda: tortillerías dadas de baja
  tarjeta(doc, MX, y, cw, h);
  tx(doc, "Tortillerías que ya no funcionan", MX + 20, y + 18, { font: "Cuerpo-Bold", size: 13, color: G, width: cw - 40 });
  tx(doc, "Las que los censadores reportaron como dadas de baja en el periodo", MX + 20, y + 37, { size: 9.5, color: GRIS, width: cw - 40 });
  tx(doc, fmtN(r.bajas.total), MX + 20, y + 62, { font: "Titulo", size: 54, color: G, width: 200 });
  tx(doc, r.bajas.total === 1 ? "tortillería dada de baja" : "tortillerías dadas de baja", MX + 30 + ancho(doc, fmtN(r.bajas.total), "Titulo", 54), y + 96, { size: 11, color: GRIS });
  if (r.bajas.total === 0) {
    tx(doc, "Ninguna baja en el periodo", MX + 20, y + h / 2 + 20, { size: 13, color: GRIS, width: cw - 40, align: "center" });
  } else {
    tx(doc, "POR MOTIVO", MX + 20, y + 140, { font: "Cuerpo-Bold", size: 8.5, color: GRIS, spacing: 0.7 });
    const maxM = Math.max(1, ...r.bajas.porMotivo.map((m) => m.n));
    r.bajas.porMotivo.slice(0, 5).forEach((m, i) => {
      const yy = y + 160 + i * 38;
      tx(doc, m.texto, MX + 20, yy, { size: 10, color: TX, width: cw - 90 });
      doc.roundedRect(MX + 20, yy + 17, cw - 90, 9, 4.5).fill("#f1e8da");
      degradado(doc, MX + 20, yy + 17, Math.max(9, ((cw - 90) * m.n) / maxM), 9, 4.5, [G, G2, O, V, "#d1a85f"][i % 5], [G, G2, O, V, "#d1a85f"][i % 5]);
      tx(doc, fmtN(m.n), MX + cw - 62, yy + 12, { font: "Cuerpo-Bold", size: 12, color: G, width: 42, align: "right" });
    });
    tx(doc, "POR ESTADO", MX + 20, y + 362, { font: "Cuerpo-Bold", size: 8.5, color: GRIS, spacing: 0.7 });
    r.bajas.porEstado.slice(0, 3).forEach((e, i) => {
      const yy = y + 382 + i * 26;
      doc.save().rect(MX + 20, yy - 4, cw - 40, 0.6).fillOpacity(0.12).fill(G).restore();
      tx(doc, e.nombre, MX + 20, yy + 4, { font: "Cuerpo-Bold", size: 10.5, color: G, width: cw - 110 });
      tx(doc, fmtN(e.n), MX + cw - 80, yy + 3, { font: "Titulo", size: 15, color: G, width: 60, align: "right" });
    });
  }

  // ---- derecha: tipo de elaboración
  tarjeta(doc, x2, y, cw, h);
  tx(doc, "Tipo de elaboración", x2 + 20, y + 18, { font: "Cuerpo-Bold", size: 13, color: G, width: cw - 40 });
  tx(doc, "Tortillerías con precio en el periodo y precio promedio de la tortilla por tipo", x2 + 20, y + 37, { size: 9.5, color: GRIS, width: cw - 40 });
  const totalE = Math.max(1, r.elaboracion.reduce((a, e) => a + e.tortillerias, 0));
  const colores = [G2, O, V, "#c9bdb0"];
  r.elaboracion.forEach((e, i) => {
    const yy = y + 72 + i * 98;
    doc.save().roundedRect(x2 + 20, yy, 5, 76, 2.5).fill(colores[i]).restore();
    tx(doc, e.texto.toUpperCase(), x2 + 38, yy + 2, { font: "Cuerpo-Bold", size: 9, color: GRIS, spacing: 0.7, width: cw - 200 });
    tx(doc, fmtN(e.tortillerias), x2 + 38, yy + 18, { font: "Titulo", size: 28, color: G, width: 150 });
    tx(doc, e.tortillerias === 1 ? "tortillería" : "tortillerías", x2 + 44 + ancho(doc, fmtN(e.tortillerias), "Titulo", 28), yy + 33, { size: 10, color: GRIS });
    doc.roundedRect(x2 + 38, yy + 56, cw - 78, 9, 4.5).fill("#f1e8da");
    if (e.tortillerias > 0) degradado(doc, x2 + 38, yy + 56, Math.max(9, ((cw - 78) * e.tortillerias) / totalE), 9, 4.5, colores[i], colores[i]);
    tx(doc, e.promedio == null ? "Sin precios" : money(e.promedio), x2 + cw - 190, yy + 14, { font: "Titulo", size: 26, color: G, width: 170, align: "right" });
    tx(doc, e.promedio == null ? "" : "tortilla por kilo", x2 + cw - 190, yy + 42, { size: 9.5, color: GRIS, width: 170, align: "right" });
  });
}

function pEvolucion(doc: Doc, r: Reporte) {
  const a = r.totales, t = textosRango(r.rango);
  nuevaPagina(doc);
  titulo(doc, "Evolución", `Capturas y precio promedio ${t.porUnidad}`);
  tarjeta(doc, MX, 182, 850, 478);
  tx(doc, "Barras: capturas · Líneas: promedio nacional entre tortillerías", MX + 20, 198, { font: "Cuerpo-Bold", size: 13.5, color: G, width: 810 });
  const s = r.serie;
  const x = MX + 20, y = 236, w = 810, h = 372, izq = 44, der = 44, baja = 26;
  const ax = x + izq, aw = w - izq - der, ah = h - baja;
  const maxC = techoConteo(Math.max(0, ...s.map((q) => q.capturas)));
  ejes(doc, ax, y, aw, ah, maxC, 4, (n) => fmtN(Math.round(n)));
  const precios = s.flatMap((q) => [q.maiz, q.masa]).filter((v): v is number => v != null);
  let pmin = 0, pmax = 1;
  if (precios.length) {
    pmin = Math.floor(Math.min(...precios) - 1);
    pmax = Math.ceil(Math.max(...precios) + 1);
    if (pmax - pmin < 4) pmax = pmin + 4;
    pmin = Math.max(0, pmin);
  }
  for (let i = 0; i <= 4; i++) tx(doc, `$${(pmin + ((pmax - pmin) * i) / 4).toFixed(0)}`, ax + aw + 6, y + ah - (ah * i) / 4 - 5, { size: 9.5, color: GRIS, width: 40 });
  const n = s.length, bw = aw / n, cada = Math.max(1, Math.ceil(n / Math.floor(aw / 54)));
  s.forEach((q, i) => {
    const bh = (ah * q.capturas) / maxC, pad = Math.min(4, bw * 0.12);
    if (bh > 0.4) doc.save().roundedRect(ax + i * bw + pad, y + ah - bh, Math.max(1.5, bw - 2 * pad), bh, Math.min(4, bw / 2)).fillOpacity(0.22).fill(G2).restore();
    if (i % cada === 0) tx(doc, q.etiqueta, ax + i * bw + bw / 2 - 30, y + ah + 8, { size: 9.5, color: GRIS, width: 60, align: "center" });
  });
  doc.fillOpacity(1);
  const linea = (clave: "maiz" | "masa", color: string) => {
    let abierta = false;
    const pts: [number, number][] = [];
    s.forEach((q, i) => {
      const v = q[clave];
      if (v == null) { abierta = false; return; }
      const px = ax + i * bw + bw / 2, py = y + ah - (ah * (v - pmin)) / (pmax - pmin);
      if (!abierta) { doc.moveTo(px, py); abierta = true; } else doc.lineTo(px, py);
      pts.push([px, py]);
      // trazo por tramos: se dibuja al terminar cada tramo continuo
      const sig = s[i + 1]?.[clave];
      if (sig == null) { doc.lineWidth(2.6).lineJoin("round").lineCap("round").stroke(color); abierta = false; }
    });
    for (const [px, py] of pts) doc.save().circle(px, py, n > 40 ? 1.6 : 3.4).fill(color).restore();
  };
  linea("maiz", G2);
  linea("masa", V);
  if (!precios.length) tx(doc, "Sin precios en el periodo", ax, y + ah / 2 - 8, { size: 14, color: GRIS, width: aw, align: "center" });
  // leyenda
  let lx = MX + 20;
  for (const [txt, c] of [["Capturas", "#e9c9d3"], ["Tortilla", G2], ["Masa", V]] as const) {
    doc.roundedRect(lx, 628, 11, 11, 3).fill(c);
    tx(doc, txt, lx + 17, 627, { size: 10.5, color: GRIS });
    lx += 17 + ancho(doc, txt, "Cuerpo", 10.5) + 22;
  }
  // resumen
  const X = 912, wc = 324;
  tarjeta(doc, X, 182, wc, 224);
  tx(doc, "Resumen del periodo", X + 20, 198, { font: "Cuerpo-Bold", size: 13.5, color: G, width: wc - 40 });
  const fila = (yy: number, nombre: string, e: Estadistica, c: string) => {
    doc.roundedRect(X + 20, yy + 3, 11, 11, 3).fill(c);
    tx(doc, nombre, X + 38, yy, { font: "Cuerpo-Bold", size: 11.5, color: G });
    tx(doc, money(e.promedio), X + 20, yy + 20, { font: "Titulo", size: 28, color: G, width: 130 });
    tx(doc, e.minimo == null ? "Sin precios" : `Mín. ${money(e.minimo)}  ·  Máx. ${money(e.maximo)}`, X + 20, yy + 56, { size: 10.5, color: GRIS, width: wc - 40 });
    tx(doc, e.tiendas ? `${fmtN(e.tiendas)} tortillerías` : "", X + 150, yy + 32, { size: 10.5, color: GRIS, width: wc - 170, align: "right" });
  };
  fila(232, "Tortilla · por kilo", a.maiz, G2);
  fila(318, "Masa · por kilo", a.masa, V);
  tarjeta(doc, X, 418, wc, 242);
  tx(doc, "Cómo se calcula", X + 20, 434, { font: "Cuerpo-Bold", size: 13.5, color: G, width: wc - 40 });
  parrafo(doc, "Solo cuentan los precios aprobados de tortillerías validadas. El promedio es entre tortillerías: cada una pesa lo mismo, con su último precio del periodo o de cada " + (r.rango.granularidad === "hora" ? "hora" : r.rango.granularidad === "dia" ? "día" : "mes") + ".\n\nLos días van de 12:00 a. m. a 11:59 p. m., hora de la Ciudad de México. Las capturas hechas sin conexión se cuentan en el momento en que se tomaron.", X + 20, 460, wc - 40, { size: 12, gap: 4 });
}

export async function reportePdf(r: Reporte): Promise<Buffer> {
  const t = textosRango(r.rango);
  const doc = new PDFDocument({ size: [W, H], margin: 0, bufferPages: true, info: { Title: `${t.tipo} · ${t.titulo}`, Author: "TortilleríasMX", Subject: "Precios de la tortilla y la masa" } });
  doc.registerFont("Cuerpo", fuente("Montserrat-400.woff"));
  doc.registerFont("Cuerpo-Bold", fuente("Montserrat-700.woff"));
  doc.registerFont("Titulo", fuente("Patria-Regular.otf"));
  const trozos: Buffer[] = [];
  const fin = new Promise<Buffer>((ok, mal) => {
    doc.pipe(new Writable({ write(c, _e, cb) { trozos.push(c); cb(); }, final(cb) { ok(Buffer.concat(trozos)); cb(); } }));
    doc.on("error", mal);
  });
  nuevaPagina(doc, true);
  pPortada(doc, r, paginasTabla(r.estados.length));
  pSerie(doc, r);
  pEstados(doc, r);
  pTabla(doc, r);
  pAvance(doc, r);
  pCatalogo(doc, r);
  pEvolucion(doc, r);
  // pie de página con el número (ya se sabe cuántas hay)
  const rango = doc.bufferedPageRange();
  const generado = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" }).format(new Date(r.generado));
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(i);
    doc.save().moveTo(MX, 684).lineTo(W - MX, 684).lineWidth(0.7).stroke("#e8dfd2").restore();
    tx(doc, "TortilleríasMX", MX, 693, { font: "Cuerpo-Bold", size: 10.5, color: G });
    tx(doc, "· Secretaría de Agricultura y Desarrollo Rural", MX + ancho(doc, "TortilleríasMX", "Cuerpo-Bold", 10.5) + 6, 693, { size: 10.5, color: GRIS });
    tx(doc, `${t.tipo.replace(" de precios", "")} · generado el ${generado} · Página ${i + 1} de ${rango.count}`, W / 2, 693, { size: 10.5, color: GRIS, width: W / 2 - MX, align: "right" });
  }
  doc.end();
  return fin;
}
export type { Totales };
