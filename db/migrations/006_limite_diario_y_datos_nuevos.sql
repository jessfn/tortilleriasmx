-- Revisión de noviembre 2026 (CAMBIOS_TORTILLERIASMX.md): límite diario de captura, datos fiscales por tortillería
-- y tortillerías nuevas con los mismos campos del DENUE.
-- Todo va en una sola transacción: si algo falla (por ejemplo, capturas duplicadas), no se aplica nada y no se borra nada.
BEGIN;

-- C3. Antes de crear el índice único se revisa que no haya capturas duplicadas. Si las hay, la migración se detiene
-- SIN borrar datos, para decidir con calma qué hacer con ellas.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT 1 FROM capturas_precio
     WHERE capturista_id IS NOT NULL
     GROUP BY capturista_id, tortilleria_id, producto, fecha
    HAVING count(*) > 1
  ) d;
  IF n > 0 THEN
    RAISE EXCEPTION 'Hay % grupos de capturas duplicadas (mismo capturista, tortillería, producto y día). No se aplicó nada. Revísalas con: SELECT capturista_id, tortilleria_id, producto, fecha, count(*) FROM capturas_precio WHERE capturista_id IS NOT NULL GROUP BY 1,2,3,4 HAVING count(*) > 1;', n;
  END IF;
END $$;

-- C3. El día se cuenta en hora de México (el servidor puede estar en UTC)
ALTER TABLE capturas_precio
  ALTER COLUMN fecha SET DEFAULT ((now() AT TIME ZONE 'America/Mexico_City')::date);

-- C3. Una captura por censador, tortillería, producto y día
CREATE UNIQUE INDEX capturas_una_por_dia_uidx
  ON capturas_precio (capturista_id, tortilleria_id, producto, fecha)
  WHERE capturista_id IS NOT NULL;

-- C6. Tortillería nueva: las mismas columnas que el catálogo del DENUE (todas opcionales para no romper filas existentes)
ALTER TABLE tortillerias
  ADD COLUMN IF NOT EXISTS localidad text,
  ADD COLUMN IF NOT EXISTS tipo_vial text,
  ADD COLUMN IF NOT EXISTS calle text,
  ADD COLUMN IF NOT EXISTS numero_ext text,
  ADD COLUMN IF NOT EXISTS numero_int text,
  ADD COLUMN IF NOT EXISTS colonia text,
  ADD COLUMN IF NOT EXISTS codigo_postal text,
  ADD COLUMN IF NOT EXISTS telefono text,
  ADD COLUMN IF NOT EXISTS correo text,
  ADD COLUMN IF NOT EXISTS personal_ocupado text,
  ADD COLUMN IF NOT EXISTS codigo_scian text,
  ADD COLUMN IF NOT EXISTS fecha_alta text;

-- C5. Datos fiscales de la tortillería (la empresa), una sola vez por tortillería.
-- El RFC puede repetirse entre tortillerías (sucursales); no hay unicidad. Se guarda cifrado.
CREATE TABLE IF NOT EXISTS tortilleria_fiscal (
  tortilleria_id uuid PRIMARY KEY REFERENCES tortillerias(id),
  tipo_persona text NOT NULL CHECK (tipo_persona IN ('fisica','moral')),
  rfc_cifrado bytea NOT NULL,
  rfc_hash text NOT NULL,
  razon_social text NOT NULL,
  celular_cifrado bytea,
  celular_hash text,
  capturado_por uuid REFERENCES usuarios(id),
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tortilleria_fiscal_rfc_idx ON tortilleria_fiscal (rfc_hash);

-- C5. El aviso de privacidad ahora se acepta a nombre de la tortillería (ya no hay responsable por captura).
-- La tabla `responsables` y sus datos se conservan intactos.
ALTER TABLE consentimientos
  ADD COLUMN IF NOT EXISTS tortilleria_id uuid REFERENCES tortillerias(id),
  ADD COLUMN IF NOT EXISTS usuario_id uuid REFERENCES usuarios(id);

-- Apoyo a las consultas del panel del censador
CREATE INDEX IF NOT EXISTS capturas_tortilleria_idx ON capturas_precio (tortilleria_id, capturista_id, producto, fecha DESC);

COMMIT;
