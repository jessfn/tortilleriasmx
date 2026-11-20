-- C18: reportes descargables (EXTRAS). Índice para filtrar capturas por el momento en que se hicieron (hora de captura del teléfono, o la del servidor).
BEGIN;
CREATE INDEX IF NOT EXISTS capturas_momento_idx ON capturas_precio ((coalesce(capturado_en, creado_en)));
CREATE INDEX IF NOT EXISTS tortillerias_nuevas_idx ON tortillerias (creado_en) WHERE origen = 'nueva';
COMMIT;
