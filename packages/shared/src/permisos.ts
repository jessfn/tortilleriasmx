import { z } from "zod";

/**
 * Permisos del personal del administrador. Los usuarios de la app (PWA) son aparte y nunca entran al administrador.
 *  - "vista": qué pantallas ve.   - "accion": qué puede hacer.
 * Un administrador (rol "admin") puede todo, incluida la gestión del personal y la bitácora de auditoría, que NO se delegan.
 * Un supervisor (rol "supervisor") tiene los permisos que el administrador le marque.
 */
export const PERMISOS = [
  { clave: "ver_resumen", tipo: "vista", texto: "Resumen", ayuda: "Promedios, actividad reciente y tendencia" },
  { clave: "ver_mapa", tipo: "vista", texto: "Mapa", ayuda: "Mapa de precios con el detalle de cada tortillería" },
  { clave: "ver_estadisticas", tipo: "vista", texto: "Estadísticas", ayuda: "Por estado y municipio, y tortillerías sin datos fiscales" },
  { clave: "ver_revision", tipo: "vista", texto: "Revisión", ayuda: "Tortillerías nuevas y precios atípicos por revisar" },
  { clave: "ver_usuarios_app", tipo: "vista", texto: "Usuarios de la app", ayuda: "La lista de quienes capturan precios en la app" },
  { clave: "ver_mi_equipo", tipo: "vista", texto: "Mi equipo", ayuda: "Los censadores de un estado: capturas, última captura y avance (solo lectura)" },
  { clave: "ver_extras", tipo: "vista", texto: "Extras (reportes)", ayuda: "Descargar reportes en PDF y Excel por día, semana, mes o año" },
  { clave: "ver_cuestionarios", tipo: "vista", texto: "Cuestionarios", ayuda: "Respuestas del cuestionario de supervisión, avance e indicadores, y su descarga (información sensible)" },
  { clave: "gestionar_bajas", tipo: "accion", texto: "Ver y reactivar tortillerías dadas de baja", ayuda: "Las que los censadores reportaron como \"ya no funciona\"" },
  { clave: "revisar_precios", tipo: "accion", texto: "Aprobar o rechazar precios atípicos", ayuda: "Uno por uno o varios a la vez" },
  { clave: "validar_tortillerias", tipo: "accion", texto: "Validar o rechazar tortillerías nuevas", ayuda: "Las dadas de alta por los censadores" },
  { clave: "ver_datos_fiscales", tipo: "accion", texto: "Ver RFC y celular completos", ayuda: "Sin este permiso se ven enmascarados" },
  { clave: "exportar_capturas", tipo: "accion", texto: "Descargar la base de capturas (CSV)", ayuda: "Sin datos personales de las tortillerías" },
  { clave: "gestionar_usuarios_app", tipo: "accion", texto: "Gestionar usuarios de la app", ayuda: "Activar o desactivar cuentas y restablecer contraseñas" },
] as const;

export type Permiso = (typeof PERMISOS)[number]["clave"];
export const CLAVES_PERMISOS = PERMISOS.map((p) => p.clave) as readonly Permiso[];
export const esPermiso = (c: string): c is Permiso => (CLAVES_PERMISOS as readonly string[]).includes(c);

/**
 * Permisos reservados (C21): NADIE los tiene por su rol, ni siquiera un administrador. Solo los tiene la cuenta a la que se le marcan
 * a mano (por ahora, una sola cuenta de DGTIC). Nunca son de un administrador estatal.
 */
export const PERMISOS_RESERVADOS: readonly Permiso[] = ["ver_cuestionarios"];
export const esReservado = (c: string) => (PERMISOS_RESERVADOS as readonly string[]).includes(c);

/** Lo que tiene un supervisor al que nunca se le han editado los permisos: todo lo de siempre, sin la gestión de usuarios de la app ni los reportes (Extras), que el administrador delega */
export const PERMISOS_SUPERVISOR_POR_OMISION: readonly Permiso[] = CLAVES_PERMISOS.filter((c) => c !== "ver_usuarios_app" && c !== "gestionar_usuarios_app" && c !== "ver_extras" && !esReservado(c));

export type RolUsuario = "capturista" | "supervisor" | "admin" | "estatal";

/**
 * Administrador estatal (OREF y Fertilizantes: exactamente los mismos permisos, que NO se editan): ver y gestionar los usuarios de la app de su estado,
 * revisar tortillerías nuevas y precios atípicos, y ver Mi equipo. No ve RFC ni celular completos, no descarga la base de capturas, ni ve reportes
 * nacionales, bitácora, Mapa ni Estadísticas. Con alcance nacional (Titular de la UOTEHA) se suma la pantalla Resumen, solo de consulta.
 */
export const PERMISOS_ESTATAL: readonly Permiso[] = ["ver_usuarios_app", "gestionar_usuarios_app", "ver_revision", "validar_tortillerias", "revisar_precios", "ver_mi_equipo"];

/**
 * Permisos con los que de verdad cuenta una cuenta:
 *  - capturista (usuario de la app): ninguno (no entra al administrador)
 *  - admin: todos, menos los reservados (esos solo si se le marcaron)
 *  - supervisor: los marcados (si nunca se editaron, los de por omisión, que no incluyen los reservados)
 *  - estatal: los suyos, fijos (nunca los reservados)
 */
export function permisosEfectivos(rol: RolUsuario, marcados?: readonly string[] | null, alcanceNacional = false): Permiso[] {
  if (rol === "capturista") return [];
  if (rol === "estatal") return alcanceNacional ? ["ver_resumen", ...PERMISOS_ESTATAL] : [...PERMISOS_ESTATAL];
  if (rol === "admin") return CLAVES_PERMISOS.filter((c) => !esReservado(c) || !!marcados?.includes(c));
  if (!marcados) return [...PERMISOS_SUPERVISOR_POR_OMISION];
  return CLAVES_PERMISOS.filter((c) => marcados.includes(c));
}
export const tienePermiso = (rol: RolUsuario, marcados: readonly string[] | null | undefined, clave: Permiso, alcanceNacional = false) => permisosEfectivos(rol, marcados, alcanceNacional).includes(clave);

/** Alta de una cuenta del administrador (la contraseña temporal la genera el sistema y se muestra una sola vez) */
export const personalNuevoSchema = z.object({
  correo: z.string().trim().toLowerCase().email("Escribe un correo válido").max(120),
  nombre: z.string().trim().min(2, "Escribe el nombre").max(60),
  apellidos: z.string().trim().min(2, "Escribe los apellidos").max(80),
  rol: z.enum(["supervisor", "admin"]),
  permisos: z.array(z.string()).max(40).default([]),
});
export type PersonalNuevo = z.infer<typeof personalNuevoSchema>;
