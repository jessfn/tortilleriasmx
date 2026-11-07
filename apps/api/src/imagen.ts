import sharp from "sharp";

export const MAX_BYTES = 10 * 1024 * 1024;
const FORMATOS = new Set(["jpeg", "png", "webp"]);

export class ImagenInvalida extends Error {}

/**
 * Valida el tipo REAL del archivo (por su contenido, no por la extensión),
 * corrige la orientación, reduce a 1600 px, genera miniatura y elimina EXIF.
 */
export async function procesarImagen(buf: Buffer) {
  if (buf.length === 0 || buf.length > MAX_BYTES) throw new ImagenInvalida("Tamaño no permitido (máx. 10 MB)");
  let formato: string | undefined;
  try {
    formato = (await sharp(buf).metadata()).format;
  } catch {
    throw new ImagenInvalida("El archivo no es una imagen válida");
  }
  if (!formato || !FORMATOS.has(formato)) throw new ImagenInvalida("Formato no permitido (usa JPG, PNG o WebP)");

  // rotate() aplica la orientación EXIF; sharp no copia metadatos al exportar
  const base = sharp(buf, { limitInputPixels: 50_000_000 }).rotate();
  const grande = await base.clone().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const miniatura = await base.clone().resize(320, 320, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
  return { grande, miniatura };
}
