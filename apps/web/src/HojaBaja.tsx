import { useState } from "react";
import { Ban, Loader2, TriangleAlert } from "lucide-react";
import { bajaSchema, MOTIVOS_BAJA } from "@tortillerias/shared";
import { Aviso, Boton, Campo, HojaModal, Selector } from "./ui";

/**
 * "Ya no funciona": el censador reporta que un establecimiento cerró definitivamente. Un solo reporte basta y la tortillería
 * queda inactiva de inmediato; por eso la hoja pide el motivo y una confirmación explícita. No se captura precio ni se pide foto.
 */
export default function HojaBaja({ nombre, alCerrar, alConfirmar }: { nombre: string; alCerrar: () => void; alConfirmar: (motivo: string, motivoOtro: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState("");
  const [otro, setOtro] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const valido = bajaSchema.safeParse({ motivo, motivoOtro: otro }).success;

  async function dar() {
    setEnviando(true);
    setError("");
    try {
      await alConfirmar(motivo, motivo === "otro" ? otro.trim() : "");
    } catch (e) {
      setError((e as Error).message);
      setEnviando(false);
    }
  }

  if (confirmando)
    return (
      <HojaModal titulo="Confirmar la baja" alCerrar={enviando ? () => {} : alCerrar}>
        <div className="flex items-start gap-3 rounded-2xl bg-red-50 p-3 ring-1 ring-red-200">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-100 text-red-700"><TriangleAlert className="h-5 w-5" aria-hidden /></span>
          <div className="min-w-0 text-sm">
            <p className="font-bold text-red-800">{nombre}</p>
            <p className="mt-0.5 text-red-700">La tortillería dejará de aparecer para todos los censadores. ¿Continuar?</p>
          </div>
        </div>
        {error && <Aviso>{error}</Aviso>}
        <div className="grid grid-cols-2 gap-2">
          <Boton variante="secundario" disabled={enviando} onClick={() => setConfirmando(false)}>Regresar</Boton>
          <Boton variante="peligro" disabled={enviando} icono={enviando ? Loader2 : Ban} onClick={dar}>{enviando ? "Guardando…" : "Sí, dar de baja"}</Boton>
        </div>
      </HojaModal>
    );

  return (
    <HojaModal titulo="Ya no funciona" alCerrar={alCerrar}>
      <p className="text-sm text-stone-600">
        Usa esta opción solo si la tortillería <b>cerró definitivamente</b>. Si solo está cerrada en este momento, regresa otro día.
      </p>
      <Selector
        etiqueta="¿Qué encontraste? *"
        icono={Ban}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Elige un motivo"
        opciones={MOTIVOS_BAJA.map((m) => ({ valor: m.clave, texto: m.texto }))}
      />
      {motivo === "otro" && (
        <Campo
          etiqueta="Especifica el motivo *"
          value={otro}
          maxLength={200}
          autoComplete="off"
          onChange={(e) => setOtro(e.target.value)}
          error={otro.trim() !== "" && otro.trim().length < 5 ? "Escribe al menos 5 caracteres" : undefined}
          placeholder="Ej. Lo convirtieron en una papelería"
          ayuda="De 5 a 200 caracteres"
        />
      )}
      <p className="text-xs text-stone-500">No se captura precio ni se pide foto. Podrás registrar otra tortillería después.</p>
      <div className="grid grid-cols-2 gap-2">
        <Boton variante="secundario" onClick={alCerrar}>Cancelar</Boton>
        <Boton variante="peligro" disabled={!valido} onClick={() => setConfirmando(true)}>Dar de baja</Boton>
      </div>
    </HojaModal>
  );
}
