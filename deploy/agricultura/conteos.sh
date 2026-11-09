#!/usr/bin/env bash
# Filas por tabla. Se corre en el servidor anterior y en el nuevo y se comparan los resultados:
#   ./conteos.sh > conteos_nuevo.txt   (y lo mismo en el anterior; luego: diff conteos_anterior.txt conteos_nuevo.txt)
set -euo pipefail
source /var/www/Tortillerias/deploy/agricultura/_comun.sh
for t in $(psql "$PSQL_URL" -Atc "select tablename from pg_tables where schemaname='public' and tablename <> 'spatial_ref_sys' order by 1"); do
  echo "$t: $(psql "$PSQL_URL" -Atc "select count(*) from \"$t\"")"
done
echo "tortillerias con ubicación: $(psql "$PSQL_URL" -Atc "select count(*) from tortillerias where geom is not null")"
