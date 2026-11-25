-- C21: cuestionario de supervisión de tortillerías. Una vez por tortillería, con historial (nunca se sobrescribe): el vigente es el más reciente.
-- Las respuestas se guardan en código (los mismos catálogos de packages/shared/src/cuestionario.ts). Solo el rol admin (DGTIC) ve las respuestas.
BEGIN;

CREATE TABLE IF NOT EXISTS tortilleria_cuestionarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tortilleria_id uuid NOT NULL REFERENCES tortillerias(id),
  capturista_id uuid REFERENCES usuarios(id),
  version text NOT NULL DEFAULT 'v1',
  estatus text NOT NULL CHECK (estatus IN ('aplicado','no_aplicado')),
  motivo_no_aplica text CHECK (motivo_no_aplica IN ('NO_QUISO','SIN_ENCARGADO','CERRADA','INSEGURIDAD','OTRO')),
  motivo_no_aplica_otro text,
  -- Bloque A
  a1_ubicacion text CHECK (a1_ubicacion IN ('INDEPENDIENTE','MERCADO','TIENDA','OTRO')),
  a2_limpieza boolean, a2_plagas boolean, a2_insumos boolean, a2_personal boolean, a2_basura boolean,
  -- Bloque B
  b1_insumo text CHECK (b1_insumo IN ('MAIZ_PROPIO','MASA_COMPRADA','HARINA','MEZCLA','NO_SABE')),
  b2_volumen text CHECK (b2_volumen IN ('V_0_250','V_250_500','V_500_1000','V_1000_3000','V_3000_MAS','NO_SABE','NO_RESPONDE')),
  b3_propiedad text CHECK (b3_propiedad IN ('FAMILIAR','VARIAS_SUCURSALES','EMPRESA','NO_SABE')),
  b4_trabajadores text CHECK (b4_trabajadores IN ('T_1','T_2_3','T_4_6','T_7_MAS')),
  b5_conoce_acuerdo text CHECK (b5_conoce_acuerdo IN ('ADHERIDA','CONOCE_NO_ADHERIDA','NO_CONOCE')),
  b6_motivos text[] CHECK (b6_motivos <@ ARRAY['PRECIO','BODEGA_LEJOS','CANTIDAD_MINIMA','PAGO_ADELANTADO','TRAMITE','USA_HARINA','OTRO']::text[]),
  b6_otro text CHECK (length(b6_otro) <= 100),
  b7_interes boolean,
  b8_apoyos text[] CHECK (b8_apoyos <@ ARRAY['JCF','CREDITO','OTRO','NINGUNO']::text[]),
  -- Bloque C
  c1_licencia text CHECK (c1_licencia IN ('SI_VISIBLE','SI_NO_MOSTRO','NO','NO_RESPONDE')),
  c2_imss text CHECK (c2_imss IN ('TODAS','ALGUNAS','NINGUNA','NO_RESPONDE')),
  c3_declaracion text CHECK (c3_declaracion IN ('SI','NO','NO_SABE','NO_RESPONDE')),
  geom_captura geometry(Point,4326),
  precision_gps real,
  capturado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  id_cliente uuid UNIQUE,
  -- "No se pudo aplicar" lleva motivo (y su texto si es OTRO); "aplicado" lleva las preguntas obligatorias
  CHECK (estatus <> 'no_aplicado' OR (motivo_no_aplica IS NOT NULL AND (motivo_no_aplica <> 'OTRO' OR length(trim(coalesce(motivo_no_aplica_otro,''))) BETWEEN 5 AND 100))),
  CHECK (estatus <> 'aplicado' OR (a1_ubicacion IS NOT NULL AND a2_limpieza IS NOT NULL AND a2_plagas IS NOT NULL AND a2_insumos IS NOT NULL
         AND a2_personal IS NOT NULL AND a2_basura IS NOT NULL AND b1_insumo IS NOT NULL AND b2_volumen IS NOT NULL AND b3_propiedad IS NOT NULL
         AND b4_trabajadores IS NOT NULL AND b5_conoce_acuerdo IS NOT NULL AND cardinality(b8_apoyos) >= 1
         AND c1_licencia IS NOT NULL AND c2_imss IS NOT NULL AND c3_declaracion IS NOT NULL)),
  -- condicionales: B6 solo si conoce y no está adherida; B7 solo si no está adherida
  CHECK ((b5_conoce_acuerdo = 'CONOCE_NO_ADHERIDA') = (cardinality(b6_motivos) >= 1) OR estatus = 'no_aplicado'),
  CHECK (b7_interes IS NULL OR b5_conoce_acuerdo IN ('NO_CONOCE','CONOCE_NO_ADHERIDA')),
  CHECK (NOT ('NINGUNO' = ANY(coalesce(b8_apoyos, '{}'))) OR cardinality(b8_apoyos) = 1)
);
CREATE INDEX IF NOT EXISTS cuestionarios_tortilleria_idx ON tortilleria_cuestionarios (tortilleria_id, (coalesce(capturado_en, creado_en)) DESC);
CREATE INDEX IF NOT EXISTS cuestionarios_capturista_idx ON tortilleria_cuestionarios (capturista_id);

-- Cuestionario vigente: el último APLICADO de cada tortillería (un "no se pudo aplicar" posterior no lo reemplaza)
CREATE OR REPLACE VIEW cuestionario_vigente AS
SELECT DISTINCT ON (tortilleria_id) *
  FROM tortilleria_cuestionarios
 WHERE estatus = 'aplicado'
 ORDER BY tortilleria_id, coalesce(capturado_en, creado_en) DESC, creado_en DESC;

-- Último intento de cualquier estatus (para saber si el último fue "no se pudo aplicar")
CREATE OR REPLACE VIEW cuestionario_ultimo AS
SELECT DISTINCT ON (tortilleria_id) id, tortilleria_id, capturista_id, estatus, motivo_no_aplica, motivo_no_aplica_otro, coalesce(capturado_en, creado_en) AS fecha
  FROM tortilleria_cuestionarios
 ORDER BY tortilleria_id, coalesce(capturado_en, creado_en) DESC, creado_en DESC;

COMMIT;
