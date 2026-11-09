import { z } from "zod";

/**
 * Mapas a poco zoom: en lugar de miles de puntos, el servidor agrupa las tortillerías en celdas de una cuadrícula
 * cuyo tamaño depende del zoom (cada celda mide ~60 px en pantalla). Así el mapa siempre se ve con algo, a cualquier distancia.
 */
export const zoomSchema = z.coerce.number().min(0).max(22).catch(5);
export const MAX_CELDAS = 1500;

/** Tamaño de la celda en grados para el zoom dado */
export const tamanoCelda = (zoom: number) => Math.min(20, Math.max(0.002, 84 / 2 ** zoom));
