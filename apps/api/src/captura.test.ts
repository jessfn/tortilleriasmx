import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { hash } from "@node-rs/argon2";
import { auditar } from "./db.js";
import { PGlite } from "@electric-sql/pglite";
import type { FastifyInstance } from "fastify";

/**
 * Reglas del censo contra un PostgreSQL real (embebido): límite diario, datos fiscales una sola vez, validación con foto
 * y mapa por área visible. Solo se simulan las funciones de PostGIS (el punto se guarda como `point` y el rectángulo como `box`);
 * todo lo demás (índice único, ON CONFLICT, la migración 006 completa) es SQL de verdad.
 */
const h = vi.hoisted(() => ({ db: null as any }));
vi.mock("./db.js", () => ({
  pool: {
    query: async (sql: string, params?: unknown[]) => {
      const r = await h.db.query(sql, params);
      return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0 };
    },
  },
  auditar: vi.fn(),
}));

const aqui = path.dirname(fileURLToPath(import.meta.url));
const migracion = readFileSync(path.join(aqui, "../../../db/migrations/006_limite_diario_y_datos_nuevos.sql"), "utf8");

const migracion7 = readFileSync(path.join(aqui, "../../../db/migrations/007_sin_conexion.sql"), "utf8");
const migracion8 = readFileSync(path.join(aqui, "../../../db/migrations/008_restablecer_password.sql"), "utf8");

const PRE = `
CREATE DOMAIN geometry AS point;
CREATE DOMAIN geography AS point;
CREATE FUNCTION ST_MakePoint(float8, float8) RETURNS point LANGUAGE sql AS $$ SELECT point($1, $2) $$;
CREATE FUNCTION ST_SetSRID(point, int) RETURNS point LANGUAGE sql AS $$ SELECT $1 $$;
CREATE FUNCTION ST_X(point) RETURNS float8 LANGUAGE sql AS $$ SELECT $1[0] $$;
CREATE FUNCTION ST_Y(point) RETURNS float8 LANGUAGE sql AS $$ SELECT $1[1] $$;
CREATE FUNCTION ST_MakeEnvelope(float8, float8, float8, float8, int) RETURNS box LANGUAGE sql AS $$ SELECT box(point($3, $4), point($1, $2)) $$;
CREATE FUNCTION st_en_caja(point, box) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 <@ $2 $$;
CREATE OPERATOR && (LEFTARG = point, RIGHTARG = box, FUNCTION = st_en_caja);
-- distancia en metros (aprox. plana: suficiente para la prueba de duplicados)
CREATE FUNCTION ST_DWithin(point, point, float8) RETURNS boolean LANGUAGE sql AS $$ SELECT ($1 <-> $2) * 111000 <= $3 $$;

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text NOT NULL DEFAULT '', apellidos text NOT NULL DEFAULT '', usuario text UNIQUE NOT NULL,
  password_hash text NOT NULL DEFAULT 'x', rol text NOT NULL, activo boolean NOT NULL DEFAULT true, correo text, creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE estados (clave text PRIMARY KEY, nombre text NOT NULL);
CREATE TABLE municipios (clave text PRIMARY KEY, estado_clave text, nombre text NOT NULL);
CREATE TABLE tortillerias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), id_denue text UNIQUE, nombre text NOT NULL, domicilio text, estado_clave text,
  municipio_clave text, geom geometry, origen text NOT NULL, estatus text NOT NULL DEFAULT 'pendiente', foto_principal text,
  creado_en timestamptz NOT NULL DEFAULT now(), creado_por uuid REFERENCES usuarios(id)
);
CREATE TABLE denue_catalogo (id_denue text PRIMARY KEY, razon_social text);
CREATE TABLE responsables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tortilleria_id uuid NOT NULL REFERENCES tortillerias(id), nombre text NOT NULL,
  apellidos text NOT NULL, curp_cifrado bytea NOT NULL, curp_hash text NOT NULL, telefono_cifrado bytea NOT NULL, telefono_hash text NOT NULL,
  tipo_persona text NOT NULL, rfc_cifrado bytea NOT NULL, rfc_hash text NOT NULL, razon_social text
);
CREATE TABLE capturas_precio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tortilleria_id uuid NOT NULL REFERENCES tortillerias(id),
  producto text NOT NULL CHECK (producto IN ('maiz','harina','masa')), precio_kg numeric(6,2) NOT NULL CHECK (precio_kg BETWEEN 5 AND 60),
  fecha date NOT NULL DEFAULT current_date, capturista_id uuid REFERENCES usuarios(id), geom_captura geometry, precision_gps real,
  estatus text NOT NULL DEFAULT 'pendiente', alerta boolean NOT NULL DEFAULT false, origen text NOT NULL DEFAULT 'publica',
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fotos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tortilleria_id uuid NOT NULL REFERENCES tortillerias(id), archivo text NOT NULL, miniatura text, capturista_id uuid);
CREATE TABLE alertas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tipo text NOT NULL, captura_id uuid REFERENCES capturas_precio(id));
CREATE TABLE consentimientos (id bigserial PRIMARY KEY, responsable_id uuid REFERENCES responsables(id), version text NOT NULL, aceptado_en timestamptz NOT NULL DEFAULT now());
`;

let app: FastifyInstance;
let base: string;
let ana: string; // censadora 1
let beto: string; // censador 2
let sup: string; // supervisor
let adm: string; // administración
let tA: string; // tortillería del DENUE
let tB: string;
const json = { "content-type": "application/json" };
const auth = (id: string, rol = "capturista") => ({ authorization: `Bearer ${app.jwt.sign({ sub: id, rol: rol as any })}`, ...json });
const post = (url: string, usuario: string, body: unknown, rol?: string) =>
  fetch(base + url, { method: "POST", headers: auth(usuario, rol), body: JSON.stringify(body) });
