/**
 * Carga masiva de administradores estatales (C20.8) desde la hoja "Carga" del Excel (o la misma tabla en CSV).
 *
 *   node --env-file=.env dist/scripts/cargar-estatales.js archivo.xlsx                       # PRUEBA: valida y dice qué haría; no escribe nada
 *   node --env-file=.env dist/scripts/cargar-estatales.js archivo.xlsx --aplicar --por=correo@dgtic  # escribe, en UNA transacción
 *   ... --restablecer    también vuelve a generar la contraseña temporal de las cuentas que ya existían
 *   ... --salida=/ruta   carpeta del archivo de credenciales (fuera del repositorio; por omisión la carpeta personal)
 *
 * El archivo de entrada NO lleva contraseñas: se generan aquí, en el servidor. El archivo de credenciales se guarda con permisos solo del dueño
 * y NO se sube a Git: se entrega por un medio seguro y se borra del servidor.
 */
import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hash } from "@node-rs/argon2";
import ExcelJS from "exceljs";
import { correoSchema, curpSchema, textoPrograma } from "@tortillerias/shared";
import { cifrar, hashBusqueda } from "../crypto.js";

export type FilaCarga = {
  fila: number; nombre: string; paterno: string; materno: string; curp: string; correo: string;
  alcance: string; claves: string; programa: string;
};
export type Cliente = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export type Opciones = { aplicar: boolean; restablecer: boolean; por?: string; passwordTemporal: () => string; urlPanel: string };
export type Credencial = { nombre: string; correo: string; estados: string; password: string; liga: string; resultado: "creada" | "actualizada" | "sin cambios" };
export type Resumen = { creadas: number; actualizadas: number; sinCambios: number; errores: { fila: number; mensaje: string }[]; credenciales: Credencial[] };

const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const CAMPOS: Record<string, keyof FilaCarga> = {
  "nombre(s)": "nombre", nombre: "nombre", "apellido paterno": "paterno", "apellido materno": "materno", curp: "curp", "correo (usuario)": "correo", correo: "correo",
  alcance: "alcance", "claves de estado": "claves", "programa de origen": "programa", programa: "programa",
};
const texto = (v: unknown) => {
  if (v == null) return "";
  if (typeof v === "object") { const o = v as { text?: string; result?: unknown; richText?: { text: string }[] }; return String(o.text ?? o.result ?? o.richText?.map((x) => x.text).join("") ?? "").trim(); }
  return String(v).trim();
};

