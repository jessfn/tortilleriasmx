import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Boton({
  variante = "primario",
  className = "",
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: "primario" | "secundario" | "fantasma" }) {
  const base =
    "w-full min-h-14 rounded-2xl px-5 text-lg font-semibold transition active:scale-[.98] disabled:opacity-40 disabled:active:scale-100";
  const v = {
    primario: "bg-guinda text-white shadow-lg shadow-guinda/30 hover:bg-guinda-oscuro",
    secundario: "bg-white text-guinda ring-2 ring-guinda dark:bg-stone-800",
    fantasma: "text-stone-600 dark:text-stone-300",
  }[variante];
  return <button {...p} className={`${base} ${v} ${className}`} />;
}

export function Campo({
  etiqueta,
  error,
  ayuda,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; error?: string; ayuda?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-600 dark:text-stone-300">{etiqueta}</span>
      <input
        {...p}
        className={`w-full min-h-14 rounded-2xl border-2 bg-white px-4 text-lg outline-none transition focus:border-guinda dark:bg-stone-800 ${
          error ? "border-red-500" : "border-stone-200 dark:border-stone-700"
        }`}
      />
      {error ? (
        <span className="mt-1 block text-sm text-red-600">{error}</span>
      ) : ayuda ? (
        <span className="mt-1 block text-sm text-stone-500">{ayuda}</span>
      ) : null}
    </label>
  );
}

export function Opcion({ activo, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { activo?: boolean }) {
  return (
    <button
      {...p}
      className={`w-full rounded-2xl border-2 px-4 py-4 text-left text-lg transition active:scale-[.98] ${
        activo
          ? "border-guinda bg-guinda/10 font-semibold"
          : "border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800"
      }`}
    >
      {children}
    </button>
  );
}

export function Pantalla({ titulo, children }: { titulo?: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">
      <header className="bg-guinda-oscuro px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
        <div className="flex items-center gap-2 text-sm font-medium tracking-wide text-dorado">
          <span className="inline-block h-2 w-2 rounded-full bg-dorado" /> TortilleríasMX
        </div>
        {titulo && <h1 className="mt-1 text-2xl font-bold">{titulo}</h1>}
      </header>
      {children}
    </div>
  );
}