const get = (url: string, usuario: string, rol?: string) => fetch(base + url, { headers: auth(usuario, rol) });
const q = async (sql: string, params: unknown[] = []) => (await h.db.query(sql, params)).rows as any[];

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "x".repeat(40);
  process.env.ENCRYPTION_KEY = "b".repeat(64);
  h.db = new PGlite();
  await h.db.exec(PRE);
  await h.db.exec(migracion); // la migración real
  await h.db.exec(migracion7);
  await h.db.exec(migracion8);
  process.env.UPLOADS_DIR = mkdtempSync(path.join(tmpdir(), "fotos-"));
  const u = async (nombre: string, rol: string) => (await q("INSERT INTO usuarios(usuario, rol, correo) VALUES ($1,$2,$1) RETURNING id", [nombre, rol]))[0].id;
  ana = await u("ana@correo.com", "capturista");
  beto = await u("beto@correo.com", "capturista");
  sup = await u("sup@correo.com", "supervisor");
  adm = await u("adm@correo.com", "admin");
  await q("INSERT INTO estados VALUES ('09','CIUDAD DE MEXICO')");
  await q("INSERT INTO municipios VALUES ('09015','09','CUAUHTEMOC')");
  await q("INSERT INTO denue_catalogo VALUES ('100', 'JUAN PEREZ SA DE CV')");
  tA = (await q("INSERT INTO tortillerias(id_denue, nombre, domicilio, estado_clave, municipio_clave, geom, origen, estatus) VALUES ('100','LA GUERA','CALLE 5 10','09','09015', point(-99.13, 19.43),'denue','validada') RETURNING id"))[0].id;
  tB = (await q("INSERT INTO tortillerias(nombre, estado_clave, municipio_clave, geom, origen, estatus) VALUES ('EL MAIZ','09','09015', point(-99.14, 19.44),'denue','validada') RETURNING id"))[0].id;
  const { crearApp } = await import("./app.js");
  app = await crearApp();
  base = await app.listen({ port: 0, host: "127.0.0.1" });
}, 170000);
afterAll(async () => {
  await app.close();
});

describe("migración 006", () => {
  it("el día se cuenta en hora de México", async () => {
    const [{ d }] = await q("SELECT (TIMESTAMPTZ '2026-11-07 01:30+00' AT TIME ZONE 'America/Mexico_City')::date::text AS d"); // 19:30 del 6 en México
    expect(d).toBe("2026-11-06");
    const [{ def }] = await q("SELECT pg_get_expr(adbin, adrelid) AS def FROM pg_attrdef WHERE adrelid = 'capturas_precio'::regclass AND adnum = (SELECT attnum FROM pg_attribute WHERE attrelid = 'capturas_precio'::regclass AND attname = 'fecha')");
    expect(def).toMatch(/America\/Mexico_City/);
  });

  it("no pierde datos: la tabla de responsables sigue intacta", async () => {
    expect((await q("SELECT count(*)::int AS n FROM responsables"))[0].n).toBe(0);
    expect((await q("SELECT 1 FROM information_schema.tables WHERE table_name = 'tortilleria_fiscal'")).length).toBe(1);
  });

  it("se detiene sin borrar nada si ya hay capturas duplicadas", async () => {
    const db2 = new PGlite();
    await db2.exec(PRE);
    const t = (await db2.query<any>("INSERT INTO tortillerias(nombre, origen) VALUES ('X','denue') RETURNING id")).rows[0].id;
    const uid = (await db2.query<any>("INSERT INTO usuarios(usuario, rol) VALUES ('a','capturista') RETURNING id")).rows[0].id;
    for (let i = 0; i < 2; i++) await db2.query("INSERT INTO capturas_precio(tortilleria_id, producto, precio_kg, capturista_id) VALUES ($1,'maiz',20,$2)", [t, uid]);
    await expect(db2.exec(migracion)).rejects.toThrow(/capturas duplicadas/);
    // la migración abortó dentro de su transacción: se cierra y se comprueba que no cambió nada
    await db2.exec("ROLLBACK").catch(() => {});
    expect((await db2.query<any>("SELECT count(*)::int AS n FROM capturas_precio")).rows[0].n).toBe(2);
    expect((await db2.query<any>("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'capturas_una_por_dia_uidx'")).rows[0].n).toBe(0);
    await db2.close();
  });
});

