/** Reduce la foto en el dispositivo (máx. 1600 px, JPEG) antes de enviarla. */
export async function comprimirFoto(archivo: File): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(archivo, { imageOrientation: "from-image" });
  } catch {
    throw new Error("No se pudo leer la foto. Usa una imagen JPG o PNG.");
  }
  const escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.round(bmp.width * escala);
  lienzo.height = Math.round(bmp.height * escala);
  lienzo.getContext("2d")!.drawImage(bmp, 0, 0, lienzo.width, lienzo.height);
  bmp.close();
  return new Promise((ok, fallo) =>
    lienzo.toBlob((b) => (b ? ok(b) : fallo(new Error("No se pudo procesar la foto"))), "image/jpeg", 0.8),
  );
}
