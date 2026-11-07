#!/usr/bin/env bash
# Uso en el VPS: cd /var/www/tortilleriasmx && ./deploy/deploy.sh
set -euo pipefail
cd /var/www/tortilleriasmx
set -a; . ./.env; set +a
git pull origin main
pnpm install --frozen-lockfile
pnpm build
# Las migraciones se aplican una sola vez (tabla de control)
psql "$DATABASE_URL" -c "CREATE TABLE IF NOT EXISTS _migraciones (nombre text PRIMARY KEY, aplicada timestamptz DEFAULT now())"
for f in db/migrations/*.sql; do
  n=$(basename "$f")
  if [ "$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM _migraciones WHERE nombre='$n'")" != "1" ]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
    psql "$DATABASE_URL" -c "INSERT INTO _migraciones(nombre) VALUES ('$n')"
  fi
done
pm2 startOrReload deploy/ecosystem.config.cjs
# Publicar la PWA (Nginx sirve esta carpeta)
mkdir -p /var/www/tortilleriasmx-web
cp -r apps/web/dist/. /var/www/tortilleriasmx-web/