/** Lee la hoja "Carga" de un .xlsx (o un .csv con las mismas columnas) */
export async function leerArchivo(ruta: string): Promise<FilaCarga[]> {
  const filas: string[][] = [];
  if (/\.csv$/i.test(ruta)) {
    for (const linea of readFileSync(ruta, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
      if (!linea.trim()) continue;
      const celdas: string[] = [];
      let actual = "", comillas = false;
      for (const ch of linea) {
        if (ch === '"') comillas = !comillas;
        else if (ch === "," && !comillas) { celdas.push(actual); actual = ""; } else actual += ch;
      }
      celdas.push(actual);
      filas.push(celdas.map((c) => c.trim()));
    }
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(ruta);
    const hoja = wb.getWorksheet("Carga");
    if (!hoja) throw new Error('El archivo no tiene la hoja "Carga"');
    hoja.eachRow({ includeEmpty: false }, (row) => filas.push(Array.from({ length: hoja.columnCount }, (_, i) => texto(row.getCell(i + 1).value))));
  }
  if (!filas.length) throw new Error("El archivo está vacío");
  const mapa = new Map<number, keyof FilaCarga>();
  filas[0].forEach((h, i) => { const c = CAMPOS[sinAcentos(h)]; if (c) mapa.set(i, c); });
  const faltan = (["nombre", "paterno", "materno", "curp", "correo", "alcance", "claves", "programa"] as const).filter((c) => ![...mapa.values()].includes(c));
  if (faltan.length) throw new Error(`Faltan columnas en la hoja: ${faltan.join(", ")}`);
  return filas.slice(1).filter((f) => f.some((c) => c)).map((f, n) => {
    const o: any = { fila: n + 2 };
    mapa.forEach((campo, i) => (o[campo] = f[i] ?? ""));
    return o as FilaCarga;
  });
}

/** Revisa todo ANTES de escribir: CURP, correo, estados que existen, duplicados en el archivo y choques con la base */
export async function validar(db: Cliente, filas: FilaCarga[]): Promise<{ errores: { fila: number; mensaje: string }[]; limpias: (FilaCarga & { estados: string[]; nacional: boolean; programaClave: "oref" | "fertilizantes" })[] }> {
  const errores: { fila: number; mensaje: string }[] = [];
  const { rows: estados } = await db.query("SELECT clave FROM estados");
  const existen = new Set(estados.map((e) => e.clave as string));
  const correos = new Map<string, number>(), curps = new Map<string, number>();
  const limpias: any[] = [];
  for (const f of filas) {
    const malo = (m: string) => errores.push({ fila: f.fila, mensaje: m });
    const nombre = f.nombre.trim(), paterno = f.paterno.trim(), materno = f.materno.trim();
    if (nombre.length < 2) malo("Falta el nombre");
    if (paterno.length < 2) malo("Falta el apellido paterno");
    const c = curpSchema.safeParse(f.curp);
    if (!c.success) malo("CURP inválida");
    const e = correoSchema.safeParse(f.correo);
    if (!e.success) malo("Correo inválido");
    const programa = sinAcentos(f.programa);
    if (programa !== "oref" && programa !== "fertilizantes") malo(`Programa desconocido: "${f.programa}"`);
    const nacional = /^nacional/.test(sinAcentos(f.alcance));
    if (!nacional && sinAcentos(f.alcance) !== "estatal") malo(`Alcance desconocido: "${f.alcance}"`);
    const claves = f.claves.split(",").map((k) => k.trim()).filter((k) => k && k !== "null");
    if (!nacional && !claves.length) malo("Falta al menos una clave de estado");
    for (const k of claves) if (!existen.has(k)) malo(`El estado ${k} no existe`);
    if (c.success) { if (curps.has(c.data)) malo(`CURP repetida en el archivo (fila ${curps.get(c.data)})`); else curps.set(c.data, f.fila); }
    if (e.success) { if (correos.has(e.data)) malo(`Correo repetido en el archivo (fila ${correos.get(e.data)})`); else correos.set(e.data, f.fila); }
    if (c.success && e.success)
      limpias.push({ ...f, nombre, paterno, materno, curp: c.data, correo: e.data, estados: nacional ? [] : [...new Set(claves)], nacional, programaClave: programa as "oref" | "fertilizantes" });
  }
  // choques con la base: una cuenta de OTRO tipo con ese correo o esa CURP no se convierte en silencio
  for (const f of limpias) {
    const { rows } = await db.query("SELECT id, rol, lower(correo) AS correo, curp_hash FROM usuarios WHERE lower(correo) = $1 OR lower(usuario) = $1 OR curp_hash = $2", [f.correo, hashBusqueda(f.curp)]);
    if (rows.some((r) => r.rol !== "estatal")) errores.push({ fila: f.fila, mensaje: "Ya existe una cuenta de otro tipo con ese correo o esa CURP" });
    if (new Set(rows.map((r) => r.id)).size > 1) errores.push({ fila: f.fila, mensaje: "El correo y la CURP pertenecen a cuentas distintas" });
  }
  return { errores, limpias: errores.length ? [] : limpias };
}

/** Carga (o solo simula) las cuentas. Con `aplicar` todo va en una transacción: si algo falla, no queda nada a medias. */
export async function cargar(db: Cliente, filas: FilaCarga[], o: Opciones): Promise<Resumen> {
  const { errores, limpias } = await validar(db, filas);
  const res: Resumen = { creadas: 0, actualizadas: 0, sinCambios: 0, errores, credenciales: [] };
  if (errores.length) return res; // ante cualquier error no se aplica nada
  let por: string | null = null;
  if (o.aplicar) {
    if (!o.por) throw new Error("Falta --por=<correo de la cuenta de DGTIC que hace la carga>");
    const r = await db.query("SELECT id FROM usuarios WHERE lower(correo) = $1 AND rol = 'admin' AND activo", [o.por.toLowerCase()]);
    if (!r.rows[0]) throw new Error(`No hay un administrador activo con el correo ${o.por}`);
    por = r.rows[0].id;
    await db.query("BEGIN");
  }
  try {
    for (const f of limpias) {
      const curpHash = hashBusqueda(f.curp);
      const { rows } = await db.query("SELECT id, estados_alcance, alcance_nacional, programa, nombre, apellido_paterno, apellido_materno, curp_hash FROM usuarios WHERE lower(correo) = $1 OR lower(usuario) = $1 OR curp_hash = $2 LIMIT 1", [f.correo, curpHash]);
      const ex = rows[0];
      const estadosTexto = f.nacional ? "Todos (consulta y revisión)" : f.estados.join(", ");
      const cred = (password: string, resultado: Credencial["resultado"]): Credencial => ({ nombre: `${f.nombre} ${f.paterno} ${f.materno}`.trim(), correo: f.correo, estados: estadosTexto, password, liga: o.urlPanel, resultado });
      if (!ex) {
        const password = o.passwordTemporal();
        if (o.aplicar)
          await db.query(
            `INSERT INTO usuarios(usuario, correo, nombre, apellidos, apellido_paterno, apellido_materno, password_hash, rol, programa, estados_alcance, alcance_nacional,
                                  curp_cifrado, curp_hash, estado_cuenta, datos_completos, debe_cambiar_password, creado_por)
             VALUES ($1,$1,$2,$3,$4,$5,$6,'estatal',$7,$8::text[],$9,$10,$11,'autorizado',true,true,$12)`,
            [f.correo, f.nombre, `${f.paterno} ${f.materno}`.trim(), f.paterno, f.materno, await hash(password), f.programaClave, f.nacional ? null : f.estados, f.nacional, cifrar(f.curp), curpHash, por],
          );
        res.creadas++;
        res.credenciales.push(cred(password, "creada"));
        continue;
      }
      // Ya existía: se actualizan estados y datos; la contraseña NO cambia, salvo con --restablecer
      const mismos =
        ex.programa === f.programaClave && ex.alcance_nacional === f.nacional && ex.nombre === f.nombre && ex.apellido_paterno === f.paterno && ex.apellido_materno === f.materno &&
        JSON.stringify([...(ex.estados_alcance ?? [])].sort()) === JSON.stringify([...(f.nacional ? [] : f.estados)].sort());
      if (mismos && !o.restablecer) {
        res.sinCambios++;
        res.credenciales.push(cred("(sin cambio)", "sin cambios"));
        continue;
      }
      const password = o.restablecer ? o.passwordTemporal() : null;
      if (o.aplicar)
        await db.query(
          `UPDATE usuarios SET nombre = $1, apellidos = $2, apellido_paterno = $3, apellido_materno = $4, programa = $5, estados_alcance = $6::text[], alcance_nacional = $7,
                  curp_cifrado = COALESCE(curp_cifrado, $8), curp_hash = COALESCE(curp_hash, $9), estado_cuenta = 'autorizado', datos_completos = true, activo = true
                  ${password ? ", password_hash = $11, debe_cambiar_password = true" : ""}
            WHERE id = $10`,
          [f.nombre, `${f.paterno} ${f.materno}`.trim(), f.paterno, f.materno, f.programaClave, f.nacional ? null : f.estados, f.nacional, cifrar(f.curp), curpHash, ex.id, ...(password ? [await hash(password)] : [])],
        );
      res.actualizadas++;
      res.credenciales.push(cred(password ?? "(sin cambio)", "actualizada"));
    }
    if (o.aplicar) {
      await db.query("INSERT INTO auditoria(usuario_id, accion, entidad, entidad_id) VALUES ($1,'carga_masiva_estatales','usuarios',$2)", [por, JSON.stringify({ creadas: res.creadas, actualizadas: res.actualizadas })]);
      await db.query("COMMIT");
    }
  } catch (e) {
    if (o.aplicar) await db.query("ROLLBACK");
    throw e;
  }
  return res;
}

/** Archivo de credenciales (.xlsx) fuera del repositorio y solo legible por su dueño */
export async function escribirCredenciales(creds: Credencial[], carpeta: string): Promise<string> {
  if (!existsSync(carpeta)) mkdirSync(carpeta, { recursive: true });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Credenciales");
  ws.columns = [{ header: "Nombre", key: "nombre", width: 40 }, { header: "Correo (usuario)", key: "correo", width: 38 }, { header: "Estados", key: "estados", width: 30 }, { header: "Contraseña temporal", key: "password", width: 22 }, { header: "Acceso al panel", key: "liga", width: 44 }, { header: "Resultado", key: "resultado", width: 14 }];
  ws.getRow(1).font = { bold: true };
  for (const c of creds) ws.addRow(c);
  const ruta = path.join(carpeta, `credenciales-estatales-${new Date().toISOString().replace(/[:.]/g, "-")}.xlsx`);
  await wb.xlsx.writeFile(ruta);
  try { chmodSync(ruta, 0o600); } catch { /* en Windows no aplica */ }
  return ruta;
}

/* ------------------------------------------------------------------ línea de comandos ------------------------------------------------------------------ */

async function principal() {
  const args = process.argv.slice(2);
  const bandera = (n: string) => args.includes(`--${n}`);
  const valor = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const archivo = args.find((a) => !a.startsWith("--"));
  if (!archivo) throw new Error("Uso: cargar-estatales <archivo.xlsx|.csv> [--aplicar --por=<correo de DGTIC>] [--restablecer] [--salida=<carpeta>]");
  const { pool } = await import("../db.js");
  const { passwordTemporal } = await import("../rutas/admin.js");
  const filas = await leerArchivo(archivo);
  const aplicar = bandera("aplicar");
  const cliente = aplicar ? await pool.connect() : pool; // una sola conexión para que la transacción sea una
  try {
    const r = await cargar(cliente as unknown as Cliente, filas, {
      aplicar, restablecer: bandera("restablecer"), por: valor("por"), passwordTemporal: () => passwordTemporal(), urlPanel: process.env.URL_PANEL ?? "https://tortilleriasmx.agricultura.gob.mx/acceso",
    });
    console.log(aplicar ? "== APLICADO ==" : "== PRUEBA (no se escribió nada; usa --aplicar para cargar) ==");
    console.log(`Filas leídas: ${filas.length} · creadas: ${r.creadas} · actualizadas: ${r.actualizadas} · sin cambios: ${r.sinCambios} · errores: ${r.errores.length}`);
    for (const e of r.errores) console.log(`  fila ${e.fila}: ${e.mensaje}`);
    if (r.errores.length) { console.log("No se aplicó nada: corrige el archivo y vuelve a correr."); process.exitCode = 1; return; }
    if (aplicar) {
      const salida = await escribirCredenciales(r.credenciales, valor("salida") ?? path.join(os.homedir(), "credenciales-tortilleriasmx"));
      console.log(`Credenciales guardadas (solo legibles por su dueño): ${salida}\nEntrégalas por un medio seguro y bórralas del servidor. NO las subas a Git.`);
    }
  } finally {
    if (aplicar) (cliente as any).release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  principal().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
}
void fileURLToPath; void textoPrograma;
