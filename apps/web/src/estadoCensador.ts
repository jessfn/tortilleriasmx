import { api } from "./api";
import { masCercana } from "./catalogo";

/**
 * Estado que se SUGIERE como estado del censador: el de su ubicación GPS, nunca el de la tortillería que captura
 * (un técnico de la Ciudad de México puede capturar tortillerías de Aguascalientes y su estado sigue siendo el suyo).
 *  - con GPS y señal: el que responde el servidor para esa posición;
 *  - con GPS y sin señal: el de la tortillería del catálogo guardado en el teléfono que queda más cerca de él;
 *  - sin GPS: nada (la persona lo elige).
 */
export async function estadoPorUbicacion(pos?: { lat: number; lng: number } | null, enLinea: boolean = typeof navigator === "undefined" ? true : navigator.onLine): Promise<string | null> {
  if (!pos) return null;
  if (enLinea) {
    try {
      const z = await api<{ estado: { clave: string } | null }>(`/ubicacion/cercana?lat=${pos.lat}&lng=${pos.lng}`);
      if (z.estado?.clave) return z.estado.clave;
    } catch {
      /* sin respuesta: se usa el catálogo del teléfono */
    }
  }
  return masCercana(pos)?.estado ?? null;
}
