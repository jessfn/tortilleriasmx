import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function useEnLinea() {
  const [en, setEn] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const a = () => setEn(true);
    const b = () => setEn(false);
    window.addEventListener("online", a);
    window.addEventListener("offline", b);
    return () => {
      window.removeEventListener("online", a);
      window.removeEventListener("offline", b);
    };
  }, []);
  return en;
}

/** Aviso fijo y discreto cuando no hay señal */
export function AvisoSinConexion() {
  const en = useEnLinea();
  if (en) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center" style={{ top: "calc(env(safe-area-inset-top, 0px) + 6px)" }} role="status">
      <span className="flex items-center gap-1.5 rounded-full bg-stone-900/85 px-3 py-1 text-[11px] font-semibold text-white shadow-lg backdrop-blur">
        <WifiOff className="h-3 w-3" aria-hidden /> Sin conexión
      </span>
    </div>
  );
}
