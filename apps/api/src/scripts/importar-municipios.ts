// Carga el catálogo de municipios (INEGI, Marco Geoestadístico). Se puede repetir sin duplicar.
//   node --env-file=/var/www/tortilleriasmx/.env dist/scripts/importar-municipios.js
import { pool } from "../db.js";

type Respuesta = { datos: { cvegeo: string; cve_ent: string; nomgeo: string }[] };

const { rows: estados } = await pool.query("SELECT clave FROM estados ORDER BY clave");
let total = 0;

for (const { clave } of estados) {
  const r = await fetch(`https://gaia.inegi.org.mx/wscatgeo/v2/mgem/${clave}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`INEGI respondió ${r.status} para el estado ${clave}`);
  const { datos } = (await r.json()) as Respuesta;
  if (!datos?.length) throw new Error(`Sin municipios para el estado ${clave}`);
  for (const m of datos) {
    await pool.query(
      `INSERT INTO municipios(clave, estado_clave, nombre) VALUES ($1,$2,$3)
       ON CONFLICT (clave) DO UPDATE SET nombre = EXCLUDED.nombre`,
      [m.cvegeo, m.cve_ent, m.nomgeo],
    );
  }
  total += datos.length;
  console.log(`Estado ${clave}: ${datos.length} municipios`);
}
console.log(`Listo: ${total} municipios`);
await pool.end();
