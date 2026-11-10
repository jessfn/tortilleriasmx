# Migración de TortilleríasMX al servidor de la Secretaría

Origen: VPS de Hostinger (`2.25.213.218`). Destino: el EC2 de SIMAC (`simprdwbsza01`) con base de datos en el RDS de la Secretaría.

| | Origen | Destino |
|---|---|---|
| App (PWA) | `https://tortilleriasmx.geodatos.com.mx` | `https://tortilleriasmx.agricultura.gob.mx` |
| API | `https://apitortillerias.geodatos.com.mx` | `https://apitortillerias.agricultura.gob.mx` |
| Base de datos | PostgreSQL 14 + PostGIS 3.2 local | PostgreSQL 14 en RDS (base nueva `tortillerias`) |
| Puerto de la API | 3001 | **3006** (el 3007 queda reservado) |
| Carpeta | `/var/www/tortilleriasmx` | `/var/www/Tortillerias` |

Esta guía sigue la de infraestructura (`MIGRACION_TORTILLERIAS.md`) y la adapta a este proyecto. Los archivos listos para usar están en [`deploy/agricultura/`](../deploy/agricultura).

---

## 1. Estado

| Paso | Estado | Quién |
|---|---|---|
| Inventario del servidor actual | Hecho (sección 2) | — |
| Respaldo de la base y de las fotos, **con prueba de restauración** | Hecho el 9-nov-2026 (sección 4) | — |
| Código listo para los dominios nuevos (CORS con varios orígenes, proxies de confianza) | Hecho y probado (80 pruebas de la API) | — |
| Scripts y nginx para el servidor nuevo | Hechos, **sin probar en el servidor de la Secretaría** | — |
| Ticket a infraestructura (DNS, balanceador, RDS con PostGIS, permiso) | Pendiente: sección 3 | Tú |
| Todo lo que ocurre en el servidor nuevo (secciones 5 a 8) | Pendiente: requiere VPN, bastión y la llave de acceso | Tú |

---

## 2. Inventario (lo que la guía pedía llenar)

| # | Dato | Valor |
|---|---|---|
| 1 | Repositorio y rama | `https://github.com/jessfn/tortilleriasmx.git`, rama `main` |
| 2 | Frontend | React 18 + Vite 5 + PWA (Workbox), TypeScript. Compilación: `pnpm build` → `apps/web/dist` (estático, lo sirve nginx) |
| 3 | Backend | Node 20 + Fastify + TypeScript. Compilación: `pnpm build` → arranque `node apps/api/dist/server.js` |
| 4 | Base de datos | PostgreSQL 14.24 + **PostGIS 3.2** + pgcrypto. **92 MB**, 13 tablas propias + `spatial_ref_sys` de PostGIS (112,074 tortillerías, 112,072 del catálogo DENUE, 7 usuarios, 9 capturas, 4 fotos). Todas con llave primaria |
| 5 | Archivos subidos | Fotos de tortillerías nuevas: 8 archivos, 692 KB, en `/var/www/tortilleriasmx-data/fotos`. **Son privadas:** solo las entrega la API con sesión |
| 6 | Variables de entorno | `DATABASE_URL`, `ENCRYPTION_KEY`, `JWT_SECRET`, `CORS_ORIGIN`, `PORT`, `UPLOADS_DIR` (+ `TRUST_PROXY` nuevo). Ver [`env.example`](../deploy/agricultura/env.example) |
| 7 | Correo saliente | No hay |
| 8 | Tareas programadas | Ninguna de Tortillerías |
| 9 | Servicios externos | Mapa base de OpenFreeMap (`tiles.openfreemap.org`) y búsqueda de lugares desde el navegador del usuario; ninguno con lista de IP permitidas. Fuente Patria desde el CDN de gob.mx |
| 10 | Usuarios | Pocos (7 cuentas): cualquier horario sirve; ver la sección 7 por las capturas guardadas en teléfonos |
| 11 | Dominio actual | `geodatos.com.mx`, DNS administrado por ti |

---

## 3. Qué pedir a infraestructura (un solo ticket, el primer día)

