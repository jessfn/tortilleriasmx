-- La captura es pública (sin usuario): la captura de precio puede no tener capturista.
ALTER TABLE capturas_precio ALTER COLUMN capturista_id DROP NOT NULL;
ALTER TABLE capturas_precio ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'publica';