describe("límite: una captura por censador, tortillería, producto y día", () => {
  const maiz = (id: string, precio = 24.5) => ({ tortilleriaId: id, producto: "maiz", precioKg: precio });

  it("la primera captura entra (sin GPS también)", async () => {
    const r = await post("/precios", ana, maiz(tA));
    expect(r.status).toBe(201);
    const [c] = await q("SELECT fecha::text AS fecha, geom_captura FROM capturas_precio WHERE capturista_id = $1", [ana]);
    expect(c.geom_captura).toBeNull();
    const [{ hoy }] = await q("SELECT (now() AT TIME ZONE 'America/Mexico_City')::date::text AS hoy");
    expect(c.fecha).toBe(hoy);
  });

  it("la segunda del mismo producto, mismo día, misma tortillería → 409 con el precio ya capturado", async () => {
    const r = await post("/precios", ana, maiz(tA, 30));
    expect(r.status).toBe(409);
    const cuerpo = await r.json();
    expect(cuerpo).toMatchObject({ producto: "maiz", precioKg: 24.5 });
    expect(cuerpo.error).toMatch(/Ya capturaste/);
    expect((await q("SELECT count(*)::int AS n FROM capturas_precio WHERE capturista_id = $1", [ana]))[0].n).toBe(1);
  });

  it("el mismo usuario puede capturar la masa ese mismo día (otro producto)", async () => {
    expect((await post("/precios", ana, { tortilleriaId: tA, producto: "masa", precioKg: 18 })).status).toBe(201);
  });

  it("otro usuario puede capturar el mismo producto ese mismo día", async () => {
    expect((await post("/precios", beto, maiz(tA, 25))).status).toBe(201);
  });

  it("otra tortillería del mismo usuario también entra", async () => {
    expect((await post("/precios", ana, maiz(tB))).status).toBe(201);
  });

  it("al día siguiente el mismo usuario puede volver a capturar", async () => {
    await q("UPDATE capturas_precio SET fecha = fecha - 1 WHERE capturista_id = $1 AND tortilleria_id = $2 AND producto = 'maiz'", [ana, tA]);
    expect((await post("/precios", ana, maiz(tA, 26))).status).toBe(201);
  });

  it("dos peticiones al mismo tiempo: solo una entra y la otra recibe 409 (índice único)", async () => {
    const [r1, r2] = await Promise.all([post("/precios", beto, { tortilleriaId: tB, producto: "masa", precioKg: 17 }), post("/precios", beto, { tortilleriaId: tB, producto: "masa", precioKg: 17 })]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect((await q("SELECT count(*)::int AS n FROM capturas_precio WHERE capturista_id = $1 AND tortilleria_id = $2 AND producto = 'masa'", [beto, tB]))[0].n).toBe(1);
  });

  it("no acepta harina", async () => {
    expect((await post("/precios", ana, { tortilleriaId: tB, producto: "harina", precioKg: 20 })).status).toBe(400);
  });

  it("guarda el GPS cuando viene", async () => {
    await post("/precios", sup, { tortilleriaId: tB, producto: "maiz", precioKg: 22, lat: 19.44, lng: -99.14, precisionGps: 10 });
    const [c] = await q("SELECT geom_captura FROM capturas_precio WHERE capturista_id = $1", [sup]);
    expect(c.geom_captura).not.toBeNull();
  });

  it("mis-precios-hoy dice qué productos ya capturó hoy", async () => {
    const r = await (await get(`/tortillerias/${tA}/mis-precios-hoy`, ana)).json();
    expect(r).toEqual({ maiz: 26, masa: 18 });
    expect(await (await get(`/tortillerias/${tB}/mis-precios-hoy`, ana)).json()).toEqual({ maiz: 24.5, masa: null });
    expect(await (await get(`/tortillerias/${tA}/mis-precios-hoy`, sup)).json()).toEqual({ maiz: null, masa: null });
  });

  it("Mis tortillerías: una fila por tortillería con último precio y si ya capturó hoy", async () => {
    const filas = await (await get("/mis/tortillerias", ana)).json();
    expect(filas).toHaveLength(2);
    const a = filas.find((f: any) => f.id === tA);
    expect(a.ultimo_maiz.precio).toBe(26);
    expect(a.ultima_masa.precio).toBe(18);
    expect([a.maiz_hoy, a.masa_hoy]).toEqual([true, true]);
    const b = filas.find((f: any) => f.id === tB);
    expect([b.maiz_hoy, b.masa_hoy]).toEqual([true, false]);
  });
});

describe("datos fiscales (una sola vez por tortillería)", () => {
  const moral = { tipoPersona: "moral", rfc: "tgu100101ab1", razonSocial: "Tortillería La Guadalupe SA de CV", celular: "5512345678", aceptoAviso: true };

  it("exige aceptar el aviso de privacidad", async () => {
    expect((await post(`/tortillerias/${tA}/fiscal`, ana, { ...moral, aceptoAviso: false })).status).toBe(400);
  });

  it("al inicio no tiene datos fiscales (y se puede saber sin sesión)", async () => {
    expect(await (await get(`/tortillerias/${tA}/fiscal/existe`, ana)).json()).toEqual({ tiene: false });
    expect(await (await fetch(`${base}/tortillerias/${tA}/fiscal/existe`)).json()).toEqual({ tiene: false });
  });

  it("el primero los captura; el RFC se guarda cifrado", async () => {
    const r = await post(`/tortillerias/${tA}/fiscal`, ana, moral);
    expect(r.status).toBe(201);
    const cuerpo = await r.json();
    expect(cuerpo.rfc).toBe("********1AB1"); // solo se ven los últimos 4
    const [f] = await q("SELECT * FROM tortilleria_fiscal WHERE tortilleria_id = $1", [tA]);
    expect(f.razon_social).toBe("TORTILLERIA LA GUADALUPE SA DE CV");
    expect(Buffer.from(f.rfc_cifrado).toString("utf8")).not.toContain("TGU100101AB1");
    expect(f.celular_cifrado).not.toBeNull();
    expect((await q("SELECT count(*)::int AS n FROM consentimientos WHERE tortilleria_id = $1", [tA]))[0].n).toBe(1);
    expect(await (await get(`/tortillerias/${tA}/fiscal/existe`, beto)).json()).toEqual({ tiene: true });
  });

  it("la segunda vez NO sobrescribe: responde 200 con lo existente, enmascarado", async () => {
    const r = await post(`/tortillerias/${tA}/fiscal`, beto, { ...moral, rfc: "ZZZ991231ZZ9", razonSocial: "Otra Empresa" });
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo.existente).toBe(true);
    expect(cuerpo.razonSocial).toBe("TORTILLERIA LA GUADALUPE SA DE CV");
    const [f] = await q("SELECT razon_social FROM tortilleria_fiscal WHERE tortilleria_id = $1", [tA]);
    expect(f.razon_social).toBe("TORTILLERIA LA GUADALUPE SA DE CV");
    expect((await q("SELECT count(*)::int AS n FROM consentimientos WHERE tortilleria_id = $1", [tA]))[0].n).toBe(1);
  });

  it("el mismo RFC puede estar en dos tortillerías (sucursales)", async () => {
    const r = await post(`/tortillerias/${tB}/fiscal`, beto, { ...moral, razonSocial: "Tortillería La Guadalupe Sucursal 2" });
    expect(r.status).toBe(201);
    expect((await q("SELECT count(*)::int AS n FROM tortilleria_fiscal WHERE rfc_hash = (SELECT rfc_hash FROM tortilleria_fiscal WHERE tortilleria_id = $1)", [tA]))[0].n).toBe(2);
  });

  it("el celular es opcional y no se acepta de 9 dígitos", async () => {
    const t = (await q("INSERT INTO tortillerias(nombre, origen) VALUES ('SIN CEL','denue') RETURNING id"))[0].id;
    expect((await post(`/tortillerias/${t}/fiscal`, ana, { ...moral, celular: "551234567" })).status).toBe(400);
    expect((await post(`/tortillerias/${t}/fiscal`, ana, { ...moral, celular: "" })).status).toBe(201);
    expect((await q("SELECT celular_cifrado FROM tortilleria_fiscal WHERE tortilleria_id = $1", [t]))[0].celular_cifrado).toBeNull();
  });

  it("el censador ve los datos enmascarados y el supervisor completos", async () => {
    const c = await (await get(`/tortillerias/${tA}/fiscal`, ana)).json();
    expect(c.rfc).not.toContain("TGU");
    const s = await (await get(`/tortillerias/${tA}/fiscal`, sup, "supervisor")).json();
    expect(s.rfc).toBe("TGU100101AB1");
    expect(s.celular).toBe("5512345678");
  });

  it("un registro viejo en `responsables` cuenta como datos fiscales y no se vuelve a pedir", async () => {
    const t = (await q("INSERT INTO tortillerias(nombre, origen) VALUES ('VIEJA','denue') RETURNING id"))[0].id;
    const { cifrar } = await import("./crypto.js");
    await q(
      `INSERT INTO responsables(tortilleria_id, nombre, apellidos, curp_cifrado, curp_hash, telefono_cifrado, telefono_hash, tipo_persona, rfc_cifrado, rfc_hash, razon_social)
       VALUES ($1,'ANA','PEREZ',$2,'h',$3,'h2','fisica',$4,'h3',NULL)`,
      [t, cifrar("CURPXXXXXXXXXXXXXX"), cifrar("5511111111"), cifrar("PEPA800101AB1")],
    );
    expect(await (await get(`/tortillerias/${t}/fiscal/existe`, ana)).json()).toEqual({ tiene: true });
    const r = await post(`/tortillerias/${t}/fiscal`, ana, moral);
    expect(r.status).toBe(200);
    expect((await q("SELECT count(*)::int AS n FROM tortilleria_fiscal WHERE tortilleria_id = $1", [t]))[0].n).toBe(0);
    const legado = await (await get(`/tortillerias/${t}/fiscal`, sup, "supervisor")).json();
    expect(legado).toMatchObject({ legado: true, rfc: "PEPA800101AB1", razonSocial: "ANA PEREZ" });
  });
});

