-- C14: registrar que no se obtuvieron los datos fiscales (y por qué). Una fila por cada intento fallido.
CREATE TABLE IF NOT EXISTS fiscal_negativas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tortilleria_id uuid NOT NULL REFERENCES tortillerias(id),
  capturista_id uuid REFERENCES usuarios(id),
  motivo text NOT NULL CHECK (motivo IN ('inseguridad','se_nego','desconfianza','no_conoce','sin_rfc','cerrado','otro')),
  motivo_otro text,
  capturado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  id_cliente uuid UNIQUE,
  CHECK (motivo <> 'otro' OR length(trim(coalesce(motivo_otro,''))) >= 5)
);
CREATE INDEX IF NOT EXISTS fiscal_negativas_tortilleria_idx ON fiscal_negativas (tortilleria_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS fiscal_negativas_motivo_idx ON fiscal_negativas (motivo);
