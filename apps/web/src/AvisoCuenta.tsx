import { Clock, ShieldX } from "lucide-react";

/** Reemplaza al botón "Registrar tortillería" en una cuenta que todavía no puede capturar */
export function AvisoCuenta({ estado }: { estado: string }) {
  const rechazada = estado === "rechazado";
  return (
    <div role="status" className={`flex items-start gap-3 rounded-3xl p-5 ring-1 ${rechazada ? "bg-red-50 text-red-900 ring-red-200" : "bg-amber-50 text-amber-900 ring-amber-200"}`}>
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${rechazada ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
        {rechazada ? <ShieldX className="h-6 w-6" aria-hidden /> : <Clock className="h-6 w-6" aria-hidden />}
      </span>
      <div className="min-w-0">
        <p className="text-base font-bold leading-tight">{rechazada ? "Tu solicitud no fue autorizada" : "Tu solicitud está en revisión"}</p>
        <p className="mt-1 text-sm leading-snug">
          {rechazada
            ? "Esta cuenta no puede registrar tortillerías ni precios. Si crees que es un error, comunícate con el responsable de tu estado."
            : "Te avisaremos cuando la autoricen. Mientras tanto no puedes registrar tortillerías ni precios; lo que ya tenías guardado se enviará cuando la autoricen."}
        </p>
      </div>
    </div>
  );
}
