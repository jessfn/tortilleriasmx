-- C16: usuarios de la app (capturistas) y personal del administrador (supervisores y administradores) por separado,
-- con permisos de vistas y acciones para el personal.
BEGIN;
-- Lista de permisos del supervisor. NULL = los de por omisión (como siempre). Un administrador siempre puede todo.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos text[];
-- Quién dio de alta la cuenta (para las cuentas del administrador creadas desde el panel)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS creado_por uuid REFERENCES usuarios(id);
COMMIT;