describe("tortillería nueva", () => {
  const nueva = {
    nombre: "Tortillería Nueva Esperanza", estadoClave: "09", municipioClave: "09015", localidad: "Ciudad de México", tipoVial: "AVENIDA",
    calle: "Hidalgo", numeroExt: "123", numeroInt: "2", colonia: "Centro", codigoPostal: "09700", telefono: "5598765432",
    correo: "nueva@ejemplo.com", personalOcupado: "6 a 10 personas", lat: 19.5, lng: -99.2,
  };
  let id: string;

  it("se guarda con las mismas columnas del DENUE, en mayúsculas sin acentos, y queda pendiente", async () => {
    const r = await post("/tortillerias", ana, nueva);
    expect(r.status).toBe(201);
    id = (await r.json()).id;
    const [t] = await q("SELECT * FROM tortillerias WHERE id = $1", [id]);
    expect(t).toMatchObject({
      nombre: "TORTILLERIA NUEVA ESPERANZA", origen: "nueva", estatus: "pendiente", localidad: "CIUDAD DE MEXICO", tipo_vial: "AVENIDA", calle: "HIDALGO",
      numero_ext: "123", numero_int: "2", colonia: "CENTRO", codigo_postal: "09700", telefono: "5598765432", correo: "nueva@ejemplo.com",
      personal_ocupado: "6 a 10 personas", codigo_scian: "311830",
    });
    expect(t.domicilio).toBe("AVENIDA HIDALGO 123 INT. 2, COL. CENTRO, C.P. 09700"); // mismo formato que domicilioDe() del DENUE
    expect(t.fecha_alta).toMatch(/^\d{4}-\d{2}$/);
    expect(t.creado_por).toBe(ana);
  });

  it("rechaza datos incompletos y detecta duplicados a 50 m con el mismo nombre", async () => {
    expect((await post("/tortillerias", ana, { ...nueva, colonia: "" })).status).toBe(400);
    const dup = await post("/tortillerias", beto, nueva);
    expect(dup.status).toBe(409);
    expect((await dup.json()).posibles).toHaveLength(1);
  });

  it("no se puede validar sin foto; con foto sí", async () => {
    expect((await fetch(`${base}/tortillerias/${id}/estatus`, { method: "PATCH", headers: auth(sup, "supervisor"), body: JSON.stringify({ estatus: "validada" }) })).status).toBe(400);
    expect((await q("SELECT estatus FROM tortillerias WHERE id = $1", [id]))[0].estatus).toBe("pendiente");
    await q("INSERT INTO fotos(tortilleria_id, archivo) VALUES ($1,'f.jpg')", [id]);
    expect((await fetch(`${base}/tortillerias/${id}/estatus`, { method: "PATCH", headers: auth(sup, "supervisor"), body: JSON.stringify({ estatus: "validada" }) })).status).toBe(200);
  });

  it("una tortillería del catálogo se valida o rechaza sin foto", async () => {
    expect((await fetch(`${base}/tortillerias/${tB}/estatus`, { method: "PATCH", headers: auth(sup, "supervisor"), body: JSON.stringify({ estatus: "validada" }) })).status).toBe(200);
  });
});

