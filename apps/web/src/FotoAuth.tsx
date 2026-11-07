import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { apiImagenUrl } from "./api";

/** Muestra una foto protegida: la descarga con la sesión del usuario */
export default function FotoAuth({ id, miniatura, className = "" }: { id: string; miniatura?: boolean; className?: string }) {
  const [url, setUrl] = useState<string>();
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    let u: string | undefined;
    let vivo = true;
    apiImagenUrl(`/fotos/${id}${miniatura ? "?tipo=miniatura" : ""}`)
      .then((x) => {
        u = x;
        if (vivo) setUrl(x);
      })
      .catch(() => vivo && setFallo(true));
    return () => {
      vivo = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, miniatura]);

  if (fallo)
    return (
      <div className={`grid place-items-center bg-stone-100 text-stone-400 ${className}`}>
        <ImageOff className="h-6 w-6" aria-hidden />
      </div>
    );
  if (!url) return <div className={`animate-pulse bg-stone-200 ${className}`} />;
  return <img src={url} alt="Foto de la tortillería" className={`object-cover ${className}`} />;
}
