import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { domicilioDe, importarLote, parsearLinea, COLUMNAS, type Fila } from "./denue.js";

/**
 * Se prueba contra un PostgreSQL real (embebido). Solo se simulan las funciones de PostGIS que usa el importador
 * (ST_MakePoint y ST_SetSRID); todo lo demás (unnest, ON CONFLICT, RETURNING xmax) es SQL de verdad.
 */
const ESQUEMA = `
CREATE DOMAIN geometry AS text;
CREATE FUNCTION ST_MakePoint(float8, float8) RETURNS text LANGUAGE sql AS $$ SELECT $1::text || ',' || $2::text $$;
CREATE FUNCTION ST_SetSRID(text, int) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;

CREATE TABLE denue_catalogo (
  id_denue text PRIMARY KEY, clee text, nombre text NOT NULL, razon_social text, telefono text, correo text,
  cve_ent text NOT NULL, entidad text, cve_mun text NOT NULL, municipio text, cve_loc text, localidad text,
  tipo_vial text, calle text, numero_ext text, numero_int text, colonia text, codigo_postal text,
  latitud double precision, longitud double precision, codigo_scian text, personal_ocupado text, fecha_alta text,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tortillerias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), id_denue text UNIQUE, nombre text NOT NULL, domicilio text,
  estado_clave text, municipio_clave text, geom geometry, origen text NOT NULL, estatus text NOT NULL DEFAULT 'pendiente',
  foto_principal text, creado_por text, denue_sincronizado_en timestamptz
);
CREATE TABLE capturas_precio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tortilleria_id uuid NOT NULL REFERENCES tortillerias(id),
  precio_kg numeric NOT NULL, capturista_id text
);
CREATE TABLE responsables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tortilleria_id uuid NOT NULL REFERENCES tortillerias(id), nombre text NOT NULL
);`;

const fila = (o: Partial<Fila>): Fila => ({ ...Object.fromEntries(COLUMNAS.map((c) => [c, ""])), ...o }) as Fila;

const A = fila({ id_denue: "100", nombre: "TORTILLERIA LA GUERA", cve_ent: "09", cve_mun: "015", tipo_vial: "CALLE", calle: "MATAMOROS", numero_ext: "106", colonia: "CENTRO", codigo_postal: "06000", latitud: "19.43", longitud: "-99.13", codigo_scian: "311830" });
const B = fila({ id_denue: "101", nombre: "EL MAIZ", cve_ent: "14", cve_mun: "039", latitud: "20.67", longitud: "-103.35" });
const C = fila({ id_denue: "102", nombre: "", razon_social: "JUAN PEREZ", cve_ent: "21", cve_mun: "114" }); // sin nombre ni coordenadas

let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(ESQUEMA);
});
const uno = async (sql: string) => (await db.query<any>(sql)).rows[0];

describe("lectura del archivo", () => {
  it("arma el domicilio legible", () => {
    expect(domicilioDe(A)).toBe("CALLE MATAMOROS 106, COL. CENTRO, C.P. 06000");
    expect(domicilioDe(B)).toBe("");
  });
  it("lee una línea por nombre de columna, sin importar el orden", () => {
    const f = parsearLinea("ZZ\tLA ESPIGA\t77", { razon_social: 0, nombre: 1, id_denue: 2 });
    expect([f.id_denue, f.nombre, f.razon_social]).toEqual(["77", "LA ESPIGA", "ZZ"]);
  });
});

