#!/usr/bin/env bash
# Despliegue en el servidor de la Secretaría. Orden fijo: primero Git (commit y push desde tu equipo), después esto:
#   ssh ... && cd /var/www/Tortillerias && ./deploy/agricultura/deploy.sh
set -euo pipefail
cd /var/www/Tortillerias
source deploy/agricultura/_comun.sh

PNPM="pnpm"; command -v pnpm >/dev/null || PNPM="npx --yes pnpm@9.12.0"
API_PUBLICA="https://apitortillerias.agricultura.gob.mx"

echo "== Etiqueta de la versión anterior (para volver atrás si hace falta)"
git tag -f "prod-$(date +%F_%H%M)-antes" HEAD >/dev/null

git pull --ff-only origin main
CI=true $PNPM install --frozen-lockfile --prod=false  # el .env trae NODE_ENV=production: sin esto pnpm omite TypeScript y la compilación falla

echo "== Compilación (la URL de la API se fija aquí, al compilar)"
VITE_API_URL="$API_PUBLICA" $PNPM build

echo "== Migraciones pendientes (con respaldo previo si hay alguna)"
psql "$PSQL_URL" -c "CREATE TABLE IF NOT EXISTS _migraciones (nombre text PRIMARY KEY, aplicada timestamptz DEFAULT now())"
pendientes=()
for f in db/migrations/*.sql; do
  n=$(basename "$f")
  [ "$(psql "$PSQL_URL" -tAc "SELECT 1 FROM _migraciones WHERE nombre='$n'")" = "1" ] || pendientes+=("$f")
done
if [ "${#pendientes[@]}" -gt 0 ]; then
  mkdir -p ~/respaldos
  pg_dump -Fc "$PSQL_URL" > ~/respaldos/tortillerias-antes-migracion-$(date +%F_%H%M).dump
  for f in "${pendientes[@]}"; do
    psql "$PSQL_URL" -v ON_ERROR_STOP=1 -f "$f"
    psql "$PSQL_URL" -c "INSERT INTO _migraciones(nombre) VALUES ('$(basename "$f")')"
  done
fi

mkdir -p "$(dirname "${UPLOADS_DIR:-$RAIZ/datos/fotos}")" "${UPLOADS_DIR:-$RAIZ/datos/fotos}"
pm2 startOrReload deploy/agricultura/ecosystem.config.cjs
pm2 save

echo "== Verificación (los dos puertos que usa el balanceador)"
sleep 3
curl -fsS "http://127.0.0.1:${PORT:-3006}/health" && echo
curl -fsS -o /dev/null -w "app en el 3007: %{http_code}\n" "http://127.0.0.1:3007/"
pm2 list | grep -E "tortillerias-(api|web)"
