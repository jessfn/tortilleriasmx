CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  apellidos text NOT NULL,
  usuario text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  rol text NOT NULL CHECK (rol IN ('capturista','supervisor','admin')),
  activo boolean NOT NULL DEFAULT true,
  estado_asignado text,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE estados (clave text PRIMARY KEY, nombre text NOT NULL);

CREATE TABLE municipios (
  clave text PRIMARY KEY,
  estado_clave text NOT NULL REFERENCES estados(clave),
  nombre text NOT NULL,
  geom geometry(MultiPolygon,4326)
);
CREATE INDEX municipios_geom_idx ON municipios USING gist(geom);

CREATE TABLE tortillerias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_denue text UNIQUE,
  nombre text NOT NULL,
  domicilio text,
  estado_clave text REFERENCES estados(clave),
  municipio_clave text REFERENCES municipios(clave),
  geom geometry(Point,4326),
  origen text NOT NULL CHECK (origen IN ('denue','propia','nueva')),
  estatus text NOT NULL DEFAULT 'pendiente' CHECK (estatus IN ('pendiente','validada','rechazada')),
  foto_principal text,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tortillerias_geom_idx ON tortillerias USING gist(geom);

CREATE TABLE responsables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tortilleria_id uuid NOT NULL REFERENCES tortillerias(id),
  nombre text NOT NULL,
  apellidos text NOT NULL,
  curp_cifrado bytea NOT NULL,
  curp_hash text NOT NULL,
  telefono_cifrado bytea NOT NULL,
  telefono_hash text NOT NULL,
  tipo_persona text NOT NULL CHECK (tipo_persona IN ('fisica','moral')),
  rfc_cifrado bytea NOT NULL,
  rfc_hash text NOT NULL,
  razon_social text
);

CREATE TABLE capturas_precio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tortilleria_id uuid NOT NULL REFERENCES tortillerias(id),
  producto text NOT NULL CHECK (producto IN ('maiz','harina','masa')),
  precio_kg numeric(6,2) NOT NULL CHECK (precio_kg BETWEEN 5 AND 60),
  fecha date NOT NULL DEFAULT current_date,
  capturista_id uuid NOT NULL REFERENCES usuarios(id),
  geom_captura geometry(Point,4326),
  precision_gps real,
  estatus text NOT NULL DEFAULT 'pendiente',
  alerta boolean NOT NULL DEFAULT false
);
CREATE INDEX capturas_geom_idx ON capturas_precio USING gist(geom_captura);

CREATE TABLE fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tortilleria_id uuid NOT NULL REFERENCES tortillerias(id),
  archivo text NOT NULL,
  miniatura text,
  capturista_id uuid REFERENCES usuarios(id),
  fecha timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  captura_id uuid REFERENCES capturas_precio(id),
  estatus text NOT NULL DEFAULT 'abierta',
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auditoria (
  id bigserial PRIMARY KEY,
  usuario_id uuid REFERENCES usuarios(id),
  accion text NOT NULL,
  entidad text,
  entidad_id text,
  fecha timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consentimientos (
  id bigserial PRIMARY KEY,
  responsable_id uuid REFERENCES responsables(id),
  version text NOT NULL,
  aceptado_en timestamptz NOT NULL DEFAULT now()
);
