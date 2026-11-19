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
const migracion9 = readFileSync(path.join(aqui, "../../../db/migrations/009_sin_datos_fiscales.sql"), "utf8");
const migracion10 = readFileSync(path.join(aqui, "../../../db/migrations/010_aprobacion_automatica.sql"), "utf8");
const migracion11 = readFileSync(path.join(aqui, "../../../db/migrations/011_personal_y_permisos.sql"), "utf8");

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
CREATE TABLE alertas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tipo text NOT NULL, captura_id uuid REFERENCES capturas_precio(id), estatus text NOT NULL DEFAULT 'abierta');
CREATE TABLE auditoria (id bigserial PRIMARY KEY, usuario_id uuid, accion text NOT NULL, entidad text, entidad_id text, fecha timestamptz NOT NULL DEFAULT now());
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
  await h.db.exec(migracion9);
  await h.db.exec(migracion10);
  await h.db.exec(migracion11);
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
    expect(await (await get(`/tortillerias/${tA}/fiscal/existe`, ana)).json()).toEqual({ tiene: false, ultimaNegativa: null });
    expect(await (await fetch(`${base}/tortillerias/${tA}/fiscal/existe`)).json()).toEqual({ tiene: false, ultimaNegativa: null });
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
    expect(await (await get(`/tortillerias/${tA}/fiscal/existe`, beto)).json()).toEqual({ tiene: true, ultimaNegativa: null });
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
    expect(await (await get(`/tortillerias/${t}/fiscal/existe`, ana)).json()).toEqual({ tiene: true, ultimaNegativa: null });
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
    calle: "Norte", numeroExt: "SN", colonia: "Centro", codigoPostal: "09700", telefono: "5512345678", personalOcupado: "0 a 5 personas", lat: 19.6, lng: -99.3,
  };
  const idT = "33333333-3333-4333-8333-333333333333";
  const idF = "44444444-4444-4444-8444-444444444444";
  let id: string;

  it("el teléfono de la tortillería nueva es obligatorio (la API lo exige igual que la app)", async () => {
    const { telefono: _t, ...sinTelefono } = nueva as any;
    const r = await post("/tortillerias", ana, { ...sinTelefono, nombre: "SIN TELEFONO", idCliente: "00000000-0000-4000-8000-00000000aaaa" });
    expect(r.status).toBe(400);
    expect(JSON.stringify((await r.json()).detalle)).toContain("telefono");
  });

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
    expect(r.columnas).toEqual(["id", "nombre", "domicilio", "lat", "lng", "estatus", "municipio_clave", "razon_social", "tiene_fiscal", "ultima_negativa"]);
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

/* Al final: estas pruebas agregan tortillerías al estado 09 y no deben alterar las anteriores */
describe("no se obtuvieron los datos fiscales (C14)", () => {
  const nueva = async (nombre: string) =>
    (await q("INSERT INTO tortillerias(nombre, estado_clave, municipio_clave, geom, origen, estatus) VALUES ($1,'09','09015', point(-99.2, 19.5),'denue','validada') RETURNING id", [nombre]))[0].id as string;
  const neg = (id: string, usuario: string, body: unknown) => post(`/tortillerias/${id}/fiscal/negativa`, usuario, body);

  it("un motivo válido se guarda (201); sin motivo o con motivo desconocido, 400", async () => {
    const t = await nueva("NEG 1");
    const r = await neg(t, ana, { motivo: "inseguridad" });
    expect(r.status).toBe(201);
    const filas = await q("SELECT motivo, capturista_id FROM fiscal_negativas WHERE tortilleria_id = $1", [t]);
    expect(filas).toEqual([{ motivo: "inseguridad", capturista_id: ana }]);
    expect((await neg(t, ana, {})).status).toBe(400);
    expect((await neg(t, ana, { motivo: "porque_si" })).status).toBe(400);
    expect((await fetch(`${base}/tortillerias/${t}/fiscal/negativa`, { method: "POST", headers: json, body: JSON.stringify({ motivo: "se_nego" }) })).status).toBe(401);
  });

  it("'otro' pide el texto (5 a 200 caracteres)", async () => {
    const t = await nueva("NEG 2");
    expect((await neg(t, ana, { motivo: "otro" })).status).toBe(400);
    expect((await neg(t, ana, { motivo: "otro", motivoOtro: "abc" })).status).toBe(400);
    expect((await neg(t, ana, { motivo: "otro", motivoOtro: "x".repeat(201) })).status).toBe(400);
    expect((await neg(t, ana, { motivo: "otro", motivoOtro: "Está de vacaciones" })).status).toBe(201);
    // el texto solo se guarda con "otro"
    expect((await neg(t, ana, { motivo: "se_nego", motivoOtro: "no debe guardarse" })).status).toBe(201);
    const filas = await q("SELECT motivo, motivo_otro FROM fiscal_negativas WHERE tortilleria_id = $1 ORDER BY creado_en", [t]);
    expect(filas.map((f) => f.motivo_otro)).toEqual(["Está de vacaciones", null]);
  });

  it("el mismo idCliente dos veces deja una sola fila", async () => {
    const t = await nueva("NEG 3");
    const idCliente = crypto.randomUUID();
    expect((await neg(t, ana, { motivo: "se_nego", idCliente })).status).toBe(201);
    const otra = await neg(t, ana, { motivo: "se_nego", idCliente });
    expect(otra.status).toBe(200);
    expect((await otra.json()).existente).toBe(true);
    expect((await q("SELECT count(*)::int AS n FROM fiscal_negativas WHERE tortilleria_id = $1", [t]))[0].n).toBe(1);
  });

  it("cada intento distinto queda en el historial", async () => {
    const t = await nueva("NEG 4");
    await neg(t, ana, { motivo: "cerrado" });
    await neg(t, beto, { motivo: "inseguridad" });
    expect((await q("SELECT count(*)::int AS n FROM fiscal_negativas WHERE tortilleria_id = $1", [t]))[0].n).toBe(2);
  });

  it("tortillería inexistente → 404; ya con datos fiscales → 200 yaTenia y no se guarda", async () => {
    expect((await neg(crypto.randomUUID(), ana, { motivo: "se_nego" })).status).toBe(404);
    const t = await nueva("NEG 5");
    expect((await post(`/tortillerias/${t}/fiscal`, beto, { tipoPersona: "moral", rfc: "tgu100101ab1", razonSocial: "Empresa", aceptoAviso: true })).status).toBe(201);
    const r = await neg(t, ana, { motivo: "se_nego" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ yaTenia: true });
    expect((await q("SELECT count(*)::int AS n FROM fiscal_negativas WHERE tortilleria_id = $1", [t]))[0].n).toBe(0);
  });

  it("la hora del teléfono sigue las reglas de /precios (7 días atrás, 10 minutos adelante)", async () => {
    const t = await nueva("NEG 6");
    const hace = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect((await neg(t, ana, { motivo: "cerrado", capturadoEn: hace(8 * 24 * 3600 * 1000) })).status).toBe(400);
    expect((await neg(t, ana, { motivo: "cerrado", capturadoEn: hace(-30 * 60 * 1000) })).status).toBe(400);
    expect((await neg(t, ana, { motivo: "cerrado", capturadoEn: hace(2 * 3600 * 1000) })).status).toBe(201);
  });

  it("fiscal/existe da el último intento (solo motivo y fecha, sin el texto de 'otro') y sigue en tiene:false", async () => {
    const t = await nueva("NEG 7");
    await neg(t, ana, { motivo: "otro", motivoOtro: "Texto privado del censador" });
    await neg(t, beto, { motivo: "inseguridad" });
    const r = await (await fetch(`${base}/tortillerias/${t}/fiscal/existe`)).json();
    expect(r.tiene).toBe(false);
    expect(r.ultimaNegativa.motivo).toBe("inseguridad");
    expect(r.ultimaNegativa.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(r.ultimaNegativa).sort()).toEqual(["fecha", "motivo"]);
    expect(JSON.stringify(r)).not.toContain("privado");
  });

  it("tras una negativa se puede registrar el precio y otro censador puede capturar los datos fiscales", async () => {
    const t = await nueva("NEG 8");
    expect((await neg(t, ana, { motivo: "no_conoce" })).status).toBe(201);
    expect((await post("/precios", ana, { tortilleriaId: t, producto: "maiz", precioKg: 22 })).status).toBe(201);
    expect((await post(`/tortillerias/${t}/fiscal`, beto, { tipoPersona: "fisica", rfc: "pepa800101ab1", razonSocial: "José Pérez", aceptoAviso: true })).status).toBe(201);
    const r = await (await fetch(`${base}/tortillerias/${t}/fiscal/existe`)).json();
    expect(r.tiene).toBe(true);
  });

  it("el catálogo del estado trae la última negativa y su versión cambia", async () => {
    const t = await nueva("NEG 9");
    const antes = await (await get("/catalogo/estado/09", ana)).json();
    await neg(t, ana, { motivo: "desconfianza" });
    const des = await (await get("/catalogo/estado/09", ana)).json();
    expect(des.version).not.toBe(antes.version);
    const i = des.columnas.indexOf("ultima_negativa");
    expect(des.filas.find((f: any[]) => f[0] === t)[i]).toBe("desconfianza");
  });

  it("el administrador ve el historial con el texto y el censador; las estadísticas cuentan por motivo", async () => {
    const t = await nueva("NEG 10");
    await neg(t, ana, { motivo: "otro", motivoOtro: "Texto para el administrador" });
    const h1 = await (await get(`/admin/tortillerias/${t}/negativas`, sup, "supervisor")).json();
    expect(h1).toHaveLength(1);
    expect(h1[0]).toMatchObject({ motivo: "otro", motivo_otro: "Texto para el administrador", censador: "ana@correo.com" });
    expect((await get(`/admin/tortillerias/${t}/negativas`, ana)).status).toBe(403);

    const e = await (await get("/admin/sin-fiscal", adm, "admin")).json();
    expect(e.sin_fiscal).toBeGreaterThan(0);
    expect(e.total).toBeGreaterThanOrEqual(e.sin_fiscal);
    expect(e.por_motivo.otro).toBeGreaterThan(0);
    expect(e.zonas.find((z: any) => z.clave === "09").sin_fiscal).toBe(e.sin_fiscal);
    const m = await (await get("/admin/sin-fiscal?estado=09", adm, "admin")).json();
    expect(m.zonas.find((z: any) => z.clave === "09015")).toBeTruthy();
    expect((await get("/admin/sin-fiscal", ana)).status).toBe(403);
  });
});

