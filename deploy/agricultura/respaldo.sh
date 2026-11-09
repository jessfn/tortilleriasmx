#!/usr/bin/env bash
# Respaldo propio de Tortillerías (además del automático del RDS). Programar en cron, por ejemplo cada noche:
#   30 2 * * *  /var/www/Tortillerias/deploy/agricultura/respaldo.sh >> ~/respaldos/respaldo.log 2>&1
# Guarda 14 días en ~/respaldos. Conviene copiar el último archivo fuera del servidor cada semana.
set -euo pipefail
source /var/www/Tortillerias/deploy/agricultura/_comun.sh
D=~/respaldos; mkdir -p "$D"; chmod 700 "$D"
F=$(date +%F)
pg_dump -Fc "$PSQL_URL" > "$D/tortillerias-$F.dump"
tar czf "$D/fotos-$F.tar.gz" -C "$(dirname "${UPLOADS_DIR:-$RAIZ/datos/fotos}")" "$(basename "${UPLOADS_DIR:-$RAIZ/datos/fotos}")"
find "$D" -name 'tortillerias-*.dump' -mtime +14 -delete
find "$D" -name 'fotos-*.tar.gz' -mtime +14 -delete
ls -lh "$D/tortillerias-$F.dump" "$D/fotos-$F.tar.gz"
