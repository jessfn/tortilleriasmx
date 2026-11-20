-- C19: tortillerías que ya no funcionan (baja inmediata) y tipo de elaboración (máquina, a mano o ambas).
BEGIN;

/* ---------- Parte 1: baja de un establecimiento ---------- */

-- Estado de operación: independiente de `estatus` (que es la validación de una tortillería nueva)
ALTER TABLE tortillerias ADD COLUMN IF NOT EXISTS operacion text NOT NULL DEFAULT 'activa'
  CHECK (operacion IN ('activa','inactiva'));
ALTER TABLE tortillerias ADD COLUMN IF NOT EXISTS operacion_cambiada_en timestamptz;

-- Cada baja (y cada reactivación), con quién, cuándo y por qué
CREATE TABLE IF NOT EXISTS tortilleria_bajas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tortilleria_id uuid NOT NULL REFERENCES tortillerias(id),
  capturista_id uuid REFERENCES usuarios(id),
  motivo text NOT NULL CHECK (motivo IN ('cerro','cambio_giro','local_vacio','no_existe','otro')),
  motivo_otro text,
  geom_captura geometry(Point,4326),
  precision_gps real,
  capturado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  id_cliente uuid UNIQUE,
  reactivada_por uuid REFERENCES usuarios(id),   -- si después se reactivó
  reactivada_en timestamptz,
  contradicciones int NOT NULL DEFAULT 0,        -- precios que llegaron después de la baja
  CHECK (motivo <> 'otro' OR length(trim(coalesce(motivo_otro,''))) >= 5)
);
CREATE INDEX IF NOT EXISTS tortilleria_bajas_tortilleria_idx ON tortilleria_bajas (tortilleria_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS tortillerias_operacion_idx ON tortillerias (operacion);

/* ---------- Parte 2: tipo de elaboración ---------- */

ALTER TABLE tortillerias ADD COLUMN IF NOT EXISTS elaboracion text CHECK (elaboracion IN ('maquina','mano','ambas'));
ALTER TABLE tortillerias ADD COLUMN IF NOT EXISTS elaboracion_actualizada_en timestamptz;
ALTER TABLE capturas_precio ADD COLUMN IF NOT EXISTS ref_elaboracion text CHECK (ref_elaboracion IN ('maquina','mano','ambas'));

CREATE TABLE IF NOT EXISTS tortilleria_elaboracion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tortilleria_id uuid NOT NULL REFERENCES tortillerias(id),
  capturista_id uuid REFERENCES usuarios(id),
  elaboracion text NOT NULL CHECK (elaboracion IN ('maquina','mano','ambas')),
  capturado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  id_cliente uuid UNIQUE
);
CREATE INDEX IF NOT EXISTS tortilleria_elaboracion_idx ON tortilleria_elaboracion (tortilleria_id, creado_en DESC);

-- La vista trae también el tipo de elaboración y la operación de la tortillería (se recrea porque `c.*` ahora incluye ref_elaboracion).
-- Un precio sigue contando aunque la tortillería ya esté inactiva: el historial y la tendencia de las fechas en que estaba activa se conservan.
DROP VIEW IF EXISTS precios_que_cuentan;
CREATE VIEW precios_que_cuentan AS
SELECT c.*, t.estado_clave, t.municipio_clave, t.geom AS geom_tortilleria, t.origen AS origen_tortilleria,
       t.elaboracion AS elaboracion_tortilleria, t.operacion AS operacion_tortilleria
  FROM capturas_precio c
  JOIN tortillerias t ON t.id = c.tortilleria_id
 WHERE c.estatus = 'validada' AND t.estatus = 'validada' AND c.producto IN ('maiz','masa');

COMMIT;