describe("revisión de precios: detalle de la captura", () => {
  it("el administrador ve dónde y cuándo se capturó (GPS, precisión y hora del teléfono)", async () => {
    const t = (await q("INSERT INTO tortillerias(nombre, estado_clave, municipio_clave, geom, origen, estatus) VALUES ('DET 1','09','09015', point(-99.3, 19.6),'denue','validada') RETURNING id"))[0].id as string;
    const hora = new Date(Date.now() - 3600_000).toISOString();
    expect((await post("/precios", ana, { tortilleriaId: t, producto: "maiz", precioKg: 23, lat: 19.601, lng: -99.301, precisionGps: 12, capturadoEn: hora })).status).toBe(201);
    expect((await post("/precios", beto, { tortilleriaId: t, producto: "masa", precioKg: 18 })).status).toBe(201); // sin GPS
    const lista = await (await get(`/admin/capturas?tortilleria=${t}`, sup, "supervisor")).json();
    const conGps = lista.find((c: any) => c.producto === "maiz");
    expect(conGps).toMatchObject({ captura_lat: 19.601, captura_lng: -99.301, precision_gps: 12 });
    expect(new Date(conGps.capturado_en).toISOString()).toBe(hora);
    const sinGps = lista.find((c: any) => c.producto === "masa");
    expect(sinGps.captura_lat).toBeNull();
    expect(sinGps.capturado_en).toBeTruthy(); // sin hora del teléfono, la de llegada al servidor
    expect((await get(`/admin/capturas?tortilleria=${t}`, ana)).status).toBe(403);
  });
});

describe("listas de revisión sin límite y con paginación", () => {
  let t: string;
  beforeAll(async () => {
    await q("INSERT INTO tortillerias(nombre, estado_clave, municipio_clave, geom, origen, estatus, creado_por) SELECT 'PAG ' || i, '09','09015', point(-99.4, 19.7), 'nueva','pendiente', $1 FROM generate_series(1, 105) i", [ana]);
    t = (await q("SELECT id FROM tortillerias WHERE nombre = 'PAG 1'"))[0].id;
    await q("INSERT INTO capturas_precio(tortilleria_id, producto, precio_kg, capturista_id, fecha, estatus) SELECT $1, 'maiz', 20, NULL, current_date - i, 'pendiente' FROM generate_series(1, 105) i", [t]);
  });

  it("sin ?pagina devuelve TODAS (más de 100), no un máximo", async () => {
    const [{ n: nt }] = await q("SELECT count(*)::int AS n FROM tortillerias t WHERE t.estatus = 'pendiente' AND (t.origen <> 'denue' OR EXISTS (SELECT 1 FROM capturas_precio c WHERE c.tortilleria_id = t.id))");
    const tort = await (await get("/admin/tortillerias?estatus=pendiente", sup, "supervisor")).json();
    expect(tort.length).toBe(nt);
    expect(tort.length).toBeGreaterThan(100);
    const [{ n: nc }] = await q("SELECT count(*)::int AS n FROM capturas_precio WHERE estatus = 'pendiente'");
    const caps = await (await get("/admin/capturas?estatus=pendiente", sup, "supervisor")).json();
    expect(caps.length).toBe(nc);
    expect(caps.length).toBeGreaterThan(100);
  });

  it("con ?pagina devuelve páginas completas, sin repetir ni perder ninguna", async () => {
    const [{ n }] = await q("SELECT count(*)::int AS n FROM tortillerias t WHERE t.estatus = 'pendiente' AND (t.origen <> 'denue' OR EXISTS (SELECT 1 FROM capturas_precio c WHERE c.tortilleria_id = t.id))");
    const p1 = await (await get("/admin/tortillerias?estatus=pendiente&pagina=1&limite=40", sup, "supervisor")).json();
    expect(p1).toMatchObject({ total: n, pagina: 1, limite: 40, paginas: Math.ceil(n / 40) });
    expect(p1.filas).toHaveLength(40);
    const ids = new Set<string>(p1.filas.map((f: any) => f.id));
    for (let pg = 2; pg <= p1.paginas; pg++) {
      const r = await (await get(`/admin/tortillerias?estatus=pendiente&pagina=${pg}&limite=40`, sup, "supervisor")).json();
      r.filas.forEach((f: any) => ids.add(f.id));
    }
    expect(ids.size).toBe(n);
  });

  it("las capturas también se paginan y una página fuera de rango sale vacía con el total correcto", async () => {
    const [{ n }] = await q("SELECT count(*)::int AS n FROM capturas_precio WHERE estatus = 'pendiente'");
    const r = await (await get("/admin/capturas?estatus=pendiente&pagina=2&limite=50", sup, "supervisor")).json();
    expect(r.total).toBe(n);
    expect(r.filas.length).toBe(Math.min(50, n - 50));
    const fuera = await (await get("/admin/capturas?estatus=pendiente&pagina=999&limite=50", sup, "supervisor")).json();
    expect(fuera.filas).toEqual([]);
    expect(fuera.total).toBe(n);
    expect((await get("/admin/capturas?estatus=pendiente&pagina=1&limite=50", ana)).status).toBe(403);
  });

  it("el historial de UNA tortillería sigue acotado (100) y el filtro por estatus se respeta", async () => {
    const h = await (await get(`/admin/capturas?tortilleria=${t}`, sup, "supervisor")).json();
    expect(h).toHaveLength(100);
    const rech = await (await get("/admin/tortillerias?estatus=rechazada&pagina=1", sup, "supervisor")).json();
    expect(rech.filas.every((f: any) => f.estatus === "rechazada")).toBe(true);
  });
});