> **Asunto:** Alta de TortilleríasMX en el servidor de SIMAC
>
> 1. **DNS** (`agricultura.gob.mx`): crear `tortilleriasmx` y `apitortillerias` apuntando al mismo balanceador que `maiz` y `apimaiz`. Que el balanceador envíe ambos nombres al EC2 `simprdwbsza01`, puerto 80.
> 2. **Balanceador:** nginx del EC2 ya atiende ambos nombres en el puerto 80 y en el 443 (HTTPS con el certificado comodín). Pido confirmar la regla del balanceador que lleva `tortilleriasmx` y `apitortillerias` a `simprdwbsza01` y que el destino aparezca saludable.
> 3. **RDS PostgreSQL 14:** crear la base `tortillerias` y un usuario propio con permisos solo sobre ella. **En esa base hay que crear las extensiones `postgis` y `pgcrypto`** (`CREATE EXTENSION postgis; CREATE EXTENSION pgcrypto;`): el sistema guarda ubicaciones con PostGIS y el usuario de la aplicación no tiene privilegios para crearlas. Permitir la conexión desde el EC2 y activar respaldos automáticos. Indicar si la conexión exige SSL y entregar el certificado raíz si lo hay.
> 4. **Autorización** para agregar un segundo proyecto en el EC2: carpeta `/var/www/Tortillerias`, proceso PM2 `tortillerias-api` en el puerto 3006, y los dos bloques de nginx (`deploy/agricultura/nginx-tortillerias.conf`).
> 5. **Salida a internet** del EC2 para el `git pull` desde GitHub.

---

## 4. Respaldo (hecho) y cómo volver a hacerlo

El 9-nov-2026 se generó en el VPS actual, en `/root/respaldos-migracion/` (carpeta privada, solo root):

| Archivo | Tamaño | SHA-256 |
|---|---|---|
| `tortillerias_20261109_2011.dump` | 14 MB | `f4ced7ca1e9c8527e743b1202ae43ccc215cdd47ac9b4f04112f9d683e121395` |
| `fotos_20261109_2011.tar.gz` | 655 KB | `c14702a9d9b83a8cb198654021e57896ca81c3ededd0ba30e688c4873ce63601` |

**Se probó restaurarlo** en una base temporal, con el mismo procedimiento que se usará en el RDS (extensiones ya creadas, restauración sin dueños ni permisos, sin `spatial_ref_sys`): las 13 tablas tuvieron exactamente las mismas filas que el origen, PostGIS funcionó y las 15 llaves foráneas coincidieron. La base temporal se eliminó.

Ese respaldo es de práctica. **El definitivo se hace el día del cambio** (sección 7), con el sitio en solo lectura:

```bash
ssh -i ~/.ssh/id_ed25519_tortillerias root@2.25.213.218
cd /var/www/tortilleriasmx && set -a && . ./.env && set +a
pg_dump -Fc "$DATABASE_URL" > /root/respaldos-migracion/tortillerias_FINAL.dump
tar czf /root/respaldos-migracion/fotos_FINAL.tar.gz -C /var/www/tortilleriasmx-data fotos
sha256sum /root/respaldos-migracion/*FINAL*
```

Los respaldos contienen datos personales (RFC y celulares van cifrados, pero hay correos y nombres): guárdalos solo en carpetas privadas y **nunca en Git**. Para traerlos a tu equipo: `scp -i ~/.ssh/id_ed25519_tortillerias root@2.25.213.218:/root/respaldos-migracion/ARCHIVO .`

---

## 5. Lo que cambia respecto a la guía genérica (leer antes de empezar)

