import { describe, it, expect } from "vitest";
import { CLAVES_PERMISOS, PERMISOS, PERMISOS_SUPERVISOR_POR_OMISION, permisosEfectivos, personalNuevoSchema, tienePermiso } from "./permisos.js";

describe("permisos del personal del administrador", () => {
  it("un usuario de la app no tiene ningún permiso del administrador", () => {
    expect(permisosEfectivos("capturista")).toEqual([]);
    expect(permisosEfectivos("capturista", ["ver_resumen"])).toEqual([]);
  });

  it("un administrador puede todo, marque lo que marque", () => {
    expect(permisosEfectivos("admin")).toEqual([...CLAVES_PERMISOS]);
    expect(permisosEfectivos("admin", ["ver_resumen"])).toHaveLength(PERMISOS.length);
  });

  it("un supervisor sin permisos editados conserva lo de siempre (sin gestionar usuarios de la app)", () => {
    const p = permisosEfectivos("supervisor", null);
    expect(p).toEqual([...PERMISOS_SUPERVISOR_POR_OMISION]);
    expect(p).toContain("revisar_precios");
    expect(p).not.toContain("gestionar_usuarios_app");
    expect(p).not.toContain("ver_usuarios_app");
  });

  it("un supervisor tiene solo lo marcado; lo desconocido se ignora", () => {
    expect(permisosEfectivos("supervisor", ["ver_mapa", "inventado", "exportar_capturas"])).toEqual(["ver_mapa", "exportar_capturas"]);
    expect(tienePermiso("supervisor", ["ver_mapa"], "ver_mapa")).toBe(true);
    expect(tienePermiso("supervisor", ["ver_mapa"], "ver_resumen")).toBe(false);
    expect(permisosEfectivos("supervisor", [])).toEqual([]);
  });

  it("cada permiso es una vista o una acción, con texto y ayuda", () => {
    for (const p of PERMISOS) {
      expect(["vista", "accion"]).toContain(p.tipo);
      expect(p.texto.length).toBeGreaterThan(3);
      expect(p.ayuda.length).toBeGreaterThan(3);
    }
    expect(new Set(CLAVES_PERMISOS).size).toBe(PERMISOS.length);
  });

  it("el alta de personal valida correo, nombre, apellidos y rol (el correo se normaliza)", () => {
    const ok = personalNuevoSchema.safeParse({ correo: " Ana.Perez@SADER.gob.mx ", nombre: "Ana", apellidos: "Pérez", rol: "supervisor", permisos: ["ver_resumen"] });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.correo).toBe("ana.perez@sader.gob.mx");
    expect(personalNuevoSchema.safeParse({ correo: "no-es-correo", nombre: "Ana", apellidos: "Pérez", rol: "admin" }).success).toBe(false);
    expect(personalNuevoSchema.safeParse({ correo: "a@b.mx", nombre: "A", apellidos: "Pérez", rol: "admin" }).success).toBe(false);
    expect(personalNuevoSchema.safeParse({ correo: "a@b.mx", nombre: "Ana", apellidos: "Pérez", rol: "capturista" }).success).toBe(false); // los de la app no se crean aquí
  });
});
