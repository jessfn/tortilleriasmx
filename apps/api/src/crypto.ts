import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

function llave(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  const k = Buffer.from(hex, "hex");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY debe ser de 32 bytes en hex (64 caracteres)");
  return k;
}

/** AES-256-GCM: devuelve iv(12) + tag(16) + texto cifrado. */
export function cifrar(texto: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", llave(), iv);
  const enc = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

export function descifrar(b: Buffer): string {
  const d = createDecipheriv("aes-256-gcm", llave(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

/** Hash determinista (HMAC) para detectar duplicados sin descifrar. */
export function hashBusqueda(texto: string): string {
  return createHmac("sha256", llave()).update(texto).digest("hex");
}

export function enmascarar(texto: string, visibles = 4): string {
  return "*".repeat(Math.max(texto.length - visibles, 0)) + texto.slice(-visibles);
}