1. **`ENCRYPTION_KEY` se copia, no se genera.** Con ella se cifran el RFC y el celular de las tortillerías y se buscan por hash. Si en el servidor nuevo es otra, esos datos ya guardados **no se pueden leer**. `JWT_SECRET` sí se genera nuevo (todos tendrán que iniciar sesión otra vez). Cópiala directo del `.env` anterior, sin pegarla en chats ni en Git.
2. **PostGIS es obligatorio** en el RDS (sección 3, punto 2). Sin él la API no arranca.
3. **No hay `/uploads` en nginx.** La guía genérica lo sirve como carpeta pública; aquí las fotos son privadas y las entrega `GET /fotos/:id` con sesión. Publicar la carpeta expondría fotos de negocios sin control de acceso.
4. **No hay prefijo `/api`:** las rutas son `/auth/login`, `/tortillerias/…`. Por eso la zona estricta de nginx es `^/auth/(login|registro)`, y `VITE_API_URL` es la dirección sin `/api`.
5. **Proyecto pnpm (monorepo),** no `npm` con carpetas `frontend` y `backend`. El `.env` va en la raíz (`/var/www/Tortillerias/.env`), y nginx sirve `apps/web/dist` directo.
6. **Proxies de confianza (`TRUST_PROXY=2`).** Detrás del balanceador y de nginx, la API necesita saber cuántos proxies hay para contar el límite de peticiones y de intentos de inicio de sesión por cliente real. Sin esto todos los usuarios comparten el mismo cupo.
7. **Conexión al RDS:** en `DATABASE_URL` se usa `?sslmode=no-verify` para la API (Node no conoce la CA del RDS). Los scripts convierten eso a `sslmode=require` para `psql`/`pg_dump`.
8. **GitHub Actions.** El workflow `deploy.yml` entra al VPS de Hostinger. El servidor nuevo está detrás de VPN y bastión, así que **no se puede desplegar desde GitHub**: se hace por SSH con `deploy/agricultura/deploy.sh`. Después del cambio hay que desactivar ese workflow.
9. **nginx atiende 80 y 443.** Sin un bloque propio en el 443, un nombre nuevo cae en el servidor por defecto de SIMAC y se ve la aplicación equivocada. Los dos bloques de `nginx-tortillerias.conf` escuchan en ambos puertos con el certificado comodín.
10. **La dirección de la app cambia de origen** y eso afecta los teléfonos (ver sección 7).

---

## 6. Servidor nuevo, paso a paso

Conexión: la de la sección 4.1 de la guía de infraestructura (VPN → bastión → túnel al puerto 2223).

```bash
# 1) Carpeta y código
sudo mkdir -p /var/www/Tortillerias && sudo chown jesus.rios:jesus.rios /var/www/Tortillerias
cd /var/www/Tortillerias
git clone https://github.com/jessfn/tortilleriasmx.git .        # privado: llave de despliegue o token de solo lectura

# 2) Variables de entorno (valores capturados aquí, nunca en Git)
cp deploy/agricultura/env.example .env && chmod 600 .env && nano .env

# 3) Base: ~/.pgpass (600) con la clave del usuario del RDS; luego, con las extensiones ya creadas por infraestructura:
./deploy/agricultura/restaurar.sh /ruta/tortillerias_FINAL.dump
./deploy/agricultura/conteos.sh > conteos_nuevo.txt             # compáralo con el del servidor anterior

# 4) Fotos
mkdir -p datos/fotos && tar xzf /ruta/fotos_FINAL.tar.gz -C datos/ && ls datos/fotos | wc -l

# 5) Compilar, migraciones y PM2 (primera vez y todas las siguientes)
./deploy/agricultura/deploy.sh

# 6) nginx
sudo cp deploy/agricultura/nginx-tortillerias.conf /etc/nginx/sites-available/tortillerias
sudo ln -s /etc/nginx/sites-available/tortillerias /etc/nginx/sites-enabled/tortillerias
sudo nginx -t && sudo nginx -s reload                            # si nginx -t falla, NO recargues
```

Node 20.20.2 ya está instalado. Si `pnpm` no existe, `deploy.sh` usa `npx pnpm@9.12.0` y no hace falta instalar nada global.

Cuando el sistema esté estable, programa el respaldo propio: `crontab -e` → `30 2 * * * /var/www/Tortillerias/deploy/agricultura/respaldo.sh >> ~/respaldos/respaldo.log 2>&1`.

---

## 7. Pruebas antes de cambiar el DNS y día del cambio

**Pruebas (con el DNS aún sin cambiar):**

```bash
curl -s http://127.0.0.1:3006/health                                   # {"ok":true}
curl -s -H "Host: apitortillerias.agricultura.gob.mx" -H "X-Forwarded-Proto: https" http://127.0.0.1/health
curl -s -H "Host: apitortillerias.agricultura.gob.mx" -H "X-Forwarded-Proto: https" http://127.0.0.1/estados | head -c 200
curl -s -H "Host: tortilleriasmx.agricultura.gob.mx" -H "X-Forwarded-Proto: https" http://127.0.0.1/ | head -c 300   # el index.html
pm2 logs tortillerias-api --lines 100       # sin errores
```