describe("ubicación cercana", () => {
  it("da el estado y municipio de la tortillería más cercana", async () => {
    const r = await (await fetch(`${base}/ubicacion/cercana?lat=19.431&lng=-99.131`)).json();
    expect(r).toEqual({ estado: { clave: "09", nombre: "CIUDAD DE MEXICO" }, municipio: { clave: "09015", nombre: "CUAUHTEMOC" } });
    expect((await fetch(`${base}/ubicacion/cercana?lat=x`)).status).toBe(400);
  });
});

describe("supervisión: mapa, estadísticas y tendencia", () => {
  const staffGet = (url: string) => get(url, sup, "supervisor");

  it("solo supervisor y administrador", async () => {
    for (const u of ["/admin/mapa?bbox=-100,19,-98,20", "/admin/estadisticas", "/admin/tendencia", "/admin/actividad", `/admin/tortillerias/${tA}`]) {
      expect((await get(u, ana)).status, u).toBe(403);
      expect((await fetch(base + u)).status, u).toBe(401);
    }
  });

  it("el mapa trae el último precio de cada producto y el número de capturas", async () => {
    const r = await (await staffGet("/admin/mapa?bbox=-99.135,19.425,-99.125,19.435")).json();
    expect(r.puntos).toHaveLength(1);
    const p = r.puntos[0];
    expect(p).toMatchObject({ nombre: "LA GUERA", n_capturas: 4, lat: 19.43, lng: -99.13 });
    expect(p.ultimo_maiz.precio).toBe(26); // la más reciente de las capturas de maíz
    expect(p.ultima_masa.precio).toBe(18);
    expect(p.ultimo_maiz.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("'solo con precios' deja fuera las tortillerías sin capturas", async () => {
    const todas = await (await staffGet("/admin/mapa?bbox=-99.2,19.4,-99.1,19.5")).json();
    const conPrecios = await (await staffGet("/admin/mapa?bbox=-99.2,19.4,-99.1,19.5&solo=precios")).json();
    expect(todas.puntos.length).toBeGreaterThan(conPrecios.puntos.length);
    expect(conPrecios.puntos.every((x: any) => x.n_capturas > 0)).toBe(true);
    expect(todas.puntos.find((x: any) => x.n_capturas === 0)).toBeTruthy();
  });

  it("a poco zoom el mapa agrupa en celdas con el precio promedio; al acercarse se separan", async () => {
    const lejos = await (await staffGet("/admin/mapa/celdas?bbox=-100,19,-98,20&zoom=4")).json();
    const total = lejos.celdas.reduce((a: number, c: any) => a + c.n, 0);
    expect(total).toBeGreaterThanOrEqual(2);
    expect(lejos.celdas.length).toBeLessThanOrEqual(total);
    const conMaiz = lejos.celdas.filter((c: any) => c.maiz_n > 0);
    expect(conMaiz.length).toBeGreaterThan(0);
    expect(conMaiz[0].maiz_suma / conMaiz[0].maiz_n).toBeGreaterThan(5); // precio promedio razonable
    expect(conMaiz[0].bbox).toHaveLength(4);
    const cerca = await (await staffGet("/admin/mapa/celdas?bbox=-100,19,-98,20&zoom=17")).json();
    expect(cerca.celdas.length).toBeGreaterThan(lejos.celdas.length);
    expect(cerca.celdas.reduce((a: number, c: any) => a + c.n, 0)).toBe(total); // nada se pierde al cambiar de nivel
  });

  it("el historial de una tortillería trae solo sus capturas", async () => {
    const r = await (await staffGet(`/admin/capturas?tortilleria=${tA}`)).json();
    expect(r.length).toBeGreaterThanOrEqual(4);
    expect(r.every((c: any) => c.tortilleria_id === tA)).toBe(true);
    expect((await staffGet("/admin/capturas?tortilleria=xx")).status).toBe(400);
  });

  it("las celdas respetan 'solo con precios' y rechazan un bbox inválido", async () => {
    const todas = await (await staffGet("/admin/mapa/celdas?bbox=-100,19,-98,20&zoom=17")).json();
    const con = await (await staffGet("/admin/mapa/celdas?bbox=-100,19,-98,20&zoom=17&solo=precios")).json();
    expect(con.celdas.length).toBeLessThan(todas.celdas.length);
    expect(con.celdas.every((c: any) => c.maiz_n + c.masa_n > 0)).toBe(true);
    expect((await staffGet("/admin/mapa/celdas?bbox=xx")).status).toBe(400);
  });

  it("las capturas rechazadas no cuentan en el mapa ni en las estadísticas", async () => {
    await q("INSERT INTO capturas_precio(tortilleria_id, producto, precio_kg, capturista_id, estatus, fecha) VALUES ($1,'maiz',55,$2,'rechazada', current_date - 3)", [tB, sup]);
    const mapa = await (await staffGet("/admin/mapa?bbox=-99.145,19.435,-99.135,19.445")).json();
    expect(mapa.puntos[0].ultimo_maiz.precio).not.toBe(55);
    const est = await (await staffGet("/admin/estadisticas?dias=0")).json();
    expect(est[0].maiz.maximo).not.toBe(55);
  });

  it("estadísticas por estado y por municipio, con su caja para acercar el mapa", async () => {
    const estados = await (await staffGet("/admin/estadisticas")).json();
    const cdmx = estados.find((e: any) => e.clave === "09");
    expect(cdmx).toMatchObject({ nombre: "CIUDAD DE MEXICO" });
    expect(cdmx.tortillerias).toBeGreaterThanOrEqual(2);
    expect(cdmx.con_precios).toBeGreaterThanOrEqual(2);
    expect(cdmx.maiz).toMatchObject({ promedio: expect.any(Number), minimo: expect.any(Number), maximo: expect.any(Number) });
    expect(cdmx.bbox).toHaveLength(4);
    const munis = await (await staffGet("/admin/estadisticas?estado=09")).json();
    expect(munis[0]).toMatchObject({ clave: "09015", nombre: "CUAUHTEMOC" });
    expect((await staffGet("/admin/estadisticas?estado=xx")).status).toBe(400);
  });

  it("el periodo recorta las capturas viejas", async () => {
    await q("UPDATE capturas_precio SET fecha = current_date - 40 WHERE capturista_id = $1 AND tortilleria_id = $2", [ana, tB]);
    const reciente = (await (await staffGet("/admin/estadisticas?dias=7")).json()).find((e: any) => e.clave === "09");
    const todo = (await (await staffGet("/admin/estadisticas?dias=0")).json()).find((e: any) => e.clave === "09");
    expect(todo.capturas).toBeGreaterThan(reciente.capturas);
  });

  it("tendencia diaria con el promedio de maíz y masa", async () => {
    const t = await (await staffGet("/admin/tendencia?dias=0")).json();
    expect(t.length).toBeGreaterThan(0);
    expect(t[0]).toMatchObject({ fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), n: expect.any(Number) });
    expect(t.some((d: any) => d.maiz != null)).toBe(true);
    const porEstado = await (await staffGet("/admin/tendencia?dias=0&estado=14")).json();
    expect(porEstado).toEqual([]);
    expect((await staffGet("/admin/tendencia?municipio=1")).status).toBe(400);
  });

  it("actividad reciente y detalle de una tortillería", async () => {
    const a = await (await staffGet("/admin/actividad?limite=5")).json();
    expect(a.length).toBeLessThanOrEqual(5);
    expect(a[0]).toMatchObject({ nombre: expect.any(String), precio_kg: expect.any(Number) });
    const d = await (await staffGet(`/admin/tortillerias/${tA}`)).json();
    expect(d).toMatchObject({ id: tA, nombre: "LA GUERA", municipio: "CUAUHTEMOC", tiene_fiscal: true });
    expect((await staffGet("/admin/tortillerias/00000000-0000-4000-8000-000000000001")).status).toBe(404);
  });
});

describe("mapa por área visible", () => {
  it("devuelve solo los puntos dentro del rectángulo", async () => {
    const r = await (await fetch(`${base}/tortillerias/mapa?bbox=-99.135,19.425,-99.125,19.435`)).json();
    expect(r.map((x: any) => x.nombre)).toEqual(["LA GUERA"]);
    expect(r[0]).toMatchObject({ lat: 19.43, lng: -99.13, razon_social: "JUAN PEREZ SA DE CV" }); // razón social del catálogo para precargar
    const dos = await (await fetch(`${base}/tortillerias/mapa?bbox=-99.2,19.4,-99.1,19.5`)).json();
    expect(dos.map((x: any) => x.nombre).sort()).toEqual(["EL MAIZ", "LA GUERA", "TORTILLERIA NUEVA ESPERANZA"].sort());
    const ninguno = await (await fetch(`${base}/tortillerias/mapa?bbox=10,10,11,11`)).json();
    expect(ninguno).toEqual([]);
  });

  it("el mapa del censador a poco zoom agrupa por zonas y conserva el total", async () => {
    const lejos = await (await fetch(`${base}/tortillerias/mapa/celdas?bbox=-100,19,-98,20&zoom=4`)).json();
    const cerca = await (await fetch(`${base}/tortillerias/mapa/celdas?bbox=-100,19,-98,20&zoom=17`)).json();
    const suma = (r: any[]) => r.reduce((a, c) => a + c.n, 0);
    expect(suma(lejos)).toBeGreaterThanOrEqual(2);
    expect(suma(cerca)).toBe(suma(lejos));
    expect(cerca.length).toBeGreaterThan(lejos.length);
    expect(lejos[0].bbox).toHaveLength(4);
    expect((await fetch(`${base}/tortillerias/mapa/celdas?bbox=xx`)).status).toBe(400);
  });

  it("excluye las rechazadas y las que no tienen ubicación", async () => {
    await q("INSERT INTO tortillerias(nombre, origen, estatus, geom) VALUES ('RECHAZADA','nueva','rechazada', point(-99.13, 19.431))");
    await q("INSERT INTO tortillerias(nombre, origen, estatus) VALUES ('SIN GEOM','denue','validada')");
    const r = await (await fetch(`${base}/tortillerias/mapa?bbox=-99.135,19.425,-99.125,19.435`)).json();
    expect(r.map((x: any) => x.nombre)).toEqual(["LA GUERA"]);
  });

  it("con demasiados puntos pide acercarse", async () => {
    await q("INSERT INTO tortillerias(nombre, origen, estatus, geom) SELECT 'P' || g, 'denue', 'validada', point(-90 + g * 0.0001, 20) FROM generate_series(1, 5001) g");
    const r = await (await fetch(`${base}/tortillerias/mapa?bbox=-91,19,-89,21`)).json();
    expect(r).toEqual({ demasiadas: true });
  });
});

/* ------------------------------------------------------------------ modo sin conexión (C12) */

describe("sin conexión: idempotencia y fecha real de captura", () => {
  const maiz = (id: string, extra: object = {}) => ({ tortilleriaId: id, producto: "maiz", precioKg: 23, ...extra });
  let tC: string;
  const uid1 = "11111111-1111-4111-8111-111111111111";
  const uid2 = "22222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    tC = (await q("INSERT INTO tortillerias(nombre, estado_clave, municipio_clave, geom, origen, estatus) VALUES ('LA SENAL','09','09015', point(-99.15, 19.45),'denue','validada') RETURNING id"))[0].id;
  });

  it("el mismo idCliente enviado dos veces a /precios deja un solo registro y responde 200 con el mismo id", async () => {
    const a = await post("/precios", ana, maiz(tC, { idCliente: uid1 }));
    expect(a.status).toBe(201);
    const idA = (await a.json()).id;
    const b = await post("/precios", ana, maiz(tC, { idCliente: uid1 }));
    expect(b.status).toBe(200);
    expect(await b.json()).toMatchObject({ id: idA, existente: true });
    expect((await q("SELECT count(*)::int AS n FROM capturas_precio WHERE tortilleria_id = $1", [tC]))[0].n).toBe(1);
  });

  it("capturadoEn de ayer 23:30 (México) enviado hoy queda con la fecha de ayer", async () => {
    const [{ ayer }] = await q("SELECT ((now() AT TIME ZONE 'America/Mexico_City')::date - 1)::text AS ayer");
    const r = await post("/precios", ana, { tortilleriaId: tC, producto: "masa", precioKg: 15, idCliente: uid2, capturadoEn: `${ayer}T23:30:00-06:00` });
    expect(r.status).toBe(201);
    const [c] = await q("SELECT fecha::text AS fecha, capturado_en FROM capturas_precio WHERE id_cliente = $1", [uid2]);
    expect(c.fecha).toBe(ayer);
    expect(c.capturado_en).not.toBeNull();
  });

  it("el precio de ayer (sin conexión) y el de hoy del mismo producto entran los dos; dos de ayer no", async () => {
    const [{ ayer }] = await q("SELECT ((now() AT TIME ZONE 'America/Mexico_City')::date - 1)::text AS ayer");
    expect((await post("/precios", ana, { tortilleriaId: tC, producto: "masa", precioKg: 16 })).status).toBe(201); // hoy
    const otra = await post("/precios", ana, { tortilleriaId: tC, producto: "masa", precioKg: 17, capturadoEn: `${ayer}T10:00:00-06:00` });
    expect(otra.status).toBe(409); // ayer ya estaba capturado
  });

  it("rechaza una captura de hace 8 días o de 20 minutos en el futuro", async () => {
    const hace8 = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const futuro = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    expect((await post("/precios", beto, maiz(tC, { capturadoEn: hace8 }))).status).toBe(400);
    expect((await post("/precios", beto, maiz(tC, { capturadoEn: futuro }))).status).toBe(400);
    expect((await post("/precios", beto, maiz(tC, { capturadoEn: new Date(Date.now() - 3600 * 1000).toISOString() }))).status).toBe(201);
  });
});