/* ===================== C15: aprobación automática, qué cuenta y cómo se promedia ===================== */
describe("C15: aprobación automática de precios", () => {
  const nueva15 = async (nombre: string, mun = "15001", est = "15", geom = "point(-97, 21)", origen = "denue", estatus = "validada") =>
    (await q(`INSERT INTO tortillerias(nombre, estado_clave, municipio_clave, geom, origen, estatus) VALUES ($1,$2,$3,${geom},$4,$5) RETURNING id`, [nombre, est, mun, origen, estatus]))[0].id as string;
  const precio = (usuario: string, t: string, p: number, producto = "maiz") => post("/precios", usuario, { tortilleriaId: t, producto, precioKg: p });
  const patch = (url: string, usuario: string, body: unknown, rol = "supervisor") => fetch(base + url, { method: "PATCH", headers: auth(usuario, rol), body: JSON.stringify(body) });
  let capAtipica: string;

  beforeAll(async () => {
    await q("INSERT INTO estados VALUES ('15','ESTADO QUINCE'), ('16','ESTADO DIECISEIS')");
    await q("INSERT INTO municipios VALUES ('15001','15','MUN QUINCE'), ('16001','16','MUN DIECISEIS')");
  });

  it("un precio normal entra validado y con aprobación automática (sin referencia aún)", async () => {
    const t = await nueva15("AUTO 1");
    const r = await precio(ana, t, 25);
    expect(r.status).toBe(201);
    expect((await r.json()).alerta).toBe(false);
    const [c] = await q("SELECT estatus, aprobacion, alerta, mediana_ref, n_ref FROM capturas_precio WHERE tortilleria_id = $1", [t]);
    expect(c).toMatchObject({ estatus: "validada", aprobacion: "automatica", alerta: false, mediana_ref: null, n_ref: null });
  });

  it("un precio atípico (más de 30 % de la mediana con al menos 3 precios) entra pendiente y guarda su referencia", async () => {
    for (const n of ["AUTO 2", "AUTO 3"]) expect((await precio(ana, await nueva15(n), 25)).status).toBe(201); // con AUTO 1: 3 precios de $25
    const t = await nueva15("ATIPICO 1");
    const r = await precio(beto, t, 40); // +60 %
    expect(r.status).toBe(201);
    expect((await r.json()).alerta).toBe(true);
    const [c] = await q("SELECT id, estatus, aprobacion, alerta, mediana_ref::float8 AS mediana_ref, n_ref FROM capturas_precio WHERE tortilleria_id = $1", [t]);
    expect(c).toMatchObject({ estatus: "pendiente", aprobacion: null, alerta: true, mediana_ref: 25, n_ref: 3 });
    capAtipica = c.id;
    expect((await q("SELECT count(*)::int AS n FROM alertas WHERE captura_id = $1", [c.id]))[0].n).toBe(1);
  });

  it("la mediana solo usa precios que cuentan: ignora atípicos pendientes y tortillerías rechazadas", async () => {
    // un precio desmedido en una tortillería rechazada y el atípico pendiente NO mueven la referencia
    const rech = await nueva15("RECHAZADA 1", "15001", "15", "point(-97, 21)", "nueva", "rechazada");
    await q("INSERT INTO capturas_precio(tortilleria_id, producto, precio_kg, fecha, estatus, aprobacion) VALUES ($1,'maiz',55,current_date - 1,'validada','automatica')", [rech]);
    const t = await nueva15("MEDIANA 1");
    expect((await precio(ana, t, 26)).status).toBe(201); // dentro de ±30 % de $25
    const [c] = await q("SELECT mediana_ref::float8 AS mediana_ref, n_ref, estatus FROM capturas_precio WHERE tortilleria_id = $1", [t]);
    expect(c).toMatchObject({ mediana_ref: 25, n_ref: 3, estatus: "validada" });
  });

  it("la migración 010 aprueba los pendientes normales y deja intactos los atípicos (una sola fila de auditoría)", async () => {
    const db3 = new PGlite();
    await db3.exec(PRE);
    for (const m of [migracion, migracion7, migracion8, migracion9]) await db3.exec(m);
    const t = (await db3.query<any>("INSERT INTO tortillerias(nombre, origen) VALUES ('M','denue') RETURNING id")).rows[0].id;
    for (const [n, alerta] of [[1, false], [2, false], [3, true]] as const)
      await db3.query("INSERT INTO capturas_precio(tortilleria_id, producto, precio_kg, fecha, estatus, alerta) VALUES ($1,'maiz',20,current_date - $2::int,'pendiente',$3)", [t, n, alerta]);
    await db3.query("INSERT INTO alertas(tipo, captura_id) SELECT 'precio_atipico', id FROM capturas_precio WHERE alerta");
    await db3.exec(migracion10);
    const filas = (await db3.query<any>("SELECT alerta, estatus, aprobacion FROM capturas_precio ORDER BY alerta")).rows;
    expect(filas).toEqual([
      { alerta: false, estatus: "validada", aprobacion: "automatica" },
      { alerta: false, estatus: "validada", aprobacion: "automatica" },
      { alerta: true, estatus: "pendiente", aprobacion: null },
    ]);
    const aud = (await db3.query<any>("SELECT accion, entidad_id FROM auditoria")).rows;
    expect(aud).toEqual([{ accion: "aprobacion_masiva_migracion_010", entidad_id: "2" }]);
    expect((await db3.query<any>("SELECT estatus FROM alertas")).rows).toEqual([{ estatus: "abierta" }]);
    await db3.exec(migracion10); // volver a correrla no rompe nada
    await db3.close();
  });

  it("aprobar o rechazar VARIOS a la vez: queda quién y cuándo, y la auditoría de cada uno", async () => {
    const t2 = await nueva15("ATIPICO 2");
    expect((await precio(ana, t2, 60)).status).toBe(201); // otro atípico pendiente
    const [{ id: cap2 }] = await q("SELECT id FROM capturas_precio WHERE tortilleria_id = $1", [t2]);
    vi.mocked(auditar).mockClear();
    const r = await patch("/admin/capturas", sup, { ids: [capAtipica, cap2], estatus: "rechazada" });
    expect(r.status).toBe(200);
    expect((await r.json()).actualizadas).toBe(2);
    const filas = await q("SELECT estatus, aprobacion, revisado_por, revisado_en FROM capturas_precio WHERE id IN ($1,$2)", [capAtipica, cap2]);
    expect(filas.every((f) => f.estatus === "rechazada" && f.aprobacion === "manual" && f.revisado_por === sup && f.revisado_en)).toBe(true);
    expect(vi.mocked(auditar).mock.calls.filter((c) => c[1] === "captura_rechazada").map((c) => c[3]).sort()).toEqual([capAtipica, cap2].sort());
    expect((await q("SELECT estatus FROM alertas WHERE captura_id = $1", [capAtipica]))[0].estatus).toBe("resuelta");
    expect((await patch("/admin/capturas", sup, { ids: [], estatus: "validada" })).status).toBe(400);
    expect((await patch("/admin/capturas", sup, { ids: Array.from({ length: 201 }, () => crypto.randomUUID()), estatus: "validada" })).status).toBe(400);
    expect((await patch("/admin/capturas", ana, { ids: [cap2], estatus: "validada" }, "capturista")).status).toBe(403);
  });

  it("el individual también deja quién lo revisó", async () => {
    const t = await nueva15("ATIPICO 3");
    expect((await precio(beto, t, 5.5)).status).toBe(201);
    const [{ id }] = await q("SELECT id FROM capturas_precio WHERE tortilleria_id = $1", [t]);
    expect((await patch(`/admin/capturas/${id}`, sup, { estatus: "validada" })).status).toBe(200);
    expect((await q("SELECT estatus, aprobacion, revisado_por FROM capturas_precio WHERE id = $1", [id]))[0]).toMatchObject({ estatus: "validada", aprobacion: "manual", revisado_por: sup });
  });

  it("la lista de precios por revisar trae la mediana y con cuántos precios se calculó", async () => {
    const t = await nueva15("ATIPICO 4");
    expect((await precio(ana, t, 59)).status).toBe(201);
    const lista = await (await get("/admin/capturas?estatus=pendiente", sup, "supervisor")).json();
    const c = lista.find((x: any) => x.tortilleria_id === t);
    expect(c.alerta).toBe(true);
    expect(c.mediana_ref).toBeGreaterThan(0); // la mediana del municipio al capturar
    expect(c.n_ref).toBeGreaterThanOrEqual(3);
  });
});

