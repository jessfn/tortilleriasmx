import { useState } from "react";
import { ClipboardPlus, LogIn } from "lucide-react";

/**
 * Pantalla de bienvenida. Para usar el logo oficial del Gobierno de México,
 * coloca el archivo en apps/web/public/logo-gobierno.png (fondo transparente, versión blanca).
 */
function LogoGobierno() {
  const [hayLogo, setHayLogo] = useState(true);
  if (hayLogo)
    return <img src="/logo-gobierno.png" alt="Gobierno de México" className="h-12 w-auto" onError={() => setHayLogo(false)} />;
  return (
    <div className="flex items-stretch gap-2.5" aria-label="Gobierno de México">
      <span className="w-1 rounded-full bg-dorado" aria-hidden />
      <div className="leading-none">
        <div className="text-[10px] font-semibold tracking-[.32em] text-dorado">GOBIERNO DE</div>
        <div className="mt-1 text-[26px] font-extrabold tracking-tight">MÉXICO</div>
      </div>
    </div>
  );
}

function Tortilleria() {
  return (
    <svg viewBox="0 0 320 250" className="h-full max-h-64 w-auto" role="img" aria-label="Ilustración de una tortillería">
      {/* suelo */}
      <ellipse cx="160" cy="236" rx="130" ry="8" fill="#000" opacity=".18" />
      {/* edificio */}
      <rect x="48" y="78" width="224" height="152" rx="10" fill="#F3E3C3" />
      <rect x="48" y="196" width="224" height="34" rx="6" fill="#611232" />
      {/* letrero */}
      <g className="a-letrero">
        <rect x="88" y="52" width="144" height="30" rx="8" fill="#235B4E" />
        <text x="160" y="72" textAnchor="middle" fontSize="15" fontWeight="800" letterSpacing="2" fill="#BC955C">TORTILLERÍA</text>
      </g>
      {/* toldo */}
      <g className="a-toldo">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect key={i} x={36 + i * 31} y="92" width="31" height="30" fill={i % 2 ? "#FFFFFF" : "#9D2449"} />
        ))}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <circle key={i} cx={51.5 + i * 31} cy="122" r="15.5" fill={i % 2 ? "#FFFFFF" : "#9D2449"} />
        ))}
      </g>
      {/* mostrador y comal */}
      <rect x="70" y="170" width="180" height="14" rx="4" fill="#BC955C" />
      <ellipse cx="160" cy="168" rx="58" ry="9" fill="#2a2a2a" />
      {/* vapor */}
      <g fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity="0">
        <path className="a-vapor" style={{ animationDelay: "0s" }} d="M132 150c-8-10 8-16 0-28" />
        <path className="a-vapor" style={{ animationDelay: ".7s" }} d="M160 150c-8-10 8-16 0-28" />
        <path className="a-vapor" style={{ animationDelay: "1.4s" }} d="M188 150c-8-10 8-16 0-28" />
      </g>
      {/* tortillas */}
      <g>
        <ellipse cx="136" cy="164" rx="26" ry="6.5" fill="#EBD29C" />
        <ellipse cx="184" cy="164" rx="26" ry="6.5" fill="#F3E3C3" />
        <g className="a-volteo">
          <ellipse cx="160" cy="150" rx="28" ry="8" fill="#F8EBCB" />
          <circle cx="150" cy="149" r="2" fill="#BC955C" />
          <circle cx="168" cy="152" r="2.2" fill="#BC955C" />
          <circle cx="160" cy="147" r="1.6" fill="#BC955C" />
        </g>
      </g>
      {/* puerta */}
      <rect x="146" y="196" width="28" height="34" rx="4" fill="#9D2449" opacity=".0" />
    </svg>
  );
}

export default function Inicio({ alRegistrar, alIniciar }: { alRegistrar: () => void; alIniciar: () => void }) {
  return (
    <div className="relative mx-auto flex h-dvh max-w-xl flex-col overflow-hidden bg-gradient-to-b from-guinda-oscuro via-guinda to-guinda-oscuro px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] text-white">
      <div className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-dorado/15 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -right-20 bottom-10 h-64 w-64 rounded-full bg-verde/30 blur-3xl" aria-hidden />

      <div className="a-entra relative" style={{ animationDelay: ".05s" }}>
        <LogoGobierno />
      </div>

      <div className="a-entra relative flex min-h-0 flex-1 items-center justify-center py-2" style={{ animationDelay: ".25s" }}>
        <Tortilleria />
      </div>

      <div className="relative text-center">
        <h1 className="a-entra text-4xl font-extrabold tracking-tight" style={{ animationDelay: "1.1s" }}>
          Tortillerías<span className="text-dorado">MX</span>
        </h1>
        <p className="a-entra mx-auto mt-1.5 max-w-[17rem] text-sm leading-snug text-white/80" style={{ animationDelay: "1.3s" }}>
          Registro nacional del precio de la tortilla
        </p>
      </div>

      <div className="relative mt-5 space-y-2.5">
        <button
          onClick={alRegistrar}
          className="a-entra flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-white text-base font-bold text-guinda shadow-xl shadow-black/20 transition active:scale-[.97]"
          style={{ animationDelay: "1.6s" }}
        >
          <ClipboardPlus className="h-5 w-5" aria-hidden /> Registrar
        </button>
        <button
          onClick={alIniciar}
          className="a-entra flex min-h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-white/10 text-base font-semibold text-white ring-1 ring-white/30 backdrop-blur transition active:scale-[.97]"
          style={{ animationDelay: "1.8s" }}
        >
          <LogIn className="h-5 w-5" aria-hidden /> Iniciar sesión
        </button>
      </div>
    </div>
  );
}
