// Convierte el Excel del DENUE a un archivo compacto (TSV comprimido) listo para importar.
//   node scripts/convertir-denue.mjs "C:/ruta/catalogo_tortillerias_mexico.xlsx" ../../db/denue/denue_311830.tsv.gz
// Limpia los datos y muestra un reporte de calidad. No modifica el Excel original.
import ExcelJS from "exceljs";
import fs from "node:fs";
import zlib from "node:zlib";

const [entrada, salida] = process.argv.slice(2);
if (!entrada || !salida) throw new Error("Uso: node scripts/convertir-denue.mjs <entrada.xlsx> <salida.tsv.gz>");

const COLUMNAS = [
  "id_denue", "clee", "nombre", "razon_social", "telefono", "correo", "entidad", "cve_ent", "municipio", "cve_mun",
  "localidad", "cve_loc", "tipo_vial", "calle", "numero_ext", "numero_int", "colonia", "codigo_postal",
  "latitud", "longitud", "codigo_scian", "personal_ocupado", "fecha_alta",
];

const texto = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") v = v.text ?? v.result ?? "";
  return String(v).replace(/[\t\r\n]+/g, " ").replace(/\s+/g, " ").trim();
};
const num = (v) => {
  const n = Number(texto(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const wb = new ExcelJS.stream.xlsx.WorkbookReader(entrada, { sharedStrings: "cache", worksheets: "emit", styles: "ignore" });
const gz = zlib.createGzip({ level: 9 });
gz.pipe(fs.createWriteStream(salida));
gz.write(COLUMNAS.join("\t") + "\n");

const vistos = new Set();
const r = { filas: 0, escritas: 0, duplicados: 0, sinId: 0, sinNombre: 0, sinCoordenadas: 0, coordenadasFueraDeMexico: 0, claveRara: 0, scian: {}, estados: {} };

for await (const hoja of wb) {
  let idx = null;
  for await (const fila of hoja) {
    const v = fila.values.slice(1);
    if (!idx) { idx = Object.fromEntries(v.map((h, i) => [texto(h), i])); continue; }
    r.filas++;
    const g = (c) => v[idx[c]];
    const id = texto(g("id_denue"));
    if (!id) { r.sinId++; continue; }
    if (vistos.has(id)) { r.duplicados++; continue; }
    vistos.add(id);

    const o = Object.fromEntries(COLUMNAS.map((c) => [c, texto(g(c))]));
    if (!o.nombre) { r.sinNombre++; o.nombre = o.razon_social || "SIN NOMBRE"; }

    // Coordenadas: se validan contra el territorio de México; si no son válidas se dejan vacías (el registro se conserva)
    const lat = num(g("latitud")), lng = num(g("longitud"));
    if (lat === null || lng === null) { r.sinCoordenadas++; o.latitud = ""; o.longitud = ""; }
    else if (lat < 14 || lat > 33.5 || lng < -119 || lng > -86) { r.coordenadasFueraDeMexico++; o.latitud = ""; o.longitud = ""; }
    else { o.latitud = String(lat); o.longitud = String(lng); }

    // Claves INEGI: estado de 2 dígitos y municipio de 3
    o.cve_ent = o.cve_ent.padStart(2, "0");
    o.cve_mun = o.cve_mun.padStart(3, "0");
    if (!/^\d{2}$/.test(o.cve_ent) || !/^\d{3}$/.test(o.cve_mun)) r.claveRara++;

    r.scian[o.codigo_scian] = (r.scian[o.codigo_scian] ?? 0) + 1;
    r.estados[o.entidad] = (r.estados[o.entidad] ?? 0) + 1;
    gz.write(COLUMNAS.map((c) => o[c]).join("\t") + "\n");
    r.escritas++;
  }
}
await new Promise((ok) => gz.end(ok));
await new Promise((ok) => setTimeout(ok, 500));
console.log(JSON.stringify({ ...r, bytes: fs.statSync(salida).size }, null, 2));
