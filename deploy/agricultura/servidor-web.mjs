// Servidor mínimo de la PWA compilada (apps/web/dist), sin dependencias. En el servidor de la Secretaría el balanceador entrega
// el tráfico directo a un puerto de la aplicación (3007 para la app, 3006 para la API), sin nginx en medio; este archivo hace
// lo que hacía nginx: archivos estáticos, caché, compresión y la ruta de respaldo de la aplicación de una sola página.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".glb": "model/gltf-binary", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};
const COMPRIMIBLES = new Set([".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg", ".txt", ".map"]);
// La app se actualiza sola: estos archivos nunca deben quedar en caché
const SIN_CACHE = new Set(["/index.html", "/sw.js", "/manifest.webmanifest"]);

const SEGURIDAD = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export function crearServidorWeb(dir) {
  const raiz = path.resolve(dir);
  const comprimidos = new Map(); // archivo -> { firma, gzip, br }

  function comprimir(archivo, estado) {
    const firma = `${estado.mtimeMs}:${estado.size}`;
    let c = comprimidos.get(archivo);
    if (!c || c.firma !== firma) {
      const datos = fs.readFileSync(archivo);
      c = { firma, gzip: zlib.gzipSync(datos, { level: 9 }), br: zlib.brotliCompressSync(datos) };
      comprimidos.set(archivo, c);
    }
    return c;
  }

  return http.createServer((req, res) => {
    const responder = (codigo, cuerpo = "", extra = {}) => {
      res.writeHead(codigo, { ...SEGURIDAD, "content-type": "text/plain; charset=utf-8", ...extra });
      res.end(req.method === "HEAD" ? undefined : cuerpo);
    };
    if (req.method !== "GET" && req.method !== "HEAD") return responder(405, "Método no permitido", { allow: "GET, HEAD" });
    // El balanceador termina el HTTPS: si alguien llegó por HTTP, se manda al HTTPS (las revisiones de salud no traen este encabezado)
    if (req.headers["x-forwarded-proto"] === "http") return responder(301, "", { location: `https://${req.headers.host}${req.url}` });

    let ruta;
    try {
      ruta = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      return responder(400, "Solicitud inválida");
    }
    if (ruta.includes("\0")) return responder(400, "Solicitud inválida");
    if (ruta.endsWith("/")) ruta += "index.html";

    let archivo = path.join(raiz, ruta);
    if (archivo !== raiz && !archivo.startsWith(raiz + path.sep)) return responder(403, "Prohibido");
    let estado = null;
    try {
      estado = fs.statSync(archivo);
      if (estado.isDirectory()) estado = null;
    } catch {
      estado = null;
    }
    if (!estado) {
      // Una dirección de la aplicación (sin extensión, p. ej. /acceso) abre la app; un archivo que no existe es 404
      if (path.extname(ruta)) return responder(404, "No encontrado");
      archivo = path.join(raiz, "index.html");
      ruta = "/index.html";
      try {
        estado = fs.statSync(archivo);
      } catch {
        return responder(404, "No encontrado");
      }
    }

    const ext = path.extname(archivo).toLowerCase();
    const etag = `W/"${estado.size.toString(16)}-${Math.floor(estado.mtimeMs).toString(16)}"`;
    const cache = SIN_CACHE.has(ruta) ? "no-cache, no-store, must-revalidate" : ruta.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=2592000";
    const cabeceras = { ...SEGURIDAD, "content-type": MIME[ext] ?? "application/octet-stream", "cache-control": cache, etag };
    if (!SIN_CACHE.has(ruta) && req.headers["if-none-match"] === etag) {
      res.writeHead(304, cabeceras);
      return res.end();
    }

    const acepta = String(req.headers["accept-encoding"] ?? "");
    if (COMPRIMIBLES.has(ext) && estado.size >= 1024 && /\b(br|gzip)\b/.test(acepta)) {
      const c = comprimir(archivo, estado);
      const usaBr = /\bbr\b/.test(acepta);
      const datos = usaBr ? c.br : c.gzip;
      res.writeHead(200, { ...cabeceras, "content-encoding": usaBr ? "br" : "gzip", vary: "Accept-Encoding", "content-length": datos.length });
      return res.end(req.method === "HEAD" ? undefined : datos);
    }
    res.writeHead(200, { ...cabeceras, "content-length": estado.size });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(archivo).pipe(res);
  });
}
