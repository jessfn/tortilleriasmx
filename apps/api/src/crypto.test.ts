import { describe, it, expect, beforeAll } from "vitest";
import { cifrar, descifrar, hashBusqueda, enmascarar } from "./crypto.js";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "a".repeat(64);
});

describe("crypto", () => {
  it("cifra y descifra", () => {
    const c = cifrar("HEGG560427MVZRRL04");
    expect(c.toString("utf8")).not.toContain("HEGG");
    expect(descifrar(c)).toBe("HEGG560427MVZRRL04");
  });
  it("cada cifrado es distinto pero el hash es estable", () => {
    expect(cifrar("x").equals(cifrar("x"))).toBe(false);
    expect(hashBusqueda("x")).toBe(hashBusqueda("x"));
  });
  it("enmascara", () => expect(enmascarar("5512345678")).toBe("******5678"));
});
