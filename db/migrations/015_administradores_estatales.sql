-- C20: administradores estatales (OREF y Fertilizantes), estados de cuenta de los censadores, fecha de corte y alcance por estado.
BEGIN;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('capturista','supervisor','admin','estatal'));

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS apellido_paterno text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS apellido_materno text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS curp_cifrado bytea;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS curp_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_curp_uidx ON usuarios (curp_hash) WHERE curp_hash IS NOT NULL;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS estado_clave text REFERENCES estados(clave);   -- estado del censador
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS estado_sugerido boolean NOT NULL DEFAULT false; -- true = deducido de sus capturas
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS estados_alcance text[];                        -- administrador estatal
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS alcance_nacional boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS programa text CHECK (programa IN ('oref','fertilizantes'));  -- solo administradores estatales
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS estado_cuenta text NOT NULL DEFAULT 'autorizado'
  CHECK (estado_cuenta IN ('por_autorizar','autorizado','rechazado'));
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS registro_abierto boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS datos_completos boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS autorizado_por uuid REFERENCES usuarios(id);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS autorizado_en timestamptz;
CREATE INDEX IF NOT EXISTS usuarios_estado_idx ON usuarios (estado_clave, estado_cuenta);

-- Ajustes del sistema (la fecha de corte se cambia desde el panel, sin publicar una versión nueva)
CREATE TABLE IF NOT EXISTS configuracion (clave text PRIMARY KEY, valor text NOT NULL, actualizado_por uuid REFERENCES usuarios(id), actualizado_en timestamptz NOT NULL DEFAULT now());
INSERT INTO configuracion(clave, valor) VALUES ('corte_registro_abierto', '2026-11-25T00:00:00-06:00') ON CONFLICT DO NOTHING;

-- Censadores que ya existen: siguen autorizados, quedan marcados como "registro abierto" y deben completar sus datos.
-- Estado sugerido: donde tienen más capturas de precio (en empate, donde está la más reciente). Si nunca capturaron, queda vacío.
UPDATE usuarios u
   SET estado_cuenta = 'autorizado', registro_abierto = true, datos_completos = false
 WHERE u.rol = 'capturista';

WITH por_estado AS (
  SELECT c.capturista_id AS usuario_id, t.estado_clave, count(*) AS n, max(coalesce(c.capturado_en, c.creado_en)) AS ultima
    FROM capturas_precio c JOIN tortillerias t ON t.id = c.tortilleria_id
   WHERE c.capturista_id IS NOT NULL AND t.estado_clave IS NOT NULL
   GROUP BY c.capturista_id, t.estado_clave
), elegido AS (
  SELECT DISTINCT ON (usuario_id) usuario_id, estado_clave FROM por_estado ORDER BY usuario_id, n DESC, ultima DESC
)
UPDATE usuarios u SET estado_clave = e.estado_clave, estado_sugerido = true
  FROM elegido e WHERE e.usuario_id = u.id AND u.rol = 'capturista' AND u.estado_clave IS NULL;

-- Las capturas de una cuenta RECHAZADA dejan de contar (no se borra nada: si se vuelve a autorizar, regresan solas).
-- Desactivar NO las excluye. Se conservan todas las columnas de la vista de la migración 014.
DROP VIEW IF EXISTS precios_que_cuentan;
CREATE VIEW precios_que_cuentan AS
SELECT c.*, t.estado_clave, t.municipio_clave, t.geom AS geom_tortilleria, t.origen AS origen_tortilleria,
       t.elaboracion AS elaboracion_tortilleria, t.operacion AS operacion_tortilleria
  FROM capturas_precio c
  JOIN tortillerias t ON t.id = c.tortilleria_id
 WHERE c.estatus = 'validada' AND t.estatus = 'validada' AND c.producto IN ('maiz','masa')
   AND NOT EXISTS (SELECT 1 FROM usuarios ur WHERE ur.id = c.capturista_id AND ur.estado_cuenta = 'rechazado');

COMMIT;
