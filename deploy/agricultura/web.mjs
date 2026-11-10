// Arranque del servidor de la PWA (lo usa PM2). WEB_PORT=3007 y WEB_DIR=apps/web/dist por defecto.
import { crearServidorWeb } from "./servidor-web.mjs";

const puerto = Number(process.env.WEB_PORT ?? 3007);
const dir = process.env.WEB_DIR ?? "/var/www/Tortillerias/apps/web/dist";
crearServidorWeb(dir).listen(puerto, process.env.WEB_HOST ?? "0.0.0.0", () => console.log(`PWA en el puerto ${puerto} (${dir})`));
