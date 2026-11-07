-- Cuentas de usuario por correo; quien registra una tortillería queda como su autor.
ALTER TABLE usuarios ALTER COLUMN nombre SET DEFAULT '';
ALTER TABLE usuarios ALTER COLUMN apellidos SET DEFAULT '';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS correo text;
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_correo_uidx ON usuarios (lower(correo));
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_usuario_lower_uidx ON usuarios (lower(usuario));

ALTER TABLE tortillerias ADD COLUMN IF NOT EXISTS creado_por uuid REFERENCES usuarios(id);
ALTER TABLE capturas_precio ADD COLUMN IF NOT EXISTS creado_en timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS capturas_capturista_idx ON capturas_precio (capturista_id, creado_en DESC);
CREATE INDEX IF NOT EXISTS capturas_estatus_idx ON capturas_precio (estatus, alerta);