describe("C15: qué precio cuenta y cómo se promedia", () => {
  const nuevaT = async (nombre: string, geom = "point(-98, 20)", origen = "denue", estatus = "validada") =>
    (await q(`INSERT INTO tortillerias(nombre, estado_clave, municipio_clave, geom, origen, estatus) VALUES ($1,'16','16001',${geom},$2,$3) RETURNING id`, [nombre, origen, estatus]))[0].id as string;
  const cap = (t: string, p: number, dia: number, estatus = "validada", alerta = false) =>
    q("INSERT INTO capturas_precio(tortilleria_id, producto, precio_kg, fecha, estatus, aprobacion, alerta) VALUES ($1,'maiz',$2,current_date - $3::int,$4,$5,$6)", [t, p, dia, estatus, estatus === "validada" ? "automatica" : null, alerta]);
  const estad = async () => (await (await get("/admin/estadisticas?estado=16&dias=30", sup, "supervisor")).json()).find((z: any) => z.clave === "16001");
  const celda = async () => (await (await get("/admin/mapa/celdas?bbox=-98.5,19.5,-97.5,20.5&zoom=5", sup, "supervisor")).json()).celdas[0];
  const porEstado16 = async () => (await (await get("/admin/resumen", sup, "supervisor")).json()).porEstado.find((e: any) => e.estado === "ESTADO DIECISEIS");
  let A: string, B: string;

  beforeAll(async () => {
    A = await nuevaT("PROM A");
    B = await nuevaT("PROM B");
    for (let i = 1; i <= 10; i++) await cap(A, 22, i); // A: $22, capturada 10 veces
    await cap(B, 28, 1); //                              B: $28, capturada 1 vez
  });

  it("el promedio es por tortillería (una = un valor): A $22 x10 + B $28 x1 → $25.00 en estadísticas, mapa y resumen", async () => {
    const z = await estad();
    expect(z.maiz).toMatchObject({ promedio: 25, minimo: 22, maximo: 28, tortillerias: 2 });
    expect(z.maiz.capturas).toBe(11); // el número de capturas se muestra aparte, no pesa en el promedio
    const c = await celda();
    expect(c.maiz_n).toBe(2);
    expect(c.maiz_suma / c.maiz_n).toBe(25);
    expect(Number((await porEstado16()).promedio)).toBe(25);
  });

  it("la tendencia diaria usa el último precio de cada tortillería ese día y promedia entre tortillerías", async () => {
    await cap(A, 30, 1); // el mismo día que B ($28): A ese día tuvo $22 y luego $30 → cuenta el último ($30)
    const t = await (await get("/admin/tendencia?estado=16&dias=30", sup, "supervisor")).json();
    const [{ f }] = await q("SELECT to_char(current_date - 1, 'YYYY-MM-DD') AS f");
    const dia = t.find((d: any) => d.fecha === f);
    expect(dia.maiz).toBe(29); // (30 + 28) / 2
    expect(dia.n).toBe(2);
  });

  it("un atípico pendiente no aparece en ningún número; al aprobarlo, sí", async () => {
    const T = await nuevaT("PROM ATIPICO");
    await cap(T, 50, 2, "pendiente", true);
    const [{ id }] = await q("SELECT id FROM capturas_precio WHERE tortilleria_id = $1", [T]);
    const antes = { z: await estad(), c: await celda(), r: await porEstado16() };
    expect(antes.z.maiz.tortillerias).toBe(2);
    expect(antes.c.maiz_n).toBe(2);
    expect(antes.r.tortillerias).toBe(2);
    const punto = (await (await get("/admin/mapa?bbox=-98.1,19.9,-97.9,20.1&dias=30", sup, "supervisor")).json()).puntos.find((p: any) => p.id === T);
    expect(punto.ultimo_maiz).toBeNull(); // el mapa tampoco lo muestra como precio
    expect(punto.alerta).toBe(true); // pero sí avisa que hay un atípico por revisar
    const tend = await (await get("/admin/tendencia?estado=16&dias=30", sup, "supervisor")).json();
    expect(tend.every((d: any) => d.maiz !== 50)).toBe(true);
    expect((await fetch(`${base}/admin/capturas/${id}`, { method: "PATCH", headers: auth(sup, "supervisor"), body: JSON.stringify({ estatus: "validada" }) })).status).toBe(200);
    const des = { z: await estad(), c: await celda(), r: await porEstado16() };
    expect(des.z.maiz.tortillerias).toBe(3);
    expect(des.c.maiz_n).toBe(3);
    expect(des.z.maiz.maximo).toBe(50);
    await q("UPDATE capturas_precio SET estatus = 'rechazada' WHERE id = $1", [id]); // se deja fuera para las demás pruebas
  });

  it("los precios de una tortillería nueva pendiente no cuentan hasta que se valida; al rechazarla, desaparecen", async () => {
    const N = await nuevaT("PROM NUEVA", "point(-98, 20)", "nueva", "pendiente");
    await cap(N, 58, 1);
    expect((await estad()).maiz.tortillerias).toBe(2);
    expect((await celda()).maiz_n).toBe(2);
    await q("UPDATE tortillerias SET estatus = 'validada' WHERE id = $1", [N]);
    expect((await estad()).maiz.tortillerias).toBe(3);
    expect((await estad()).maiz.maximo).toBe(58);
    // al rechazar una tortillería, sus precios dejan de contar en todas las vistas
    expect((await fetch(`${base}/tortillerias/${N}/estatus`, { method: "PATCH", headers: auth(sup, "supervisor"), body: JSON.stringify({ estatus: "rechazada" }) })).status).toBe(200);
    expect((await estad()).maiz.tortillerias).toBe(2);
    expect((await estad()).maiz.maximo).toBe(30);
    expect((await celda()).maiz_n).toBe(2);
    expect((await porEstado16()).tortillerias).toBe(2);
    const tend = await (await get("/admin/tendencia?estado=16&dias=30", sup, "supervisor")).json();
    expect(tend.every((d: any) => d.maiz !== 58)).toBe(true);
  });

  it("DENUE y nuevas van por separado: la lista de nuevas no trae las del DENUE y el resumen las cuenta aparte", async () => {
    const N2 = await nuevaT("SEP NUEVA 1", "point(-98, 20)", "nueva", "validada");
    await nuevaT("SEP NUEVA 2", "point(-98, 20)", "nueva", "pendiente");
    await cap(N2, 24, 1);
    const val = await (await get("/admin/tortillerias?origen=nueva&estatus=validada", sup, "supervisor")).json();
    expect(val.length).toBeGreaterThan(0);
    expect(val.every((t: any) => t.origen === "nueva" && t.estatus === "validada")).toBe(true);
    const pend = await (await get("/admin/tortillerias?origen=nueva&estatus=pendiente&pagina=1&limite=5", sup, "supervisor")).json();
    expect(pend.filas.every((t: any) => t.origen === "nueva")).toBe(true);
    const den = await (await get("/admin/tortillerias?origen=denue&estatus=validada", sup, "supervisor")).json();
    expect(den.length).toBeGreaterThan(0);
    expect(den.every((t: any) => t.origen === "denue")).toBe(true);
    const r = await (await get("/admin/resumen", sup, "supervisor")).json();
    const [{ n: nuevas }] = await q("SELECT count(*)::int AS n FROM tortillerias WHERE origen = 'nueva'");
    const [{ n: visitadas }] = await q("SELECT count(DISTINCT tortilleria_id)::int AS n FROM precios_que_cuentan WHERE origen_tortilleria = 'denue'");
    expect(r.nuevas.total).toBe(nuevas);
    expect(r.nuevas.validadas + r.nuevas.pendientes + r.nuevas.rechazadas).toBe(nuevas);
    expect(r.denue_visitadas).toBe(visitadas);
    expect(r.denue_total).toBeGreaterThan(r.denue_visitadas);
    expect(r.avance_censo).toBeGreaterThan(0);
    const z = (await (await get("/admin/estadisticas?estado=16&dias=30", sup, "supervisor")).json()).find((x: any) => x.clave === "16001");
    expect(z.nuevas).toBe(2); // SEP NUEVA 1 y 2 (PROM NUEVA está rechazada y ya no cuenta como tortillería de la zona)
    expect(z.denue_visitadas).toBe(2);
  });

  it("sin datos fiscales: una tortillería del DENUE nunca visitada no entra en el total", async () => {
    const sin = await nuevaT("NUNCA VISITADA");
    const antes = await (await get("/admin/sin-fiscal", sup, "supervisor")).json();
    const [{ n }] = await q(`WITH v AS (SELECT tortilleria_id AS id FROM capturas_precio WHERE estatus <> 'rechazada' UNION SELECT tortilleria_id FROM fiscal_negativas UNION SELECT id FROM tortillerias WHERE origen = 'nueva')
                              SELECT count(*)::int AS n FROM tortillerias t JOIN v ON v.id = t.id WHERE t.estatus <> 'rechazada'`);
    expect(antes.total).toBe(n);
    expect(antes.total).toBeLessThan((await q("SELECT count(*)::int AS n FROM tortillerias WHERE estatus <> 'rechazada'"))[0].n);
    expect(antes.sin_fiscal).toBeLessThanOrEqual(antes.total);
    // al visitarla (un precio) sí entra
    await cap(sin, 24, 1);
    expect((await (await get("/admin/sin-fiscal", sup, "supervisor")).json()).total).toBe(antes.total + 1);
  });
});