describe("sin conexión: tortillería nueva y foto con idCliente", () => {
  const nueva = {
    nombre: "Tortilleria Sin Senal", estadoClave: "09", municipioClave: "09015", localidad: "Ciudad de Mexico", tipoVial: "CALLE",
    calle: "Norte", numeroExt: "SN", colonia: "Centro", codigoPostal: "09700", personalOcupado: "0 a 5 personas", lat: 19.6, lng: -99.3,
  };
  const idT = "33333333-3333-4333-8333-333333333333";
  const idF = "44444444-4444-4444-8444-444444444444";
  let id: string;

  it("el mismo idCliente no crea otra tortillería", async () => {
    const a = await post("/tortillerias", ana, { ...nueva, idCliente: idT });
    expect(a.status).toBe(201);
    id = (await a.json()).id;
    const b = await post("/tortillerias", ana, { ...nueva, idCliente: idT });
    expect(b.status).toBe(200);
    expect(await b.json()).toMatchObject({ id, existente: true });
    expect((await q("SELECT count(*)::int AS n FROM tortillerias WHERE id_cliente = $1", [idT]))[0].n).toBe(1);
  });

  it("confirmoNoDuplicado deja pasar un duplicado a 50 m y queda en auditoría", async () => {
    const sin = await post("/tortillerias", beto, nueva);
    expect(sin.status).toBe(409);
    const con = await post("/tortillerias", beto, { ...nueva, confirmoNoDuplicado: true });
    expect(con.status).toBe(201);
    expect(auditar).toHaveBeenCalledWith(beto, "crear_tortilleria_confirmada", "tortillerias", (await con.json()).id);
  });

  it("la misma foto (idCliente) enviada dos veces deja una sola", async () => {
    const jpg = await sharp({ create: { width: 900, height: 700, channels: 3, background: "#cc3333" } }).jpeg().toBuffer();
    const enviar = () => {
      const fd = new FormData();
      fd.append("file", new Blob([jpg], { type: "image/jpeg" }), "f.jpg");
      return fetch(`${base}/tortillerias/${id}/fotos`, { method: "POST", headers: { authorization: auth(ana).authorization, "x-id-cliente": idF }, body: fd });
    };
    const a = await enviar();
    expect(a.status).toBe(201);
    const idA = (await a.json()).id;
    const b = await enviar();
    expect(b.status).toBe(200);
    expect(await b.json()).toMatchObject({ id: idA, existente: true });
    expect((await q("SELECT count(*)::int AS n FROM fotos WHERE id_cliente = $1", [idF]))[0].n).toBe(1);
  });
});

