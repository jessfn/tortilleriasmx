// Carga el catálogo del DENUE en la base. Se puede repetir sin duplicar ni perder lo capturado por los usuarios.
//
//   node --env-file=/var/www/tortilleriasmx/.env dist/scripts/importar-denue.js                 # carga completa
//   node --env-file=/var/www/tortilleriasmx/.env dist/scripts/importar-denue.js --limite=500    # prueba con 500 filas
//   node dist/scripts/importar-denue.js --simular                                                # solo revisa el archivo, sin base de datos
//   node ... importar-denue.js ruta/a/otro_archivo.tsv.gz                                        # otro archivo (p. ej. un DENUE nuevo)
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { COLUMNAS, importarLote, parsearLinea, type Fila } from "../denue.js";

const args = process.argv.slice(2);
const simular = args.includes("--simular");
const limite = Number(args.find((a) => a.startsWith("--limite="))?.split("=")[1] ?? 0) || Infinity;
const archivo =
  args.find((a) => !a.startsWith("--")) ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../db/denue/denue_311830.tsv.gz");
const TAM_LOTE = 2000;

if (!fs.existsSync(archivo)) throw new Error(`No existe el archivo: ${archivo}`);
console.log(`Archivo: ${archivo}${simular ? " (simulación: no se usa la base de datos)" : ""}`);

const pool = simular ? null : (await import("../db.js")).pool;
const rl = readline.createInterface({ input: fs.createReadStream(archivo).pipe(zlib.createGunzip()), crlfDelay: Infinity });

let indice: Record<string, number> | null = null;
let lote: Fila[] = [];
const total = { leidas: 0, nuevas: 0, actualizadas: 0 };
const vistos = new Set<string>();

async function vaciar() {
  if (lote.length === 0) return;
  if (pool) {
    const cliente = await pool.connect();
    try {
      await cliente.query("BEGIN");
      const r = await importarLote(cliente, lote);
      await cliente.query("COMMIT");
      total.nuevas += r.nuevas;
      total.actualizadas += r.actualizadas;
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
  }
  lote = [];
}

for await (const linea of rl) {
  if (!linea) continue;
  if (!indice) {
    const cab = linea.split("\t");
    const falta = COLUMNAS.filter((c) => !cab.includes(c));
    if (falta.length) throw new Error(`Al archivo le faltan columnas: ${falta.join(", ")}`);
    indice = Object.fromEntries(cab.map((c, i) => [c, i]));
    continue;
  }
  if (total.leidas >= limite) break;
  const f = parsearLinea(linea, indice);
  if (!f.id_denue || vistos.has(f.id_denue)) continue; // sin id o repetido dentro del archivo
  vistos.add(f.id_denue);
  total.leidas++;
  lote.push(f);
  if (lote.length >= TAM_LOTE) {
    await vaciar();
    if (total.leidas % 10000 === 0) console.log(`  ${total.leidas.toLocaleString("es-MX")} filas…`);
  }
}
await vaciar();

console.log(
  simular
    ? `Revisadas ${total.leidas.toLocaleString("es-MX")} filas válidas (no se escribió nada).`
    : `Listo. Filas: ${total.leidas.toLocaleString("es-MX")} · tortillerías nuevas: ${total.nuevas.toLocaleString("es-MX")} · actualizadas: ${total.actualizadas.toLocaleString("es-MX")}`,
);
if (pool) {
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM denue_catalogo)::int AS catalogo,
            (SELECT count(*) FROM tortillerias WHERE origen = 'denue')::int AS en_tortillerias,
            (SELECT count(*) FROM tortillerias WHERE origen <> 'denue')::int AS registradas_por_usuarios`,
  );
  console.log("Estado de la base:", rows[0]);
  await pool.end();
}
