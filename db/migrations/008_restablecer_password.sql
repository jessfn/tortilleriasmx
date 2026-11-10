-- Recuperar contraseña: la administración restablece la contraseña de una cuenta con una temporal y la persona
-- debe cambiarla al entrar. Esta marca obliga a esa pantalla hasta que lo haga.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password boolean NOT NULL DEFAULT false;
