-- C17: la foto del frente se pide también en tortillerías que ya existen (DENUE) la primera vez que se visitan.
-- Si no se pudo tomar, se registra el motivo (una fila por intento). Nunca bloquea el precio.
CREATE TABLE IF NOT EXISTS foto_negativas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tortilleria_id uuid NOT NULL REFERENCES tortillerias(id),
  capturista_id uuid REFERENCES usuarios(id),
  motivo text NOT NULL CHECK (motivo IN ('cerrado','no_permitieron','sin_camara','otro')),
  motivo_otro text,
  capturado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  id_cliente uuid UNIQUE,
  CHECK (motivo <> 'otro' OR length(trim(coalesce(motivo_otro,''))) >= 5)
);
CREATE INDEX IF NOT EXISTS foto_negativas_tortilleria_idx ON foto_negativas (tortilleria_id, creado_en DESC);
-- Para saber rápido qué tortillerías ya tienen foto (catálogo del teléfono, resumen)
CREATE INDEX IF NOT EXISTS fotos_tortilleria_idx ON fotos (tortilleria_id);
