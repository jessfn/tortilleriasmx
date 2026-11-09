#!/usr/bin/env bash
# Restaura un respaldo (formato -Fc de pg_dump) en la base nueva del RDS.
#   ./restaurar.sh /ruta/tortillerias_AAAAMMDD.dump
# Requisitos: la base ya existe, las extensiones postgis y pgcrypto ya las creó infraestructura (el usuario de la app no puede crearlas)
# y la base está vacía. Se omiten las extensiones y spatial_ref_sys (ya vienen con PostGIS) y los dueños/permisos del servidor anterior.
set -euo pipefail
source /var/www/Tortillerias/deploy/agricultura/_comun.sh
DUMP="${1:?Uso: ./restaurar.sh archivo.dump}"
[ -f "$DUMP" ] || { echo "No existe $DUMP"; exit 1; }

for ext in postgis pgcrypto; do
  [ "$(psql "$PSQL_URL" -Atc "select 1 from pg_extension where extname='$ext'")" = "1" ] || { echo "FALTA la extensión $ext: pídele a infraestructura que la cree en esta base (CREATE EXTENSION $ext;)"; exit 1; }
done
if [ "$(psql "$PSQL_URL" -Atc "select count(*) from pg_tables where schemaname='public' and tablename <> 'spatial_ref_sys'")" != "0" ]; then
  echo "La base no está vacía: no se restaura encima de datos existentes."; exit 1
fi

LISTA=$(mktemp)
pg_restore -l "$DUMP" | grep -vE " EXTENSION | COMMENT - EXTENSION|spatial_ref_sys" > "$LISTA"
pg_restore --no-owner --no-privileges -L "$LISTA" -d "$PSQL_URL" "$DUMP"
rm -f "$LISTA"
echo "Restauración terminada. Compara con: ./deploy/agricultura/conteos.sh (en el servidor anterior y en este)."