describe("catálogo por estado para el teléfono", () => {
  it("solo trae ese estado, sin rechazadas ni sin ubicación, y con tiene_fiscal correcto", async () => {
    const r = await (await get("/catalogo/estado/09", ana)).json();
    expect(r.columnas).toEqual(["id", "nombre", "domicilio", "lat", "lng", "estatus", "municipio_clave", "razon_social", "tiene_fiscal"]);
    const nombres = r.filas.map((f: any[]) => f[1]);
    expect(nombres).toContain("LA GUERA");
    expect(nombres).not.toContain("RECHAZADA");
    expect(nombres).not.toContain("SIN GEOM");
    const guera = r.filas.find((f: any[]) => f[1] === "LA GUERA");
    expect(guera.slice(3, 5)).toEqual([19.43, -99.13]);
    expect(guera[7]).toBe("JUAN PEREZ SA DE CV");
    expect((await (await get("/catalogo/estado/99", ana)).json()).filas).toEqual([]);
  });

  it("pide sesión y valida la clave", async () => {
    expect((await fetch(`${base}/catalogo/estado/09`)).status).toBe(401);
    expect((await get("/catalogo/estado/abc", ana)).status).toBe(400);
  });

  it("la versión cambia al agregar datos fiscales o una tortillería, y sin cambios no vuelve a mandar todo", async () => {
    const v0 = (await (await get("/catalogo/estado/09", ana)).json()).version;
    expect(await (await get(`/catalogo/estado/09?version=${v0}`, ana)).json()).toEqual({ sinCambios: true, version: v0 });

    await new Promise((x) => setTimeout(x, 15));
    const t = (await q("INSERT INTO tortillerias(nombre, estado_clave, municipio_clave, geom, origen, estatus) VALUES ('SIN FISCAL','09','09015', point(-99.3, 19.3),'denue','validada') RETURNING id"))[0].id;
    const f = await post(`/tortillerias/${t}/fiscal`, ana, { tipoPersona: "moral", rfc: "ABC100101AB1", razonSocial: "El Maiz SA", aceptoAviso: true });
    expect([200, 201]).toContain(f.status);
    const c1 = await (await get(`/catalogo/estado/09?version=${v0}`, ana)).json();
    expect(c1.version).not.toBe(v0);
    expect(c1.filas.find((x: any[]) => x[0] === t)[8]).toBe(1);

    await new Promise((x) => setTimeout(x, 15));
    await q("INSERT INTO tortillerias(nombre, estado_clave, geom, origen, estatus) VALUES ('OTRA MAS','09', point(-99.2, 19.4),'nueva','pendiente')");
    const c2 = await (await get(`/catalogo/estado/09?version=${c1.version}`, ana)).json();
    expect(c2.version).not.toBe(c1.version);
  });
});