Desde tu equipo (archivo `hosts` o con el DNS ya publicado): entra, inicia sesión con cada rol (administración en `/acceso`, censador en la raíz), mira el mapa, captura un precio y compara las cifras del resumen con las del servidor anterior.

**Capturas guardadas en los teléfonos.** La app guarda lo que se captura sin señal en el navegador **del dominio anterior**. Al cambiar de dominio, esas capturas no se ven desde el dominio nuevo. Por eso:

1. **Días antes:** pide a los censadores abrir la app con señal y verificar que la tarjeta diga "Todo enviado ✓".
2. **Después del cambio:** el dominio anterior de la API se queda funcionando y reenvía a la API nueva (`deploy/agricultura/proxy-dominio-anterior.conf` en el servidor viejo), y la API nueva acepta el origen anterior (`CORS_ORIGIN` con los dos dominios). Así los teléfonos que aún tengan pendientes los envían. Las capturas aceptan hasta 7 días de antigüedad.
3. Mantén el frontend anterior 2 a 4 semanas; luego redirígelo al nuevo.

**Día del cambio:**

1. Un día antes baja el TTL del DNS de `geodatos.com.mx` a 300 s.
2. Ventana de bajo uso; avisa. Pon el servidor anterior en solo lectura o mantenimiento (por ejemplo `pm2 stop tortillerias-api`).
3. Respaldo final (sección 4), restauración en el RDS y comparación de `conteos.sh` en ambos lados.
4. Repite las pruebas rápidas.
5. Confirma con infraestructura que el DNS nuevo ya apunta al balanceador. Instala `proxy-dominio-anterior.conf` en el servidor anterior.
6. Primera hora: `pm2 logs tortillerias-api`, `sudo tail -f /var/log/nginx/error.log`, un inicio de sesión real de cada rol.
7. **No canceles Hostinger.** Déjalo 2 a 4 semanas.

---

## 8. Plan de reversa

Hostinger sigue intacto. Si algo falla: apunta el DNS/proxy de vuelta al servidor anterior y arranca su API (`pm2 start tortillerias-api`). Si ya entraron capturas en el servidor nuevo, expórtalas antes de volver (`pg_dump -Fc` de las tablas `capturas_precio`, `tortillerias`, `fotos`, `tortilleria_fiscal`, `usuarios`) para no perderlas.

---

## 9. Después de migrar

- Respaldo automático del RDS confirmado con infraestructura + `respaldo.sh` en cron (sección 6).
- Desactivar el workflow `.github/workflows/deploy.yml` y, cuando ya no se use el dominio anterior, cambiar la dirección por defecto de la API en `apps/web/src/api.ts` a la nueva (el servidor nuevo ya la fija al compilar con `VITE_API_URL`).
- Quitar el dominio anterior de `CORS_ORIGIN` cuando ya no se use.
- **Rotar la contraseña de root del VPS anterior** (estuvo escrita en un archivo de contexto) y dar de baja la llave `deploy-tortillerias` cuando se apague.
- Antes de cada migración de base: respaldo (`deploy.sh` lo hace solo si hay migraciones pendientes) y etiqueta de Git (también automática).

---

## 10. Lista de verificación

- [ ] Ticket a infraestructura enviado (DNS, balanceador, **RDS con PostGIS y pgcrypto**, autorización, salida a internet)
- [ ] Censadores avisados para enviar sus capturas pendientes
- [ ] Respaldo final hecho y su SHA-256 anotado
- [ ] Base restaurada en el RDS y `conteos.sh` idéntico al del servidor anterior
- [ ] `.env` con `ENCRYPTION_KEY` **igual** a la anterior, `JWT_SECRET` nuevo, `PORT=3006`, `TRUST_PROXY=2`, permiso 600
- [ ] Fotos restauradas (8 archivos) y fuera de nginx
- [ ] `deploy.sh` terminó; `tortillerias-api` en `online`; `/health` responde
- [ ] nginx: `nginx -t` correcto, dos bloques activos
- [ ] Datos fiscales de una tortillería visibles desde administración (confirma que la llave de cifrado es la correcta)
- [ ] Inicio de sesión de cada rol, mapa, captura y foto probados
- [ ] DNS publicado; proxy del dominio anterior instalado
- [ ] Monitoreo de la primera hora
- [ ] Workflow de GitHub desactivado; Hostinger conservado 2 a 4 semanas
