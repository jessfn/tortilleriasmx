import type { FastifyInstance, FastifyReply } from "fastify";
import { auditar } from "../db.js";
import { calcularRango, consultaSchema, reunirReporte, textosRango, type Rango } from "../reportes.js";
import { reportePdf } from "../reporte-pdf.js";
import { reporteXlsx } from "../reporte-xlsx.js";

/** EXTRAS: reportes por día, semana, mes, año o rango de fechas (en hora de la Ciudad de México), en PDF o Excel */
export function rutasAdminReportes(app: FastifyInstance) {
  const permiso = app.conPermiso("ver_extras");

  function leer(query: unknown, reply: FastifyReply): { rango: Rango; formato: "pdf" | "xlsx" } | null {
    const q = consultaSchema.safeParse(query);
    if (!q.success) {
      reply.code(400).send({ error: q.error.issues[0]?.message ?? "Datos inválidos" });
      return null;
    }
    const rango = calcularRango(q.data.periodo, q.data.fecha, q.data.hasta);
    if (typeof rango === "string") {
      reply.code(400).send({ error: rango });
      return null;
    }
    return { rango, formato: q.data.formato };
  }

  // Qué incluirá el reporte (para mostrarlo antes de descargar)
  app.get("/admin/reportes/vista-previa", { preHandler: permiso, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const p = leer(req.query, reply);
    if (!p) return;
    const r = await reunirReporte(p.rango);
    const t = textosRango(p.rango);
    return { titulo: t.titulo, tipo: t.tipo, horario: t.horario, anterior: t.anterior, desde: p.rango.desde, hasta: p.rango.hasta, dias: p.rango.dias, granularidad: p.rango.granularidad, totales: r.totales, anteriorTotales: r.anterior, estados: r.estados.filter((e) => e.capturas > 0).length };
  });

  app.get("/admin/reportes/descargar", { preHandler: permiso, config: { rateLimit: { max: process.env.NODE_ENV === "test" ? 1000 : 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const p = leer(req.query, reply);
    if (!p) return;
    const r = await reunirReporte(p.rango);
    const t = textosRango(p.rango);
    const cuerpo = p.formato === "pdf" ? await reportePdf(r) : await reporteXlsx(r);
    await auditar(req.user.sub, "descargar_reporte", "reporte", `${p.rango.periodo}:${p.rango.desde}..${p.rango.hasta}:${p.formato}`);
    return reply
      .header("content-type", p.formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="${t.nombreArchivo}.${p.formato}"`)
      .header("cache-control", "no-store")
      .send(cuerpo);
  });
}
