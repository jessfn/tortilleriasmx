import { useEffect, useRef, useState } from "react";
import { History, Loader2, Search, ShieldCheck } from "lucide-react";
import { api } from "./api";
import { Aviso, Vacio } from "./ui";
import { Paginacion, type Pagina } from "./Paginacion";

type Fila = { id: number; fecha: string; usuario: string | null; accion: string; entidad: string | null; entidad_id: string | null };

/** Nombres claros para las acciones más comunes; las demás se muestran tal cual */
const ACCIONES: Record<string, string> = {
  ver_datos_fiscales: "Vio datos fiscales",
  ver_datos_personales: "Vio datos personales",
  crear_datos_fiscales: "Capturó datos fiscales",
  fiscal_negativa: "No se obtuvieron datos fiscales",
  captura_validada: "Aprobó un precio",
  captura_rechazada: "Rechazó un precio",
  tortilleria_validada: "Validó una tortillería",
  tortilleria_rechazada: "Rechazó una tortillería",
  crear_tortilleria: "Dio de alta una tortillería",
  exportar_capturas: "Descargó las capturas (CSV)",
  descargar_reporte: "Descargó un reporte (Extras)",
  reportar_baja: "Dio de baja una tortillería",
  reactivar_tortilleria: "Reactivó una tortillería",
  registrar_elaboracion: "Registró el tipo de elaboración",
  aprobacion_masiva_migracion_010: "Aprobación automática de precios normales (migración 010)",
};
const accionTexto = (a: string) => ACCIONES[a] ?? a.replace(/_/g, " ");
const cuando = (s: string) => new Date(s).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });

/** Bitácora de auditoría (solo administrador, solo lectura): responde "¿quién vio este RFC?" o "¿quién aprobó este precio?" */
export default function AdminAuditoria() {
  const [pag, setPag] = useState<Pagina<Fila>>();
  const [error, setError] = useState("");
  const [pagina, setPagina] = useState(1);
  const [limite, setLimite] = useState(50);
  const [usuario, setUsuario] = useState("");
  const [accion, setAccion] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [filtros, setFiltros] = useState({ usuario: "", accion: "" });
  const zona = useRef<HTMLDivElement>(null);

  // El texto de los filtros se envía un momento después de escribir
  useEffect(() => {
    const t = window.setTimeout(() => {
      setFiltros({ usuario: usuario.trim(), accion: accion.trim() });
      setPagina(1);
    }, 300);
    return () => window.clearTimeout(t);
  }, [usuario, accion]);

  useEffect(() => {
    let vigente = true;
    const p = new URLSearchParams({ pagina: String(pagina), limite: String(limite) });
    if (filtros.usuario) p.set("usuario", filtros.usuario);
    if (filtros.accion) p.set("accion", filtros.accion);
    if (desde) p.set("desde", desde);
    if (hasta) p.set("hasta", hasta);
    api<Pagina<Fila>>(`/admin/auditoria?${p}`)
      .then((r) => {
        if (!vigente) return;
        if (!r.filas.length && pagina > 1) return setPagina(Math.max(1, r.paginas));
        setPag(r);
        setError("");
      })
      .catch((e) => vigente && setError(e.message));
    return () => {
      vigente = false;
    };
  }, [pagina, limite, filtros, desde, hasta]);
  useEffect(() => {
    zona.current?.scrollTo({ top: 0 });
  }, [pagina, limite, filtros, desde, hasta]);

  const campo = "h-11 rounded-xl border border-stone-200 bg-white px-3 text-sm shadow-sm outline-none focus:border-guinda focus:ring-4 focus:ring-guinda/10";
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[92rem] flex-col gap-2.5 px-3 pb-3 pt-4 lg:px-6 lg:pb-5">
      <div className="flex shrink-0 items-center gap-2 px-1">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-verde/10 text-verde"><ShieldCheck className="h-[18px] w-[18px]" aria-hidden /></span>
        <div className="leading-tight">
          <h2 className="text-base font-bold">Bitácora de auditoría</h2>
          <p className="text-xs text-stone-500">Quién hizo qué y cuándo. Solo lectura.</p>
        </div>
      </div>

      <div className="grid shrink-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-stone-400" aria-hidden />
          <input value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="Persona (correo)" aria-label="Filtrar por persona" className={`${campo} w-full pl-10`} />
        </label>
        <input value={accion} onChange={(e) => setAccion(e.target.value)} placeholder="Acción (ej. ver_datos_fiscales)" aria-label="Filtrar por acción" className={campo} />
        <label className="flex items-center gap-2 text-xs text-stone-500">Desde <input type="date" value={desde} onChange={(e) => { setDesde(e.target.value); setPagina(1); }} className={`${campo} min-w-0 flex-1`} /></label>
        <label className="flex items-center gap-2 text-xs text-stone-500">Hasta <input type="date" value={hasta} onChange={(e) => { setHasta(e.target.value); setPagina(1); }} className={`${campo} min-w-0 flex-1`} /></label>
      </div>
      {error && <Aviso>{error}</Aviso>}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200" aria-label="Bitácora">
        <div ref={zona} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {!pag ? (
            <div className="grid place-items-center py-16 text-stone-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : pag.filas.length === 0 ? (
            <Vacio icono={History} titulo="Sin registros" texto="No hay acciones con esos filtros." />
          ) : (
            <ul className="divide-y divide-stone-100">
              {pag.filas.map((f) => (
                <li key={f.id} className="flex flex-wrap items-start gap-x-4 gap-y-0.5 px-3 py-2.5 text-sm">
                  <span className="w-44 shrink-0 text-xs text-stone-400">{cuando(f.fecha)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{accionTexto(f.accion)}</span>
                    <span className="block truncate text-xs text-stone-500">
                      {f.usuario ?? "Sistema"}
                      {f.entidad ? ` · ${f.entidad.replace(/_/g, " ")}` : ""}
                      {f.entidad_id ? ` · ${f.entidad_id.length > 40 ? `${f.entidad_id.slice(0, 40)}…` : f.entidad_id}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {pag && <Paginacion total={pag.total} pagina={pag.pagina} paginas={pag.paginas} limite={pag.limite} alPagina={setPagina} alLimite={(n) => { setLimite(n); setPagina(1); }} />}
      </section>
    </div>
  );
}
