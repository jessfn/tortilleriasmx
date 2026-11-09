-- Modo sin conexión: ids generados en el teléfono (idempotencia), hora real de captura y versión del catálogo por estado

ALTER TABLE tortillerias    ADD COLUMN IF NOT EXISTS id_cliente uuid UNIQUE;
ALTER TABLE tortillerias    ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT now();
ALTER TABLE capturas_precio ADD COLUMN IF NOT EXISTS id_cliente uuid UNIQUE;
ALTER TABLE capturas_precio ADD COLUMN IF NOT EXISTS capturado_en timestamptz; -- hora del teléfono
ALTER TABLE fotos           ADD COLUMN IF NOT EXISTS id_cliente uuid UNIQUE;

CREATE OR REPLACE FUNCTION tortillerias_tocar() RETURNS trigger AS $$
BEGIN
  NEW.actualizado_en := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tortillerias_actualizado ON tortillerias;
CREATE TRIGGER tortillerias_actualizado BEFORE UPDATE ON tortillerias
  FOR EACH ROW EXECUTE FUNCTION tortillerias_tocar();

CREATE INDEX IF NOT EXISTS tortillerias_estado_idx ON tortillerias (estado_clave);
