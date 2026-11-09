# Funciones comunes de los scripts de Tortillerías en el servidor de la Secretaría (se cargan con `source`)
RAIZ=/var/www/Tortillerias
set -a; . "$RAIZ/.env"; set +a
# El API (Node) usa sslmode=no-verify con el RDS; psql/pg_dump no conocen ese valor: aquí se usa require
export PSQL_URL="${DATABASE_URL/sslmode=no-verify/sslmode=require}"