describe("importación del catálogo", () => {
  it("carga catálogo y tortillerías, con los datos limpios", async () => {
    const r = await importarLote(db, [A, B, C]);
    expect(r).toEqual({ nuevas: 3, actualizadas: 0 });
    expect(await uno("SELECT count(*)::int AS n FROM denue_catalogo")).toEqual({ n: 3 });
    const t = await uno("SELECT * FROM tortillerias WHERE id_denue = '100'");
    expect(t).toMatchObject({ nombre: "TORTILLERIA LA GUERA", origen: "denue", estatus: "validada", estado_clave: "09", municipio_clave: "09015", domicilio: "CALLE MATAMOROS 106, COL. CENTRO, C.P. 06000" });
    expect(t.geom).toBe("-99.13,19.43"); // longitud, latitud
    const sinNombre = await uno("SELECT nombre, geom, domicilio FROM tortillerias WHERE id_denue = '102'");
    expect(sinNombre).toEqual({ nombre: "JUAN PEREZ", geom: null, domicilio: null }); // usa la razón social; sin coordenadas no inventa ubicación
  });

  it("se puede repetir sin duplicar", async () => {
    await importarLote(db, [A, B, C]);
    const r = await importarLote(db, [A, B, C]);
    expect(r).toEqual({ nuevas: 0, actualizadas: 3 });
    expect(await uno("SELECT count(*)::int AS n FROM tortillerias")).toEqual({ n: 3 });
    expect(await uno("SELECT count(*)::int AS n FROM denue_catalogo")).toEqual({ n: 3 });
  });

  it("actualizar el DENUE NO pierde lo capturado por los usuarios", async () => {
    await importarLote(db, [A, B]);
    const t = await uno("SELECT id FROM tortillerias WHERE id_denue = '100'");

    // Lo que hicieron los usuarios y supervisores sobre esa tortillería
    await db.query("INSERT INTO capturas_precio (tortilleria_id, precio_kg, capturista_id) VALUES ($1, 24.5, 'u1')", [t.id]);
    await db.query("INSERT INTO responsables (tortilleria_id, nombre) VALUES ($1, 'ANA')", [t.id]);
    await db.query("UPDATE tortillerias SET estatus = 'rechazada', foto_principal = 'f.jpg', creado_por = 'u1' WHERE id = $1", [t.id]);
    // y una tortillería que agregó un usuario (no viene del DENUE)
    await db.query("INSERT INTO tortillerias (nombre, origen, estatus, creado_por) VALUES ('NUEVA DE ANA', 'nueva', 'pendiente', 'u1')");

    // Llega un DENUE nuevo: cambia el nombre y la ubicación de la 100
    const A2 = fila({ ...A, nombre: "TORTILLERIA LA GUERA (NUEVO NOMBRE)", latitud: "19.50", longitud: "-99.20" });
    const r = await importarLote(db, [A2, B]);
    expect(r).toEqual({ nuevas: 0, actualizadas: 2 });

    // El catálogo sí se actualiza…
    expect(await uno("SELECT nombre, geom FROM tortillerias WHERE id_denue = '100'")).toEqual({ nombre: "TORTILLERIA LA GUERA (NUEVO NOMBRE)", geom: "-99.2,19.5" });
    // …y todo lo del usuario queda igual: mismo id, mismas capturas, mismo estatus, foto y autor
    expect((await uno("SELECT id FROM tortillerias WHERE id_denue = '100'")).id).toBe(t.id);
    expect(await uno("SELECT estatus, foto_principal, creado_por FROM tortillerias WHERE id_denue = '100'")).toEqual({ estatus: "rechazada", foto_principal: "f.jpg", creado_por: "u1" });
    expect(await uno(`SELECT count(*)::int AS n FROM capturas_precio WHERE tortilleria_id = '${t.id}'`)).toEqual({ n: 1 });
    expect(await uno(`SELECT count(*)::int AS n FROM responsables WHERE tortilleria_id = '${t.id}'`)).toEqual({ n: 1 });
    expect(await uno("SELECT nombre, estatus FROM tortillerias WHERE origen = 'nueva'")).toEqual({ nombre: "NUEVA DE ANA", estatus: "pendiente" });
  });

  it("un DENUE nuevo agrega solo lo que no existía", async () => {
    await importarLote(db, [A]);
    const r = await importarLote(db, [A, B]);
    expect(r).toEqual({ nuevas: 1, actualizadas: 1 });
    expect(await uno("SELECT count(*)::int AS n FROM tortillerias")).toEqual({ n: 2 });
  });
});
