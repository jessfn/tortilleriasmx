#!/usr/bin/env bash
# Instalación única en el VPS (Ubuntu/Debian). Ejecutar como root:
#   DB_PASSWORD='...' CERTBOT_EMAIL='tu@correo' bash setup-vps.sh
# Los secretos llegan por variables de entorno; nada se guarda en Git.
set -euo pipefail
: "${DB_PASSWORD:?Falta DB_PASSWORD}"
: "${CERTBOT_EMAIL:?Falta CERTBOT_EMAIL}"
DB_USER="${DB_USER:-jesus}"
DB_NAME="${DB_NAME:-tortilleriasmx}"
APP_DOMAIN="tortilleriasmx.geodatos.com.mx"
API_DOMAIN="apitortillerias.geodatos.com.mx"
APP_DIR=/var/www/tortilleriasmx

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ufw nginx certbot python3-certbot-nginx postgresql postgis
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
npm install -g pnpm@9.12.0 pm2

# Firewall
ufw allow 22/tcp; ufw allow 80/tcp; ufw allow 443/tcp; ufw --force enable

# Base de datos (solo localhost)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}'"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 \
  || sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
sudo -u postgres psql -d "${DB_NAME}" -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# Código
mkdir -p /var/www && cd /var/www
[ -d "$APP_DIR/.git" ] || git clone https://github.com/jessfn/tortilleriasmx.git
cd "$APP_DIR"

# .env (solo se crea si no existe)
if [ ! -f .env ]; then
  umask 077
  cat > .env <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}
ENCRYPTION_KEY=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
CORS_ORIGIN=https://${APP_DOMAIN}
PORT=3001
EOF
fi

# Nginx
cp deploy/nginx-api.conf  /etc/nginx/sites-available/${API_DOMAIN}
cp deploy/nginx-app.conf  /etc/nginx/sites-available/${APP_DOMAIN}
mkdir -p /var/www/tortilleriasmx-web
ln -sf /etc/nginx/sites-available/${API_DOMAIN} /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/${APP_DOMAIN} /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# HTTPS (requiere que el DNS ya apunte a este servidor)
certbot --nginx --non-interactive --agree-tos --redirect -m "$CERTBOT_EMAIL" \
  -d "$API_DOMAIN" -d "$APP_DOMAIN"

# Primer despliegue y arranque automático
chmod +x deploy/deploy.sh && ./deploy/deploy.sh
pm2 save && pm2 startup systemd -u root --hp /root | tail -1 | bash || true
echo "Listo: https://${API_DOMAIN}/health"
