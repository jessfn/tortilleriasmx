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

  // Subida por usuarios registrados (con límite); la consulta exige sesión
  app.post<{ Params: { id: string } }>("/tortillerias/:id/fotos", { preHandler: app.autenticar, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) return reply.code(400).send({ error: "Id inválido" });
    const t = await pool.query("SELECT 1 FROM tortillerias WHERE id = $1", [req.params.id]);
    if (!t.rowCount) return reply.code(404).send({ error: "Tortillería no existe" });

    const archivo = await req.file();
    if (!archivo) return reply.code(400).send({ error: "Falta el archivo" });
    // El id del teléfono viaja como campo de texto del formulario (antes del archivo) o en la cabecera
    const idCliente = (req.headers["x-id-cliente"] as string | undefined) ?? (archivo.fields?.idCliente as { value?: string } | undefined)?.value;
    if (idCliente !== undefined && !uuid.safeParse(idCliente).success) return reply.code(400).send({ error: "idCliente inválido" });
    if (idCliente) {
      const ya = await pool.query("SELECT id FROM fotos WHERE id_cliente = $1", [idCliente]);
      if (ya.rowCount) {
        await archivo.file.resume();
        return reply.code(200).send({ id: ya.rows[0].id, existente: true });
      }
    }
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
      "INSERT INTO fotos(id, tortilleria_id, archivo, miniatura, capturista_id, id_cliente) VALUES ($1,$2,$3,$4,$5,$6)",
      [id, req.params.id, `${id}.jpg`, `${id}_min.jpg`, req.user.sub, idCliente ?? null],
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
