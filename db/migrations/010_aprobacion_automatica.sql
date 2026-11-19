-- C15: aprobación automática de precios normales, una sola regla de "qué precio cuenta" y datos para revisar los atípicos.
BEGIN;

ALTER TABLE capturas_precio ADD COLUMN IF NOT EXISTS aprobacion text CHECK (aprobacion IN ('automatica','manual'));
ALTER TABLE capturas_precio ADD COLUMN IF NOT EXISTS mediana_ref numeric(6,2);   -- mediana del municipio al capturar
ALTER TABLE capturas_precio ADD COLUMN IF NOT EXISTS n_ref int;                   -- con cuántos precios se calculó
ALTER TABLE capturas_precio ADD COLUMN IF NOT EXISTS revisado_por uuid REFERENCES usuarios(id);
ALTER TABLE capturas_precio ADD COLUMN IF NOT EXISTS revisado_en timestamptz;

-- Aprobar de un jalón lo que hoy está pendiente y NO es atípico (decisión de Mariel, 19 nov 2026).
-- Los atípicos pendientes no se tocan. Una sola fila de auditoría para toda la aprobación.
WITH aprobadas AS (
  UPDATE capturas_precio
     SET estatus = 'validada', aprobacion = 'automatica'
   WHERE estatus = 'pendiente' AND alerta = false
  RETURNING id
)
INSERT INTO auditoria(usuario_id, accion, entidad, entidad_id)
SELECT NULL, 'aprobacion_masiva_migracion_010', 'capturas_precio', (SELECT count(*)::text FROM aprobadas)
 WHERE EXISTS (SELECT 1 FROM aprobadas);

-- Las alertas de esos precios (si hubiera) quedan resueltas
UPDATE alertas a SET estatus = 'resuelta'
  FROM capturas_precio c
 WHERE a.captura_id = c.id AND c.aprobacion = 'automatica' AND a.estatus = 'abierta';

CREATE INDEX IF NOT EXISTS capturas_cuenta_idx ON capturas_precio (tortilleria_id, producto, fecha DESC) WHERE estatus = 'validada';

-- Un precio CUENTA (promedios, conteos, tendencia, mapa y resumen) solo si: la captura está validada, la tortillería está validada
-- (las del DENUE ya entran validadas; una nueva cuenta cuando el supervisor la valida) y es tortilla o masa.
CREATE OR REPLACE VIEW precios_que_cuentan AS
SELECT c.*, t.estado_clave, t.municipio_clave, t.geom AS geom_tortilleria, t.origen AS origen_tortilleria
  FROM capturas_precio c
  JOIN tortillerias t ON t.id = c.tortilleria_id
 WHERE c.estatus = 'validada' AND t.estatus = 'validada' AND c.producto IN ('maiz','masa');

COMMIT;
