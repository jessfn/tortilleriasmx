-- C21 (ajuste): el cuestionario se contesta completo. Ya no se ofrecen "No sabe" ni "Prefiere no responder";
-- donde hace falta hay "Otro" con su texto: A1 (dónde está), B1 (con qué hace la tortilla), B3 (de quién es) y B8 (otro apoyo). B6 ya lo tenía.
-- Los registros anteriores con NO_SABE o NO_RESPONDE se conservan tal cual (historial).
BEGIN;
ALTER TABLE tortilleria_cuestionarios ADD COLUMN IF NOT EXISTS a1_otro text CHECK (length(a1_otro) <= 100);
ALTER TABLE tortilleria_cuestionarios ADD COLUMN IF NOT EXISTS b1_otro text CHECK (length(b1_otro) <= 100);
ALTER TABLE tortilleria_cuestionarios ADD COLUMN IF NOT EXISTS b3_otro text CHECK (length(b3_otro) <= 100);
ALTER TABLE tortilleria_cuestionarios ADD COLUMN IF NOT EXISTS b8_otro text CHECK (length(b8_otro) <= 100);

-- B1 y B3 aceptan OTRO (y siguen aceptando los códigos anteriores de los registros ya guardados)
ALTER TABLE tortilleria_cuestionarios DROP CONSTRAINT IF EXISTS tortilleria_cuestionarios_b1_insumo_check;
ALTER TABLE tortilleria_cuestionarios ADD CONSTRAINT tortilleria_cuestionarios_b1_insumo_check
  CHECK (b1_insumo IN ('MAIZ_PROPIO','MASA_COMPRADA','HARINA','MEZCLA','OTRO','NO_SABE'));
ALTER TABLE tortilleria_cuestionarios DROP CONSTRAINT IF EXISTS tortilleria_cuestionarios_b3_propiedad_check;
ALTER TABLE tortilleria_cuestionarios ADD CONSTRAINT tortilleria_cuestionarios_b3_propiedad_check
  CHECK (b3_propiedad IN ('FAMILIAR','VARIAS_SUCURSALES','EMPRESA','OTRO','NO_SABE'));

-- la vista usa * (DISTINCT ON): se recrea para que traiga las columnas nuevas
DROP VIEW IF EXISTS cuestionario_vigente;
CREATE VIEW cuestionario_vigente AS
SELECT DISTINCT ON (tortilleria_id) *
  FROM tortilleria_cuestionarios
 WHERE estatus = 'aplicado'
 ORDER BY tortilleria_id, coalesce(capturado_en, creado_en) DESC, creado_en DESC;
COMMIT;
