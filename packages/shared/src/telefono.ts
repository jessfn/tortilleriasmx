/**
 * Teléfonos con país. Se guardan así (y solo así):
 *  - México: los 10 dígitos con lada, sin +52 (como siempre): "5512345678"
 *  - Otro país: "+" + código del país + número: "+14155552671"
 * Así lo que ya estaba guardado sigue siendo válido y un número extranjero no se confunde con uno mexicano.
 */

export type Pais = { iso: string; nombre: string; lada: string };

/** Países con su código (lada). México va primero: es el valor por defecto. */
export const PAISES: Pais[] = [
  { iso: "MX", nombre: "México", lada: "52" },
  { iso: "US", nombre: "Estados Unidos", lada: "1" },
  { iso: "CA", nombre: "Canadá", lada: "1" },
  { iso: "GT", nombre: "Guatemala", lada: "502" },
  { iso: "BZ", nombre: "Belice", lada: "501" },
  { iso: "SV", nombre: "El Salvador", lada: "503" },
  { iso: "HN", nombre: "Honduras", lada: "504" },
  { iso: "NI", nombre: "Nicaragua", lada: "505" },
  { iso: "CR", nombre: "Costa Rica", lada: "506" },
  { iso: "PA", nombre: "Panamá", lada: "507" },
  { iso: "CU", nombre: "Cuba", lada: "53" },
  { iso: "CO", nombre: "Colombia", lada: "57" },
  { iso: "VE", nombre: "Venezuela", lada: "58" },
  { iso: "EC", nombre: "Ecuador", lada: "593" },
  { iso: "PE", nombre: "Perú", lada: "51" },
  { iso: "BO", nombre: "Bolivia", lada: "591" },
  { iso: "CL", nombre: "Chile", lada: "56" },
  { iso: "AR", nombre: "Argentina", lada: "54" },
  { iso: "UY", nombre: "Uruguay", lada: "598" },
  { iso: "PY", nombre: "Paraguay", lada: "595" },
  { iso: "BR", nombre: "Brasil", lada: "55" },
  { iso: "ES", nombre: "España", lada: "34" },
  { iso: "FR", nombre: "Francia", lada: "33" },
  { iso: "DE", nombre: "Alemania", lada: "49" },
  { iso: "IT", nombre: "Italia", lada: "39" },
  { iso: "GB", nombre: "Reino Unido", lada: "44" },
  { iso: "CN", nombre: "China", lada: "86" },
  { iso: "JP", nombre: "Japón", lada: "81" },
  { iso: "KR", nombre: "Corea del Sur", lada: "82" },
  { iso: "IN", nombre: "India", lada: "91" },
];
export const PAIS_MX = PAISES[0];

/** Quita espacios, guiones, puntos y paréntesis: "+52 (55) 1234-5678" → "+525512345678" */
export const limpiarTelefono = (s: string) => s.replace(/[\s\-.()]/g, "");

/** Forma canónica (ver arriba). "+52 55 1234 5678" y "5512345678" dan lo mismo; "0049…" se toma como "+49…". */
export function normalizarTelefono(s: string): string {
  let t = limpiarTelefono(s);
  if (t.startsWith("00")) t = "+" + t.slice(2);
  if (/^\+52\d{10}$/.test(t)) return t.slice(3);
  return t;
}

/** ¿Es un teléfono válido? 10 dígitos (México) o +código y número de otro país (8 a 15 dígitos en total, como en la norma E.164) */
export const esTelefonoValido = (t: string) => /^\d{10}$/.test(t) || /^\+(?!52)[1-9]\d{7,14}$/.test(t);

/** País de un número guardado: sin "+" es México; con "+", el de la lada más larga que coincida */
export function paisDe(valor: string): Pais {
  if (!valor.startsWith("+")) return PAIS_MX;
  const d = valor.slice(1);
  return [...PAISES].filter((p) => d.startsWith(p.lada)).sort((a, b) => b.lada.length - a.lada.length)[0] ?? { iso: "??", nombre: "Otro país", lada: d.slice(0, 2) };
}

/** Separa un número guardado en país y dígitos (sin lada) */
export function partirTelefono(valor: string): { pais: Pais; digitos: string } {
  const pais = paisDe(valor);
  return { pais, digitos: valor.startsWith("+") ? valor.slice(1 + pais.lada.length) : valor };
}

/** Arma el valor que se guarda a partir del país y los dígitos que escribió la persona */
export const armarTelefono = (pais: Pais, digitos: string) => (pais.iso === "MX" ? digitos : digitos ? `+${pais.lada}${digitos}` : "");

/** Cuántos dígitos se pueden escribir (sin la lada) en cada país */
export const maxDigitos = (pais: Pais) => (pais.iso === "MX" || pais.lada === "1" ? 10 : 15 - pais.lada.length);

const agrupar = (d: string, tamanos: number[]) => {
  const partes: string[] = [];
  let i = 0;
  for (const n of tamanos) {
    if (i >= d.length) break;
    partes.push(d.slice(i, i + n));
    i += n;
  }
  if (i < d.length) partes.push(d.slice(i));
  return partes;
};

/** El número como se lee en ese país, mientras se escribe: México "55 1234 5678" o "744 123 4567"; EE. UU. y Canadá "(415) 555-2671" */
export function formatearNacional(digitos: string, pais: Pais): string {
  const d = digitos.replace(/\D/g, "");
  if (pais.iso === "MX") {
    // 55, 33 y 81 (CDMX, Guadalajara, Monterrey) tienen lada de 2 dígitos; el resto, de 3
    return agrupar(d, /^(55|33|81)/.test(d) ? [2, 4, 4] : [3, 3, 4]).join(" ");
  }
  if (pais.lada === "1") {
    const [a, b, c] = agrupar(d, [3, 3, 4]);
    return [a && (b ? `(${a})` : a), b && (c ? `${b}-${c}` : b)].filter(Boolean).join(" ");
  }
  return agrupar(d, [3, 3, 3, 3, 3]).join(" ");
}

/** Para mostrar un número guardado: "+52 55 1234 5678", "+1 (415) 555-2671", "+34 612 345 678" */
export function formatearTelefono(valor: string | null | undefined): string {
  if (!valor) return "";
  if (valor.includes("*")) return valor; // el servidor lo manda enmascarado a quien no puede verlo completo
  const { pais, digitos } = partirTelefono(valor);
  return `+${pais.lada} ${formatearNacional(digitos, pais)}`.trim();
}
