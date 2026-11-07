-- Catálogo del DENUE (INEGI), separado de lo que capturan los usuarios.
-- id_denue es la llave del catálogo: se puede volver a cargar un DENUE nuevo sin perder usuarios, responsables, fotos ni precios.
CREATE TABLE IF NOT EXISTS denue_catalogo (
  id_denue text PRIMARY KEY,
  clee text,
  nombre text NOT NULL,
  razon_social text,
  telefono text,
  correo text,
  cve_ent text NOT NULL,
  entidad text,
  cve_mun text NOT NULL,
  municipio text,
  cve_loc text,
  localidad text,
  tipo_vial text,
  calle text,
  numero_ext text,
  numero_int text,
  colonia text,
  codigo_postal text,
  latitud double precision,
  longitud double precision,
  codigo_scian text,
  personal_ocupado text,
  fecha_alta text,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS denue_catalogo_municipio_idx ON denue_catalogo (cve_ent, cve_mun);

-- Las tortillerías del DENUE se reflejan en `tortillerias` (origen 'denue') para poder elegirlas y ligarles precios.
-- tortillerias.id_denue ya es único: es el enlace con el catálogo.
ALTER TABLE tortillerias ADD COLUMN IF NOT EXISTS denue_sincronizado_en timestamptz;
CREATE INDEX IF NOT EXISTS tortillerias_municipio_idx ON tortillerias (municipio_clave);
CREATE INDEX IF NOT EXISTS tortillerias_estado_idx ON tortillerias (estado_clave);