describe("C15: usuarios, exportación y auditoría", () => {
  it("el buscador de usuarios ignora acentos y mayúsculas y pagina con más de 300 cuentas", async () => {
    await q("INSERT INTO usuarios(usuario, rol, correo, nombre, apellidos) SELECT 'mass' || i, 'capturista', 'mass' || i || '@correo.com', 'José', 'Núñez ' || i FROM generate_series(1, 320) i");
    const todos = await (await get("/admin/usuarios?q=jose&pagina=1&limite=50", adm, "admin")).json();
    expect(todos.total).toBeGreaterThanOrEqual(320);
    expect(todos.filas).toHaveLength(50);
    expect(todos.paginas).toBe(Math.ceil(todos.total / 50));
    const mayus = await (await get(`/admin/usuarios?q=${encodeURIComponent("JOSÉ NUÑEZ")}&pagina=1&limite=50`, adm, "admin")).json();
    expect(mayus.total).toBe(todos.total);
    const ultima = await (await get(`/admin/usuarios?q=jose&pagina=${todos.paginas}&limite=50`, adm, "admin")).json();
    expect(ultima.filas.length).toBe(todos.total - 50 * (todos.paginas - 1));
    const sinPagina = await (await get("/admin/usuarios?q=jose", adm, "admin")).json();
    expect(sinPagina.length).toBe(todos.total); // sin ?pagina se devuelven todos (ya no se corta en 300)
    const rol = await (await get("/admin/usuarios?rol=admin&pagina=1", adm, "admin")).json();
    expect(rol.filas.every((u: any) => u.rol === "admin")).toBe(true);
    const inactivos = await (await get("/admin/usuarios?activo=0&pagina=1", adm, "admin")).json();
    expect(inactivos.filas.every((u: any) => u.activo === false)).toBe(true);
    expect((await get("/admin/usuarios?pagina=1", sup, "supervisor")).status).toBe(403);
  });

  it("cada usuario trae su última captura y las de los últimos 7 días", async () => {
    const lista = await (await get("/admin/usuarios?q=ana@correo.com&pagina=1", adm, "admin")).json();
    const u = lista.filas.find((x: any) => x.correo === "ana@correo.com");
    expect(u.capturas).toBeGreaterThan(0);
    expect(u.ultima_captura).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(u.capturas_7d).toBeGreaterThan(0);
  });

  it("la exportación de capturas es CSV con BOM, respeta los filtros, no trae datos personales y queda en la auditoría", async () => {
    const t = (await q("SELECT id FROM tortillerias WHERE nombre = 'PROM A'"))[0].id as string;
    await post(`/tortillerias/${t}/fiscal`, ana, { tipoPersona: "moral", rfc: "tgu100101ab1", razonSocial: "Empresa Secreta SA", celular: "5598765432", aceptoAviso: true });
    vi.mocked(auditar).mockClear();
    const r = await get("/admin/exportar/capturas?estado=16", sup, "supervisor");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/csv; charset=utf-8/);
    expect(r.headers.get("content-disposition")).toMatch(/attachment; filename="capturas-\d{4}-\d{2}-\d{2}\.csv"/);
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM de UTF-8: Excel muestra bien los acentos
    const txt = new TextDecoder("utf-8").decode(bytes);
    const lineas = txt.trim().split("\r\n");
    expect(lineas[0]).toBe(
      "id_captura,fecha,hora_captura,producto,precio_kg,estatus,atipico,mediana_ref,aprobacion,id_tortilleria,id_denue,origen,estatus_tortilleria,nombre_tortilleria,domicilio,estado,municipio,lat,lng,tiene_datos_fiscales,ultimo_motivo_sin_fiscal,censador_correo,gps_lat,gps_lng,precision_gps",
    );
    const [{ n }] = await q("SELECT count(*)::int AS n FROM precios_que_cuentan WHERE estado_clave = '16'"); // por omisión: solo lo que cuenta
    expect(lineas.length - 1).toBe(n);
    expect(txt).toContain("ESTADO DIECISEIS");
    expect(txt).not.toContain("ESTADO QUINCE"); // el filtro de estado se respeta
    expect(txt).not.toMatch(/tgu100101ab1|Empresa Secreta|5598765432|rfc|razon_social|celular/i);
    expect(txt).toContain(",si,"); // PROM A ya tiene datos fiscales: solo se dice sí/no
    expect(vi.mocked(auditar).mock.calls.some((c) => c[1] === "exportar_capturas" && String(c[3]).includes('"estado":"16"'))).toBe(true);
    // con municipio y "todos" (incluye rechazadas) y con fechas
    const todos = await (await get("/admin/exportar/capturas?estado=16&municipio=16001&estatus=todos", sup, "supervisor")).text();
    const [{ n: nt }] = await q("SELECT count(*)::int AS n FROM capturas_precio c JOIN tortillerias t ON t.id = c.tortilleria_id WHERE t.municipio_clave = '16001'");
    expect(todos.trim().split("\r\n").length - 1).toBe(nt);
    const futuro = await (await get("/admin/exportar/capturas?desde=2999-01-01", sup, "supervisor")).text();
    expect(futuro.trim().split("\r\n")).toHaveLength(1); // solo el encabezado
    expect((await get("/admin/exportar/capturas?estado=XX", sup, "supervisor")).status).toBe(400);
    expect((await get("/admin/exportar/capturas", ana)).status).toBe(403);
  });

  it("la bitácora de auditoría es solo del administrador, de solo lectura y con filtros", async () => {
    await q("INSERT INTO auditoria(usuario_id, accion, entidad, entidad_id) VALUES ($1,'ver_datos_fiscales','tortilleria_fiscal','x1'), ($1,'captura_validada','capturas_precio','x2')", [sup]);
    expect((await get("/admin/auditoria", sup, "supervisor")).status).toBe(403);
    const todo = await (await get("/admin/auditoria?pagina=1&limite=10", adm, "admin")).json();
    expect(todo.total).toBeGreaterThanOrEqual(2);
    expect(todo.filas.length).toBeLessThanOrEqual(10);
    const f = await (await get("/admin/auditoria?accion=ver_datos&usuario=SUP", adm, "admin")).json();
    expect(f.filas.every((x: any) => x.accion.includes("ver_datos") && x.usuario === "sup@correo.com")).toBe(true);
    expect(f.total).toBeGreaterThanOrEqual(1);
  });
});