describe("recuperar contraseña (restablece la administración, sin correo)", () => {
  let olvido: string;
  const login = (usuario: string, password: string) =>
    fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ usuario, password }) });

  beforeAll(async () => {
    olvido = (await q("INSERT INTO usuarios(usuario, correo, rol, password_hash) VALUES ('olvido@correo.com','olvido@correo.com','capturista',$1) RETURNING id", [await hash("clave-vieja-1")]))[0].id;
  });

  it("solo la administración puede restablecer", async () => {
    const url = `/admin/usuarios/${olvido}/restablecer-password`;
    expect((await post(url, ana, {})).status).toBe(403);
    expect((await post(url, sup, {}, "supervisor")).status).toBe(403);
    expect((await fetch(base + url, { method: "POST" })).status).toBe(401);
    expect((await post(`/admin/usuarios/${adm}/restablecer-password`, adm, {}, "admin")).status).toBe(400); // la propia: usa su perfil
    expect((await post("/admin/usuarios/no-es-id/restablecer-password", adm, {}, "admin")).status).toBe(400);
    expect((await post("/admin/usuarios/00000000-0000-4000-8000-0000000000ff/restablecer-password", adm, {}, "admin")).status).toBe(404);
  });

  it("flujo completo: temporal → entrar → cambiarla obligatoriamente → entrar con la nueva", async () => {
    expect((await login("olvido@correo.com", "clave-vieja-1")).status).toBe(200);

    const r = await post(`/admin/usuarios/${olvido}/restablecer-password`, adm, {}, "admin");
    expect(r.status).toBe(200);
    const { password: temporal } = await r.json();
    expect(temporal).toMatch(/^[A-HJ-NP-Za-km-z2-9]{10}$/); // 10 caracteres sin los que se confunden (0, O, 1, l, I)

    expect((await login("olvido@correo.com", "clave-vieja-1")).status).toBe(401); // la vieja ya no sirve
    const entrada = await login("olvido@correo.com", temporal);
    expect(entrada.status).toBe(200);
    const sesion = await entrada.json();
    expect(sesion.usuario.debeCambiarPassword).toBe(true);

    const cambiar = (nueva: string, actual = temporal) =>
      fetch(`${base}/perfil/password`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${sesion.token}` }, body: JSON.stringify({ actual, nueva, confirmar: nueva }) });
    expect((await cambiar(temporal)).status).toBe(400); // debe ser distinta
    expect((await cambiar("otra-clave-9")).status).toBe(200);

    expect((await login("olvido@correo.com", temporal)).status).toBe(401);
    const ya = await (await login("olvido@correo.com", "otra-clave-9")).json();
    expect(ya.usuario.debeCambiarPassword).toBe(false);
  });

  it("la lista de usuarios marca los restablecimientos pendientes", async () => {
    const otro = (await q("INSERT INTO usuarios(usuario, correo, rol, password_hash) VALUES ('pendiente@correo.com','pendiente@correo.com','capturista',$1) RETURNING id", [await hash("x-clave-1")]))[0].id;
    await post(`/admin/usuarios/${otro}/restablecer-password`, adm, {}, "admin");
    const resp = await get("/admin/usuarios", adm, "admin");
    const lista = await resp.json();
    if (!Array.isArray(lista)) throw new Error(`/admin/usuarios ${resp.status}: ${JSON.stringify(lista)}`);
    expect(lista.find((u: any) => u.id === otro).debe_cambiar_password).toBe(true);
    expect(lista.find((u: any) => u.id === olvido).debe_cambiar_password).toBe(false);
  });
});
