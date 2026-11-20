// Genera un reporte de prueba con datos inventados (para revisar el diseño): tsx src/scripts/demo-reporte.ts <periodo> <salida.pdf>
import { writeFileSync } from "node:fs";
import { calcularRango, type FilaEstado, type Reporte, type Totales } from "../reportes.js";
import { reportePdf } from "../reporte-pdf.js";

const periodo = (process.argv[2] ?? "mes") as any;
const salida = process.argv[3] ?? "demo.pdf";
const r0 = calcularRango(periodo, "2026-11-19", periodo === "rango" ? "2026-11-19" : undefined, "2026-11-19");
if (typeof r0 === "string") throw new Error(r0);
const rango = periodo === "anio" ? r0 : r0;
const nombres = ["Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Coahuila de Zaragoza", "Colima", "Chiapas", "Chihuahua", "Ciudad de México", "Durango", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "México", "Michoacán de Ocampo", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz de Ignacio de la Llave", "Yucatán", "Zacatecas"];
const est = (n: number, p: number): any => ({ tiendas: n, promedio: p, minimo: p - 4, maximo: p + 9 });
const estados: FilaEstado[] = nombres.map((nombre, i) => ({ clave: String(i + 1).padStart(2, "0"), nombre, capturas: 4000 - i * 117, visitadas: 1800 - i * 50, nuevas: i % 7, maiz: est(900 - i * 20, 17 + ((i * 7) % 15) + 0.37), masa: i % 9 === 0 ? { tiendas: 0, promedio: null, minimo: null, maximo: null } : est(500 - i * 10, 14 + ((i * 5) % 11) + 0.2) })).sort((a, b) => b.capturas - a.capturas);
const tot = (k: number): Totales => ({ capturas: 52000 * k, visitadas: 21000 * k, censadores: 84, nuevas: 311, capMaiz: 31000, capMasa: 21000, revisadas: 1900, maiz: est(18000, 24.87 + (k - 1)), masa: est(9000, 18.64) });
const n = rango.granularidad === "hora" ? 24 : rango.granularidad === "dia" ? rango.dias : 12;
const serie = Array.from({ length: n }, (_, i) => ({ k: String(i), etiqueta: rango.granularidad === "hora" ? `${i % 12 || 12} ${i < 12 ? "a. m." : "p. m."}` : rango.granularidad === "dia" ? `${i + 1} nov` : ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"][i] + " 2026", capturas: Math.round(800 + 700 * Math.sin(i / 3) + i * 9), maiz: i === 3 ? null : 24 + Math.sin(i / 4), masa: 18 + Math.cos(i / 5) / 2 }));
const reporte: Reporte = {
  rango, generado: new Date().toISOString(), totales: tot(1), anterior: tot(0.93), serie, estados,
  censo: { catalogo: 112103, conPrecio: 2517 },
  bajas: { total: 214, porMotivo: [{ clave: "cerro", texto: "Cerró definitivamente", n: 120 }, { clave: "local_vacio", texto: "Local vacío, en renta o abandonado", n: 48 }, { clave: "cambio_giro", texto: "El local ahora tiene otro giro (ya no es tortillería)", n: 31 }, { clave: "no_existe", texto: "No existe en la dirección del catálogo", n: 12 }, { clave: "otro", texto: "Otro motivo (especifique)", n: 3 }], porEstado: [{ clave: "11", nombre: "Guanajuato", n: 41 }, { clave: "21", nombre: "Puebla", n: 33 }, { clave: "15", nombre: "México", n: 27 }] },
  elaboracion: [{ clave: "maquina", texto: "Máquina", tortillerias: 9120, promedio: 23.4 }, { clave: "mano", texto: "A mano", tortillerias: 4210, promedio: 28.9 }, { clave: "ambas", texto: "Ambas", tortillerias: 1630, promedio: 25.1 }, { clave: "sin_dato", texto: "Sin dato", tortillerias: 3040, promedio: 24.2 }],
  motivos: [["no_conoce", 193], ["inseguridad", 154], ["otro", 130], ["se_nego", 66], ["sin_rfc", 46], ["desconfianza", 36], ["cerrado", 12]].map(([clave, n]) => ({ clave: clave as string, texto: ({ no_conoce: "El encargado no conoce los datos / el dueño no está", inseguridad: "Por inseguridad o miedo a extorsión", otro: "Otro motivo", se_nego: "Se negó a proporcionar los datos", sin_rfc: "No tiene RFC (negocio informal)", desconfianza: "Desconfía del uso que se le dará a la información", cerrado: "El establecimiento estaba cerrado" } as any)[clave as string], n: n as number })),
};
writeFileSync(salida, await reportePdf(reporte));
console.log("listo", salida);