/* ===================== C16: usuarios de la app y personal del administrador, con permisos ===================== */
describe("C16: usuarios de la app y personal del administrador (aparte, con permisos)", () => {
  const patch = (url: string, usuario: string, body: unknown, rol = "admin") => fetch(base + url, { method: "PATCH", headers: auth(usuario, rol), body: JSON.stringify(body) });
  const usuarioSql = async (correo: string, rol: string, permisos: string[] | null = null) =>
    (await q("INSERT INTO usuarios(usuario, correo, rol, nombre, apellidos, permisos) VALUES ($1,$1,$2,'Prueba','Permisos',$3::text[]) RETURNING id", [correo, rol, permisos]))[0].id as string;
  let soloResumen: string, revisor: string, gestor: string, capt: string;

  beforeAll(async () => {
    soloResumen = await usuarioSql("solo.resumen@sader.gob.mx", "supervisor", ["ver_resumen"]);
    revisor = await usuarioSql("revisor@sader.gob.mx", "supervisor", ["ver_revision", "ver_mapa", "revisar_precios"]);
    gestor = await usuarioSql("gestor@sader.gob.mx", "supervisor", ["ver_usuarios_app", "gestionar_usuarios_app"]);
    capt = await usuarioSql("persona.app@correo.com", "capturista");
  });

  it("las dos listas van separadas: ?tipo=app solo trae capturistas y ?tipo=personal solo supervisores y administradores", async () => {
    const app_ = await (await get("/admin/usuarios?tipo=app&pagina=1&limite=200", adm, "admin")).json();
    expect(app_.filas.length).toBeGreaterThan(0);
    expect(app_.filas.every((u: any) => u.rol === "capturista")).toBe(true);
    const personal = await (await get("/admin/usuarios?tipo=personal&pagina=1&limite=200", adm, "admin")).json();
    expect(personal.filas.length).toBeGreaterThan(0);
    expect(personal.filas.every((u: any) => u.rol === "supervisor" || u.rol === "admin")).toBe(true);
    const s = personal.filas.find((u: any) => u.id === soloResumen);
    expect(s.permisos).toEqual(["ver_resumen"]);
    expect(s.permisos_efectivos).toEqual(["ver_resumen"]);
    // un administrador tiene todo; un supervisor sin editar, lo de por omisión (sin gestionar usuarios de la app)
    expect(personal.filas.find((u: any) => u.id === adm).permisos_efectivos).toHaveLength(10);
    const sup0 = personal.filas.find((u: any) => u.id === sup);
    expect(sup0.permisos).toBeNull();
    expect(sup0.permisos_efectivos).not.toContain("gestionar_usuarios_app");
    expect(sup0.permisos_efectivos).toContain("revisar_precios");
  });

  it("un supervisor sin el permiso no ve usuarios; con 'Usuarios de la app' ve solo los de la app, nunca el personal", async () => {
    expect((await get("/admin/usuarios?tipo=app&pagina=1", sup, "supervisor")).status).toBe(403);
    expect((await get("/admin/usuarios?tipo=app&pagina=1", gestor, "supervisor")).status).toBe(200);
    expect((await get("/admin/usuarios?tipo=personal&pagina=1", gestor, "supervisor")).status).toBe(403);
    expect((await get("/admin/usuarios", gestor, "supervisor")).status).toBe(403);
    expect((await get("/admin/usuarios?tipo=app&pagina=1", capt, "capturista")).status).toBe(403); // un usuario de la app no entra al administrador
  });

  it("el administrador crea una cuenta del administrador con permisos: contraseña temporal una vez, cambio obligatorio y permisos en la sesión", async () => {
    const r = await post("/admin/personal", adm, { correo: "Nueva.Persona@SADER.gob.mx", nombre: "Nueva", apellidos: "Persona", rol: "supervisor", permisos: ["ver_resumen", "ver_estadisticas", "exportar_capturas"] }, "admin");
    expect(r.status).toBe(201);
    const c = await r.json();
    expect(c.correo).toBe("nueva.persona@sader.gob.mx");
    expect(c.password).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(c.permisos_efectivos).toEqual(["ver_resumen", "ver_estadisticas", "exportar_capturas"]);
    const [fila] = await q("SELECT rol, debe_cambiar_password, permisos, creado_por, password_hash FROM usuarios WHERE id = $1", [c.id]);
    expect(fila).toMatchObject({ rol: "supervisor", debe_cambiar_password: true, creado_por: adm });
    expect(fila.permisos).toEqual(["ver_resumen", "ver_estadisticas", "exportar_capturas"]);
    expect(fila.password_hash).not.toContain(c.password); // se guarda cifrada
    const login = await fetch(`${base}/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ usuario: "nueva.persona@sader.gob.mx", password: c.password }) });
    expect(login.status).toBe(200);
    const ses = await login.json();
    expect(ses.usuario.debeCambiarPassword).toBe(true);
    expect(ses.usuario.rol).toBe("supervisor");
    expect(ses.usuario.permisos).toEqual(["ver_resumen", "ver_estadisticas", "exportar_capturas"]);
    // el mismo correo no se puede repetir (ni en la app ni en el administrador)
    expect((await post("/admin/personal", adm, { correo: "nueva.persona@sader.gob.mx", nombre: "Otra", apellidos: "Vez", rol: "admin" }, "admin")).status).toBe(409);
    expect((await post("/admin/personal", adm, { correo: "persona.app@correo.com", nombre: "Otra", apellidos: "Vez", rol: "admin" }, "admin")).status).toBe(409);
  });

  it("validaciones del alta: solo un administrador, permisos válidos y al menos una vista", async () => {
    const base_ = { correo: "val@sader.gob.mx", nombre: "Val", apellidos: "Idacion", rol: "supervisor" };
    expect((await post("/admin/personal", sup, { ...base_, permisos: ["ver_resumen"] }, "supervisor")).status).toBe(403);
    expect((await post("/admin/personal", capt, { ...base_, permisos: ["ver_resumen"] }, "capturista")).status).toBe(403);
    expect((await post("/admin/personal", adm, { ...base_, permisos: ["borrar_todo"] }, "admin")).status).toBe(400);
    expect((await post("/admin/personal", adm, { ...base_, permisos: ["revisar_precios"] }, "admin")).status).toBe(400); // sin ninguna vista no podría entrar
    expect((await post("/admin/personal", adm, { ...base_, correo: "no-es-correo", permisos: ["ver_resumen"] }, "admin")).status).toBe(400);
    expect((await post("/admin/personal", adm, { ...base_, rol: "capturista", permisos: ["ver_resumen"] }, "admin")).status).toBe(400); // los de la app no se crean aquí
    const adm2 = await post("/admin/personal", adm, { ...base_, correo: "otro.admin@sader.gob.mx", rol: "admin", permisos: ["ver_resumen"] }, "admin");
    expect(adm2.status).toBe(201);
    expect((await adm2.json()).permisos_efectivos).toHaveLength(10); // un administrador siempre puede todo
    expect((await q("SELECT permisos FROM usuarios WHERE correo = 'otro.admin@sader.gob.mx'"))[0].permisos).toBeNull();
  });

  it("cada ruta del administrador exige su permiso (y un cambio de permisos surte efecto en la siguiente petición)", async () => {
    // solo "Resumen"
    expect((await get("/admin/resumen", soloResumen, "supervisor")).status).toBe(200);
    expect((await get("/admin/actividad", soloResumen, "supervisor")).status).toBe(200);
    expect((await get("/admin/estadisticas", soloResumen, "supervisor")).status).toBe(200); // el resumen usa las estadísticas por estado
    for (const ruta of ["/admin/mapa?bbox=-99,19,-98,20", "/admin/mapa/celdas?bbox=-99,19,-98,20&zoom=5", "/admin/capturas", "/admin/tortillerias", "/admin/sin-fiscal", "/admin/exportar/capturas", "/admin/auditoria", "/admin/usuarios?tipo=app"])
      expect((await get(ruta, soloResumen, "supervisor")).status, ruta).toBe(403);
    expect((await patch(`/admin/capturas/${crypto.randomUUID()}`, soloResumen, { estatus: "validada" }, "supervisor")).status).toBe(403);
    expect((await patch("/admin/capturas", soloResumen, { ids: [crypto.randomUUID()], estatus: "validada" }, "supervisor")).status).toBe(403);
    expect((await patch(`/tortillerias/${tA}/estatus`, soloResumen, { estatus: "validada" }, "supervisor")).status).toBe(403);
    // revisor: ve la revisión y el mapa y puede aprobar precios, pero no validar tortillerías ni descargar
    expect((await get("/admin/capturas?estatus=pendiente", revisor, "supervisor")).status).toBe(200);
    expect((await get("/admin/mapa?bbox=-99,19,-98,20", revisor, "supervisor")).status).toBe(200);
    expect((await patch("/admin/capturas", revisor, { ids: [crypto.randomUUID()], estatus: "validada" }, "supervisor")).status).toBe(200);
    expect((await patch(`/tortillerias/${tA}/estatus`, revisor, { estatus: "validada" }, "supervisor")).status).toBe(403);
    expect((await get("/admin/exportar/capturas", revisor, "supervisor")).status).toBe(403);
    expect((await get("/admin/resumen", revisor, "supervisor")).status).toBe(403);
    // el administrador le agrega permisos: surte efecto de inmediato (sin volver a entrar)
    expect((await patch(`/admin/usuarios/${revisor}`, adm, { permisos: ["ver_revision", "ver_mapa", "revisar_precios", "validar_tortillerias", "exportar_capturas"] })).status).toBe(200);
    expect((await get("/admin/exportar/capturas", revisor, "supervisor")).status).toBe(200);
    expect((await patch(`/tortillerias/${tA}/estatus`, revisor, { estatus: "validada" }, "supervisor")).status).toBe(200);
    expect((await patch(`/admin/usuarios/${revisor}`, adm, { permisos: ["ver_revision"] })).status).toBe(200); // y se los quita
    expect((await get("/admin/exportar/capturas", revisor, "supervisor")).status).toBe(403);
    expect((await patch("/admin/capturas", revisor, { ids: [crypto.randomUUID()], estatus: "validada" }, "supervisor")).status).toBe(403);
  });

  it("los datos fiscales completos solo los ve quien tiene ese permiso (los demás los ven enmascarados)", async () => {
    const t = (await q("INSERT INTO tortillerias(nombre, estado_clave, municipio_clave, geom, origen, estatus) VALUES ('FISCAL PERMISO','09','09015', point(-99.5, 19.9),'denue','validada') RETURNING id"))[0].id as string;
    expect((await post(`/tortillerias/${t}/fiscal`, ana, { tipoPersona: "moral", rfc: "tgu100101ab1", razonSocial: "Empresa Permiso SA", celular: "5512345678", aceptoAviso: true })).status).toBe(201);
    const conPermiso = await usuarioSql("fiscal.si@sader.gob.mx", "supervisor", ["ver_revision", "ver_datos_fiscales"]);
    const sinPermiso = await usuarioSql("fiscal.no@sader.gob.mx", "supervisor", ["ver_revision"]);
    expect((await (await get(`/tortillerias/${t}/fiscal`, conPermiso, "supervisor")).json()).rfc).toBe("TGU100101AB1");
    expect((await (await get(`/tortillerias/${t}/fiscal`, sinPermiso, "supervisor")).json()).rfc).toMatch(/^\*+1AB1$/);
    expect((await (await get(`/tortillerias/${t}/fiscal`, adm, "admin")).json()).rfc).toBe("TGU100101AB1");
  });

  it("editar cuentas: la app solo se activa o desactiva; el personal (rol, permisos, activo) lo edita solo un administrador", async () => {
    // usuarios de la app: no cambian de rol ni reciben permisos
    expect((await patch(`/admin/usuarios/${capt}`, adm, { rol: "supervisor" })).status).toBe(400);
    expect((await patch(`/admin/usuarios/${capt}`, adm, { permisos: ["ver_resumen"] })).status).toBe(400);
    expect((await patch(`/admin/usuarios/${capt}`, adm, { activo: false })).status).toBe(200);
    expect((await q("SELECT activo, rol FROM usuarios WHERE id = $1", [capt]))[0]).toEqual({ activo: false, rol: "capturista" });
    expect((await patch(`/admin/usuarios/${capt}`, adm, { activo: true })).status).toBe(200);
    // quien gestiona usuarios de la app puede desactivar y restablecer a un capturista, pero no toca al personal
    expect((await patch(`/admin/usuarios/${capt}`, gestor, { activo: false }, "supervisor")).status).toBe(200);
    expect((await patch(`/admin/usuarios/${capt}`, gestor, { activo: true }, "supervisor")).status).toBe(200);
    expect((await post(`/admin/usuarios/${capt}/restablecer-password`, gestor, {}, "supervisor")).status).toBe(200);
    expect((await patch(`/admin/usuarios/${soloResumen}`, gestor, { activo: false }, "supervisor")).status).toBe(403);
    expect((await post(`/admin/usuarios/${soloResumen}/restablecer-password`, gestor, {}, "supervisor")).status).toBe(403);
    // el administrador edita al personal
    expect((await patch(`/admin/usuarios/${soloResumen}`, adm, { permisos: ["ver_resumen", "ver_mapa"] })).status).toBe(200);
    expect((await q("SELECT permisos FROM usuarios WHERE id = $1", [soloResumen]))[0].permisos).toEqual(["ver_resumen", "ver_mapa"]);
    expect((await patch(`/admin/usuarios/${soloResumen}`, adm, { permisos: ["ver_resumen", "inventado"] })).status).toBe(400);
    expect((await patch(`/admin/usuarios/${soloResumen}`, adm, { permisos: ["revisar_precios"] })).status).toBe(400); // sin vistas
    expect((await patch(`/admin/usuarios/${soloResumen}`, adm, { activo: false })).status).toBe(200);
    expect((await get("/admin/resumen", soloResumen, "supervisor")).status).toBe(401); // cuenta desactivada: sale de inmediato
    expect((await patch(`/admin/usuarios/${soloResumen}`, adm, { activo: true })).status).toBe(200);
    expect((await patch(`/admin/usuarios/${soloResumen}`, adm, { rol: "admin" })).status).toBe(200); // como administrador pasa a poder todo y sus permisos marcados se limpian
    expect((await q("SELECT rol, permisos FROM usuarios WHERE id = $1", [soloResumen]))[0]).toEqual({ rol: "admin", permisos: null });
    expect((await patch(`/admin/usuarios/${soloResumen}`, adm, { rol: "supervisor", permisos: ["ver_resumen"] })).status).toBe(200);
    // reglas de seguridad
    expect((await patch(`/admin/usuarios/${adm}`, adm, { activo: false })).status).toBe(400); // no a sí mismo
    expect((await patch(`/admin/usuarios/${soloResumen}`, adm, { sorpresa: true })).status).toBe(400);
    expect((await patch(`/admin/usuarios/${crypto.randomUUID()}`, adm, { activo: false })).status).toBe(404);
  });

  it("un administrador puede bajar de rol a otro, pero nunca a sí mismo (así siempre queda al menos un administrador activo)", async () => {
    const otro = await usuarioSql("otro.admin.rol@sader.gob.mx", "admin");
    expect((await patch(`/admin/usuarios/${otro}`, adm, { rol: "supervisor", permisos: ["ver_resumen"] })).status).toBe(200);
    expect((await q("SELECT rol, permisos FROM usuarios WHERE id = $1", [otro]))[0]).toEqual({ rol: "supervisor", permisos: ["ver_resumen"] });
    expect((await patch(`/admin/usuarios/${adm}`, adm, { rol: "supervisor", permisos: ["ver_resumen"] })).status).toBe(400);
    expect((await q("SELECT count(*)::int AS n FROM usuarios WHERE rol = 'admin' AND activo"))[0].n).toBeGreaterThanOrEqual(1);
  });
});

/* ===================== Orden y filtros de Revisión y Usuarios ===================== */
describe("orden y filtros en Revisión y Usuarios", () => {
  const nuevaOrd = async (nombre: string, dias: number, estatus = "pendiente") =>
    (await q("INSERT INTO tortillerias(nombre, estado_clave, municipio_clave, geom, origen, estatus, creado_en, creado_por) VALUES ($1,'09','09015', point(-99.6, 19.95),'nueva',$2, now() - ($3::int || ' days')::interval, $4) RETURNING id", [nombre, estatus, dias, ana]))[0].id as string;
  const lista = async (url: string, rol = "supervisor") => (await (await get(url, sup, rol)).json()) as any;
  const nombres = (r: any) => r.filas.map((f: any) => f.nombre);
  let ta: string, tb: string, tc: string;

  beforeAll(async () => {
    ta = await nuevaOrd("ORD Zeta", 1); //  la más reciente, con 2 fotos
    tb = await nuevaOrd("ORD Álamo", 5); // intermedia, sin foto
    tc = await nuevaOrd("ORD Ñandú", 9); //  la más antigua, con 1 foto
    await q("INSERT INTO fotos(tortilleria_id, archivo) VALUES ($1,'a.jpg'),($1,'b.jpg'),($2,'c.jpg')", [ta, tc]);
  });

  it("tortillerías nuevas: más recientes por omisión, más antiguas, por nombre y con más fotos", async () => {
    const base = "/admin/tortillerias?origen=nueva&estatus=pendiente&q=ORD&pagina=1&limite=50";
    expect(nombres(await lista(base))).toEqual(["ORD Zeta", "ORD Álamo", "ORD Ñandú"]); // recientes (como antes)
    expect(nombres(await lista(`${base}&orden=recientes`))).toEqual(["ORD Zeta", "ORD Álamo", "ORD Ñandú"]);
    expect(nombres(await lista(`${base}&orden=antiguas`))).toEqual(["ORD Ñandú", "ORD Álamo", "ORD Zeta"]);
    expect(nombres(await lista(`${base}&orden=nombre`))).toEqual(["ORD Álamo", "ORD Ñandú", "ORD Zeta"]);
    expect(nombres(await lista(`${base}&orden=fotos`))).toEqual(["ORD Zeta", "ORD Ñandú", "ORD Álamo"]);
    expect(nombres(await lista(`${base}&orden=inventado`))).toEqual(["ORD Zeta", "ORD Álamo", "ORD Ñandú"]); // un orden desconocido no rompe nada
  });

  it("tortillerías nuevas: con foto, sin foto y buscador sin acentos ni mayúsculas (el total coincide con las páginas)", async () => {
    const base = "/admin/tortillerias?origen=nueva&estatus=pendiente&q=ord&pagina=1&limite=50";
    expect(nombres(await lista(`${base}&foto=sin`))).toEqual(["ORD Álamo"]);
    expect(nombres(await lista(`${base}&foto=con`))).toEqual(["ORD Zeta", "ORD Ñandú"]);
    expect(nombres(await lista("/admin/tortillerias?origen=nueva&estatus=pendiente&q=alamo&pagina=1"))).toEqual(["ORD Álamo"]); // "alamo" encuentra "Álamo"
    expect(nombres(await lista("/admin/tortillerias?origen=nueva&estatus=pendiente&q=NANDU&pagina=1"))).toEqual(["ORD Ñandú"]); // y "NANDU" a "Ñandú"
    const pag1 = await lista("/admin/tortillerias?origen=nueva&estatus=pendiente&q=ord&pagina=1&limite=2&orden=nombre");
    expect(pag1.total).toBe(3);
    expect(pag1.filas).toHaveLength(2);
    const pag2 = await lista("/admin/tortillerias?origen=nueva&estatus=pendiente&q=ord&pagina=2&limite=2&orden=nombre");
    expect(nombres(pag2)).toEqual(["ORD Zeta"]);
    expect((await lista("/admin/tortillerias?origen=nueva&q=ana@correo.com&pagina=1")).total).toBeGreaterThanOrEqual(3); // sí busca por quien la dio de alta
  });

  it("precios atípicos: más recientes, más antiguos, mayor diferencia, precio más alto y más bajo; por producto y buscador", async () => {
    const t = await nuevaOrd("ORD Precios", 2, "validada");
    const ins = (precio: number, mediana: number, producto: string, dias: number) =>
      q("INSERT INTO capturas_precio(tortilleria_id, producto, precio_kg, fecha, estatus, alerta, mediana_ref, n_ref, creado_en) VALUES ($1,$2,$3,current_date - $4::int,'pendiente',true,$5,4, now() - ($4::int || ' days')::interval)", [t, producto, precio, dias, mediana]);
    await ins(30, 25, "maiz", 1); //  +20 %, la más reciente
    await ins(50, 25, "maiz", 3); //  +100 %
    await ins(12, 25, "masa", 5); //  -52 %, la más antigua
    const caps = async (extra: string) => (await lista(`/admin/capturas?estatus=pendiente&q=ord%20precios&pagina=1&limite=50${extra}`)).filas.map((f: any) => Number(f.precio_kg));
    expect(await caps("&orden=recientes")).toEqual([30, 50, 12]);
    expect(await caps("&orden=antiguas")).toEqual([12, 50, 30]);
    expect(await caps("&orden=diferencia")).toEqual([50, 12, 30]); // |+100|, |-52|, |+20|
    expect(await caps("&orden=precio_alto")).toEqual([50, 30, 12]);
    expect(await caps("&orden=precio_bajo")).toEqual([12, 30, 50]);
    expect(await caps("&producto=masa")).toEqual([12]);
    expect(await caps("&producto=maiz&orden=precio_bajo")).toEqual([30, 50]);
    expect(await caps("&orden=inventado")).toHaveLength(3);
    expect((await lista("/admin/capturas?estatus=pendiente&q=persona%20inexistente&pagina=1")).total).toBe(0);
    expect((await lista(`/admin/capturas?estatus=pendiente&q=ORD%20PRECIOS&producto=masa&pagina=1`)).total).toBe(1);
  });

  it("usuarios de la app: orden (más recientes, más capturas, última captura, nombre) y actividad de 7 días", async () => {
    const u = async (correo: string, nombre: string, dias: number) => (await q("INSERT INTO usuarios(usuario, correo, rol, nombre, apellidos, creado_en) VALUES ($1,$1,'capturista',$2,'Orden', now() - ($3::int || ' days')::interval) RETURNING id", [correo, nombre, dias]))[0].id as string;
    const cap = (usuarioId: string, n: number, dias: number) =>
      q("INSERT INTO capturas_precio(tortilleria_id, producto, precio_kg, fecha, estatus, aprobacion, capturista_id) SELECT (SELECT id FROM tortillerias LIMIT 1), 'maiz', 20, current_date - $3::int - i, 'validada','automatica', $1 FROM generate_series(1, $2::int) i", [usuarioId, n, dias]);
    const u1 = await u("orden.uno@correo.com", "Bruno", 10); //  muchas capturas, la última hace 20 días
    const u2 = await u("orden.dos@correo.com", "Álvaro", 5); //  pocas, de ayer
    const u3 = await u("orden.tres@correo.com", "Zoe", 1); //    sin capturas, la más nueva
    await cap(u1, 6, 20);
    await cap(u2, 2, 1);
    const l = async (extra: string) => (await (await get(`/admin/usuarios?tipo=app&q=orden.&pagina=1&limite=50${extra}`, adm, "admin")).json()).filas.map((f: any) => f.correo);
    expect(await l("&orden=recientes")).toEqual(["orden.tres@correo.com", "orden.dos@correo.com", "orden.uno@correo.com"]);
    expect(await l("")).toEqual(["orden.tres@correo.com", "orden.dos@correo.com", "orden.uno@correo.com"]); // por omisión, como antes
    expect(await l("&orden=antiguos")).toEqual(["orden.uno@correo.com", "orden.dos@correo.com", "orden.tres@correo.com"]);
    expect(await l("&orden=capturas")).toEqual(["orden.uno@correo.com", "orden.dos@correo.com", "orden.tres@correo.com"]);
    expect(await l("&orden=ultima")).toEqual(["orden.dos@correo.com", "orden.uno@correo.com", "orden.tres@correo.com"]); // sin capturas al final
    expect(await l("&orden=nombre")).toEqual(["orden.dos@correo.com", "orden.uno@correo.com", "orden.tres@correo.com"]); // Álvaro, Bruno, Zoe
    expect(await l("&actividad=activos7")).toEqual(["orden.dos@correo.com"]);
    expect(await l("&actividad=sin7")).toEqual(["orden.uno@correo.com"]);
    expect(await l("&actividad=nunca")).toEqual(["orden.tres@correo.com"]);
    expect(await l("&orden=inventado&actividad=inventada")).toHaveLength(3);
    // el personal también se ordena
    const per = await (await get("/admin/usuarios?tipo=personal&pagina=1&limite=50&orden=nombre", adm, "admin")).json();
    expect(per.filas.length).toBeGreaterThan(0);
    expect((await get("/admin/usuarios?tipo=app&pagina=1&orden=nombre", capt0(), "capturista")).status).toBe(403);
    void u3;
  });
});
function capt0() {
  return ana; // un usuario de la app no entra al administrador, ordene como ordene
}
