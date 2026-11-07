import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { procesarImagen, ImagenInvalida } from "./imagen.js";

const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#9D2449" } }).png().toBuffer();

describe("procesarImagen", () => {
  it("reduce a 1600 px, crea miniatura y entrega JPEG", async () => {
    const r = await procesarImagen(await png(3000, 2000));
    const g = await sharp(r.grande).metadata();
    const m = await sharp(r.miniatura).metadata();
    expect(g.format).toBe("jpeg");
    expect(Math.max(g.width!, g.height!)).toBe(1600);
    expect(Math.max(m.width!, m.height!)).toBe(320);
    expect(g.exif).toBeUndefined();
  });
  it("no agranda imágenes pequeñas", async () => {
    const g = await sharp((await procesarImagen(await png(400, 300))).grande).metadata();
    expect(g.width).toBe(400);
  });
  it("rechaza archivos que no son imagen aunque se llamen .jpg", async () => {
    await expect(procesarImagen(Buffer.from("<script>alert(1)</script>"))).rejects.toBeInstanceOf(ImagenInvalida);
  });
  it("rechaza formatos no permitidos (GIF)", async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
    await expect(procesarImagen(gif)).rejects.toBeInstanceOf(ImagenInvalida);
  });
});
