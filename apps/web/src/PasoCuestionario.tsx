import { useState, type ReactNode } from "react";
import { ClipboardX, Eye, History, Lock, MessageSquare, TriangleAlert } from "lucide-react";
import {
  alternarApoyo, aplicaB6, aplicaB7, APOYOS, CONOCE_ACUERDO, DECLARACION_ANUAL, HIGIENE_PUNTOS, IMSS, INSUMO, LICENCIA, limpiarCondicionales,
  MOTIVO_NO_ADHESION, MOTIVO_NO_APLICA, NUM_TRABAJADORES, PREGUNTAS, PROPIEDAD, respuestasSchema, textoB2, textoMotivoNoAplica, UBICACION_TIPO, VOLUMEN_SEMANAL,
  type Respuestas,
} from "@tortillerias/shared";
import { Aviso, Boton, HojaModal } from "./ui";

/** Respuestas a medias (el borrador del asistente las guarda así) */
export type Borr = Partial<Omit<Respuestas, "a2">> & { a2?: Partial<Respuestas["a2"]> };
export type EstadoCuest = { estatus?: "aplicado" | "no_aplicado"; r: Borr; motivo?: string; motivoOtro?: string };

/** Preguntas en el orden fijo de la pantalla (A → B → C); las condicionales solo cuando aplican */
export function pendientes(r: Borr): string[] {
  const f: string[] = [];
  if (!r.a1) f.push("a1");
  if (HIGIENE_PUNTOS.some((h) => typeof r.a2?.[h.clave] !== "boolean")) f.push("a2");
  for (const k of ["b1", "b2", "b3", "b4", "b5"] as const) if (!r[k]) f.push(k);
  if (aplicaB6(r.b5) && (!r.b6?.length || (r.b6.includes("OTRO") && !r.b6Otro?.trim()))) f.push("b6");
  if (aplicaB7(r.b5) && r.b7 === undefined) f.push("b7");
  if (!r.b8?.length) f.push("b8");
  for (const k of ["c1", "c2", "c3"] as const) if (!r[k]) f.push(k);
  return f;
}

/** Respuestas listas para enviar (sin condicionales que ya no aplican), o null si falta algo */
export function respuestasListas(r: Borr): Respuestas | null {
  const p = respuestasSchema.safeParse(limpiarCondicionales({ ...r, b6Otro: r.b6Otro?.trim() || undefined } as Respuestas));
  return p.success ? p.data : null;
}

/** ¿Se puede continuar? Con el cuestionario completo, o con "No se pudo aplicar" y su motivo */
export function cuestionarioListo(c: EstadoCuest): boolean {
  if (c.estatus === "no_aplicado") return !!c.motivo && (c.motivo !== "OTRO" || (c.motivoOtro ?? "").trim().length >= 5);
  return !!respuestasListas(c.r);
}

/**
 * C21 · Pantalla del cuestionario. Tres bloques en orden fijo: A (lo observa el censador), B (al encargado) y C (sensibles, al final).
 * Al actualizar, A y B llegan prellenados; el C siempre se vuelve a preguntar.
 */
