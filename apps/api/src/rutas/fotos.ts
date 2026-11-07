import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { auditar, pool } from "../db.js";
import { ImagenInvalida, MAX_BYTES, procesarImagen } from "../imagen.js";

const carpeta = () => process.env.UPLOADS_DIR ?? "/var/www/tortilleriasmx-data/fotos";
const uuid = z.string().uuid();

export async function rutasFotos(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } });

  app.post<{ Params: { id: string } }>("/tortillerias/:id/fotos", { preHandler: app.autenticar }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const t = await pool.query("SELECT 1 FROM tortillerias WHERE id = $1", [req.params.id]);
    if (!t.rowCount) return reply.code(404).send({ error: "Tortillería no existe" });

    const archivo = await req.file();
    if (!archivo) return reply.code(400).send({ error: "Falta el archivo" });
    let buf: Buffer;
    try {
      buf = await archivo.toBuffer(); // lanza si excede el límite
    } catch {
      return reply.code(413).send({ error: "Archivo demasiado grande (máx. 10 MB)" });
    }

    let img;
    try {
      img = await procesarImagen(buf);
    } catch (e) {
      if (e instanceof ImagenInvalida) return reply.code(415).send({ error: e.message });
      throw e;
    }

    // Nombres generados por el servidor: nunca se usa el nombre que manda el cliente
    const id = randomUUID();
    await mkdir(carpeta(), { recursive: true });
    await writeFile(path.join(carpeta(), `${id}.jpg`), img.grande);
    await writeFile(path.join(carpeta(), `${id}_min.jpg`), img.miniatura);

    await pool.query(
      "INSERT INTO fotos(id, tortilleria_id, archivo, miniatura, capturista_id) VALUES ($1,$2,$3,$4,$5)",
      [id, req.params.id, `${id}.jpg`, `${id}_min.jpg`, req.user.sub],
    );
    await pool.query("UPDATE tortillerias SET foto_principal = $1 WHERE id = $2 AND foto_principal IS NULL", [`${id}.jpg`, req.params.id]);
    await auditar(req.user.sub, "subir_foto", "fotos", id);
    return reply.code(201).send({ id });
  });

  // Acceso controlado: solo usuarios con sesión
  app.get<{ Params: { id: string }; Querystring: { tipo?: string } }>("/fotos/:id", { preHandler: app.autenticar }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const { rows } = await pool.query("SELECT archivo, miniatura FROM fotos WHERE id = $1", [req.params.id]);
    if (!rows[0]) return reply.code(404).send({ error: "No existe" });
    const nombre = req.query.tipo === "miniatura" ? rows[0].miniatura : rows[0].archivo;
    const datos = await readFile(path.join(carpeta(), path.basename(nombre)));
    return reply.header("content-type", "image/jpeg").header("cache-control", "private, max-age=86400").send(datos);
  });
}