export default function PasoCuestionario({
  valor, onChange, prellenadoEl, avisoAnterior, intentoGuardar,
}: {
  valor: EstadoCuest;
  onChange: (v: EstadoCuest) => void;
  /** fecha (AAAA-MM-DD) del cuestionario con que se prellenó */
  prellenadoEl?: string | null;
  /** "En la visita anterior no se pudo aplicar (motivo, fecha)" */
  avisoAnterior?: { motivo: string | null; fecha?: string } | null;
  /** se intentó continuar con algo pendiente: se marcan las preguntas sin responder */
  intentoGuardar: boolean;
}) {
  const r = valor.r;
  const setR = (p: Borr) => onChange({ ...valor, estatus: undefined, motivo: undefined, motivoOtro: undefined, r: limpiarCondicionales({ ...r, ...p } as Partial<Respuestas>) as Borr });
  const falta = new Set(intentoGuardar ? pendientes(r) : []);
  const [hoja, setHoja] = useState(false);
  const [motivo, setMotivo] = useState(valor.motivo ?? "");
  const [motivoOtro, setMotivoOtro] = useState(valor.motivoOtro ?? "");
  const otroOk = motivo !== "OTRO" || (motivoOtro.trim().length >= 5 && motivoOtro.trim().length <= 100);

  if (valor.estatus === "no_aplicado")
    return (
      <div className="space-y-3">
        <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-900"><ClipboardX className="h-4 w-4" aria-hidden /> No se pudo aplicar</p>
          <p className="mt-1 text-sm text-amber-900/90">Motivo: {valor.motivo === "OTRO" ? `Otro: ${valor.motivoOtro}` : textoMotivoNoAplica(valor.motivo)}</p>
          <p className="mt-1 text-xs text-amber-800/80">El precio se guarda igual. Podrás aplicarlo en otra visita desde "Mis tortillerías".</p>
        </div>
        <Boton variante="secundario" onClick={() => onChange({ r: valor.r })}>Sí se puede aplicar: responder ahora</Boton>
      </div>
    );

  return (
    <div className="space-y-3">
      {avisoAnterior && (
        <Aviso tipo="info">
          En la visita anterior no se pudo aplicar{avisoAnterior.motivo ? ` (${textoMotivoNoAplica(avisoAnterior.motivo).toLowerCase()}` : " ("}{avisoAnterior.fecha ? `, ${fechaCorta(avisoAnterior.fecha)})` : ")"}. Intenta de nuevo.
        </Aviso>
      )}
      {prellenadoEl && (
        <p className="flex items-center gap-1.5 rounded-xl bg-stone-100 px-3 py-2 text-xs text-stone-600">
          <History className="h-3.5 w-3.5 shrink-0" aria-hidden /> Última actualización: {fechaCorta(prellenadoEl, true)}. Revisa y cambia lo que sea distinto.
        </p>
      )}
      <button
        type="button"
        onClick={() => setHoja(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-3 py-2.5 text-sm font-semibold text-stone-600 ring-1 ring-stone-200 transition active:scale-[.98]"
      >
        <ClipboardX className="h-4 w-4 text-stone-400" aria-hidden /> No se pudo aplicar
      </button>

      {/* ---------------- Bloque A ---------------- */}
      <Bloque letra="A" titulo="Lo que observas" icono={Eye} leyenda="Responde estas preguntas con lo que ves. No es necesario preguntarlas.">
        <Pregunta id="a1" n="A1" texto={PREGUNTAS.a1} falta={falta.has("a1")}>
          <Unica opciones={UBICACION_TIPO} valor={r.a1} onChange={(v) => setR({ a1: v as Respuestas["a1"] })} />
        </Pregunta>
        <Pregunta id="a2" n="A2" texto={PREGUNTAS.a2} falta={falta.has("a2")}>
          <div className="space-y-2">
            {HIGIENE_PUNTOS.map((h) => (
              <div key={h.clave} className="rounded-xl bg-stone-50 p-2.5 ring-1 ring-stone-100">
                <p className="text-[13px] leading-snug text-stone-700">{h.texto}</p>
                <SiNo valor={r.a2?.[h.clave]} onChange={(v) => setR({ a2: { ...r.a2, [h.clave]: v } })} etiqueta={h.texto} />
              </div>
            ))}
          </div>
        </Pregunta>
      </Bloque>

      {/* ---------------- Bloque B ---------------- */}
      <Bloque letra="B" titulo="Preguntas al encargado" icono={MessageSquare}>
        <Pregunta id="b1" n="B1" texto={PREGUNTAS.b1} falta={falta.has("b1")}>
          <Unica opciones={INSUMO} valor={r.b1} onChange={(v) => setR({ b1: v as Respuestas["b1"] })} />
        </Pregunta>
        <Pregunta id="b2" n="B2" texto={textoB2(r.b1)} falta={falta.has("b2")}>
          <Unica opciones={VOLUMEN_SEMANAL} valor={r.b2} onChange={(v) => setR({ b2: v as Respuestas["b2"] })} />
        </Pregunta>
        <Pregunta id="b3" n="B3" texto={PREGUNTAS.b3} falta={falta.has("b3")}>
          <Unica opciones={PROPIEDAD} valor={r.b3} onChange={(v) => setR({ b3: v as Respuestas["b3"] })} />
        </Pregunta>
        <Pregunta id="b4" n="B4" texto={PREGUNTAS.b4} falta={falta.has("b4")}>
          <Unica opciones={NUM_TRABAJADORES} valor={r.b4} onChange={(v) => setR({ b4: v as Respuestas["b4"] })} columnas={4} />
        </Pregunta>
        <Pregunta id="b5" n="B5" texto={PREGUNTAS.b5} falta={falta.has("b5")}>
          <Unica opciones={CONOCE_ACUERDO} valor={r.b5} onChange={(v) => setR({ b5: v as Respuestas["b5"] })} />
        </Pregunta>
        {aplicaB6(r.b5) && (
          <Pregunta id="b6" n="B6" texto={PREGUNTAS.b6} ayuda="Marca todas las que apliquen" falta={falta.has("b6")} condicional>
            <Multiple
              opciones={MOTIVO_NO_ADHESION}
              valor={r.b6 ?? []}
              onChange={(v) => setR({ b6: v as Respuestas["b6"] })}
            />
            {r.b6?.includes("OTRO") && (
              <div className="mt-2">
                <input
                  value={r.b6Otro ?? ""}
                  maxLength={100}
                  onChange={(e) => setR({ b6Otro: e.target.value })}
                  placeholder="Escribe el otro motivo"
                  aria-label="Otro motivo por el que no se ha adherido"
                  className="w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-stone-300 focus:ring-2 focus:ring-guinda"
                />
                <p className="mt-1 text-right text-[11px] text-stone-400">{(r.b6Otro ?? "").length}/100</p>
              </div>
            )}
          </Pregunta>
        )}
        {aplicaB7(r.b5) && (
          <Pregunta id="b7" n="B7" texto={PREGUNTAS.b7} falta={falta.has("b7")} condicional>
            <SiNo valor={r.b7} onChange={(v) => setR({ b7: v })} etiqueta={PREGUNTAS.b7} />
          </Pregunta>
        )}
        <Pregunta id="b8" n="B8" texto={PREGUNTAS.b8} ayuda="Marca todas las que apliquen" falta={falta.has("b8")}>
          <Multiple opciones={APOYOS} valor={r.b8 ?? []} onChange={(v) => setR({ b8: v as Respuestas["b8"] })} alternar={alternarApoyo} />
        </Pregunta>
      </Bloque>

      {/* ---------------- Bloque C ---------------- */}
      <Bloque letra="C" titulo="Preguntas voluntarias" icono={Lock} leyenda="Estas preguntas son voluntarias. Si no quiere responder, marca 'Prefiere no responder' y continúa.">
        <Pregunta id="c1" n="C1" texto={PREGUNTAS.c1} falta={falta.has("c1")}>
          <Unica opciones={LICENCIA} valor={r.c1} onChange={(v) => setR({ c1: v as Respuestas["c1"] })} />
        </Pregunta>
        <Pregunta id="c2" n="C2" texto={PREGUNTAS.c2} falta={falta.has("c2")}>
          <Unica opciones={IMSS} valor={r.c2} onChange={(v) => setR({ c2: v as Respuestas["c2"] })} columnas={2} />
        </Pregunta>
        <Pregunta id="c3" n="C3" texto={PREGUNTAS.c3} falta={falta.has("c3")}>
          <Unica opciones={DECLARACION_ANUAL} valor={r.c3} onChange={(v) => setR({ c3: v as Respuestas["c3"] })} columnas={2} />
        </Pregunta>
      </Bloque>

      {hoja && (
        <HojaModal titulo="No se pudo aplicar" alCerrar={() => setHoja(false)}>
          <p className="text-sm text-stone-600">¿Por qué no se pudo aplicar el cuestionario? El precio se guarda igual.</p>
          <div className="space-y-2" role="radiogroup" aria-label="Motivo">
            {MOTIVO_NO_APLICA.map((m) => (
              <button
                key={m.clave}
                type="button"
                role="radio"
                aria-checked={motivo === m.clave}
                onClick={() => setMotivo(m.clave)}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition ${motivo === m.clave ? "bg-guinda/10 text-guinda ring-2 ring-guinda" : "bg-white text-stone-700 ring-1 ring-stone-200"}`}
              >
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${motivo === m.clave ? "border-guinda" : "border-stone-300"}`}>
                  {motivo === m.clave && <span className="h-2.5 w-2.5 rounded-full bg-guinda" />}
                </span>
                {m.texto}
              </button>
            ))}
          </div>
          {motivo === "OTRO" && (
            <div>
              <textarea
                value={motivoOtro}
                maxLength={100}
                rows={2}
                onChange={(e) => setMotivoOtro(e.target.value)}
                placeholder="Escribe el motivo (5 a 100 caracteres)"
                aria-label="Otro motivo"
                className="w-full rounded-xl border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-stone-300 focus:ring-2 focus:ring-guinda"
              />
              <p className={`mt-1 text-right text-[11px] ${motivoOtro.trim().length && motivoOtro.trim().length < 5 ? "text-red-600" : "text-stone-400"}`}>{motivoOtro.length}/100</p>
            </div>
          )}
          <Boton
            disabled={!motivo || !otroOk}
            onClick={() => {
              setHoja(false);
              onChange({ r: valor.r, estatus: "no_aplicado", motivo, motivoOtro: motivo === "OTRO" ? motivoOtro.trim() : undefined });
            }}
          >
            Guardar motivo y continuar
          </Boton>
        </HojaModal>
      )}
    </div>
  );
}

/** "2026-11-23" → "23 nov" (con año: "23 nov 2026") */
export function fechaCorta(f: string, conAnio = false) {
  const [a, m, d] = f.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("es-MX", { day: "numeric", month: "short", ...(conAnio ? { year: "numeric" } : {}) }).replace(".", "");
}

function Bloque({ letra, titulo, icono: Icono, leyenda, children }: { letra: string; titulo: string; icono: typeof Eye; leyenda?: string; children: ReactNode }) {
  return (
    <section className="space-y-2" aria-label={`Bloque ${letra}: ${titulo}`}>
      <header className="sticky -top-5 z-10 -mx-3 flex items-center gap-2 bg-stone-50/95 px-4 pb-1.5 pt-2 backdrop-blur">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-guinda text-xs font-bold text-white">{letra}</span>
        <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-guinda"><Icono className="h-4 w-4 shrink-0" aria-hidden /> {titulo}</h2>
      </header>
      {leyenda && <p className="rounded-xl bg-dorado/10 px-3 py-2 text-xs leading-snug text-stone-700 ring-1 ring-dorado/30">{leyenda}</p>}
      {children}
    </section>
  );
}

function Pregunta({ id, n, texto, ayuda, falta, condicional, children }: { id: string; n: string; texto: string; ayuda?: string; falta?: boolean; condicional?: boolean; children: ReactNode }) {
  return (
    <div
      id={`pregunta-${id}`}
      className={`scroll-mt-14 rounded-2xl bg-white p-3 shadow-sm transition ${falta ? "ring-2 ring-red-400" : condicional ? "ring-1 ring-dorado/50" : "ring-1 ring-stone-200"}`}
    >
      <p className="text-sm font-semibold leading-snug text-stone-900">
        <span className="mr-1 text-guinda">{n}.</span> {texto}
      </p>
      {ayuda && <p className="text-xs text-stone-500">{ayuda}</p>}
      <div className="mt-2">{children}</div>
      {falta && (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-red-600"><TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Responde esta pregunta</p>
      )}
    </div>
  );
}

type Op = { readonly clave: string; readonly texto: string };

function Unica({ opciones, valor, onChange, columnas = 1 }: { opciones: readonly Op[]; valor?: string; onChange: (v: string) => void; columnas?: 1 | 2 | 4 }) {
  const grid = columnas === 4 ? "grid-cols-4" : columnas === 2 ? "grid-cols-2" : "grid-cols-1";
  return (
    <div className={`grid gap-1.5 ${grid}`} role="radiogroup">
      {opciones.map((o) => {
        const on = valor === o.clave;
        return (
          <button
            key={o.clave}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.clave)}
            className={`flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-medium leading-snug transition active:scale-[.98] ${columnas > 1 ? "justify-center text-center" : ""} ${on ? "bg-guinda text-white shadow-md shadow-guinda/25" : "bg-stone-50 text-stone-700 ring-1 ring-stone-200"}`}
          >
            {columnas === 1 && (
              <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${on ? "border-white" : "border-stone-300"}`}>{on && <span className="h-2 w-2 rounded-full bg-white" />}</span>
            )}
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

function Multiple({ opciones, valor, onChange, alternar }: { opciones: readonly Op[]; valor: readonly string[]; onChange: (v: string[]) => void; alternar?: (actual: readonly string[], clave: string) => string[] }) {
  const toggle = (c: string) => onChange(alternar ? alternar(valor, c) : valor.includes(c) ? valor.filter((x) => x !== c) : [...valor, c]);
  return (
    <div className="grid gap-1.5" role="group">
      {opciones.map((o) => {
        const on = valor.includes(o.clave);
        return (
          <button
            key={o.clave}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(o.clave)}
            className={`flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-medium leading-snug transition active:scale-[.98] ${on ? "bg-guinda/10 text-guinda ring-2 ring-guinda" : "bg-stone-50 text-stone-700 ring-1 ring-stone-200"}`}
          >
            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 text-[11px] font-black ${on ? "border-guinda bg-guinda text-white" : "border-stone-300 bg-white"}`}>{on ? "✓" : ""}</span>
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

function SiNo({ valor, onChange, etiqueta }: { valor?: boolean; onChange: (v: boolean) => void; etiqueta: string }) {
  return (
    <div className="mt-1.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={etiqueta}>
      {([[true, "Sí"], [false, "No"]] as const).map(([v, t]) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={valor === v}
          onClick={() => onChange(v)}
          className={`min-h-10 rounded-xl text-sm font-semibold transition active:scale-[.97] ${valor === v ? "bg-guinda text-white shadow-md shadow-guinda/25" : "bg-white text-stone-600 ring-1 ring-stone-200"}`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
