const SCENES = {
  Entrance: <EntranceScene />,
  Platform: <PlatformScene />,
  Desk: <DeskScene />,
} as const;

export function LoginFeedCard({ name, delay }: { name: keyof typeof SCENES; delay: string }) {
  return (
    <div className="animate-rmo-rise overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-2xl shadow-black/40 [animation-delay:320ms]">
      <div className="relative aspect-[4/3] overflow-hidden bg-zinc-950">
        {SCENES[name]}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0%,rgba(0,0,0,0.15)_50%,transparent_100%)] opacity-40" />
        <div
          className="pointer-events-none absolute inset-x-0 h-8 bg-gradient-to-b from-transparent via-orange-200/25 to-transparent animate-rmo-scan"
          style={{ animationDelay: delay }}
        />
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-zinc-200">
          <span className="size-1.5 rounded-full bg-red-500" />
          LIVE
        </span>
      </div>
      <p className="px-3 py-2 text-xs font-medium text-zinc-300">{name}</p>
    </div>
  );
}

function EntranceScene() {
  return (
    <svg viewBox="0 0 160 120" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="entrance-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#44403c" />
          <stop offset="100%" stopColor="#1c1917" />
        </linearGradient>
      </defs>
      <rect width="160" height="120" fill="url(#entrance-wall)" />
      <rect x="18" y="28" width="52" height="70" rx="2" fill="#292524" stroke="#57534e" />
      <rect x="28" y="40" width="32" height="22" fill="#0c4a6e" opacity="0.85" />
      <rect x="96" y="16" width="42" height="86" rx="2" fill="#0c0a09" stroke="#a8a29e" />
      <rect x="108" y="62" width="18" height="40" fill="#1c1917" />
      <circle cx="122" cy="82" r="1.6" fill="#fdba74" />
      <circle cx="46" cy="92" r="7" fill="#78716c" />
      <path d="M38 120 V100 h16 v20" fill="#57534e" />
      <rect x="0" y="108" width="160" height="12" fill="#0c0a09" />
    </svg>
  );
}

function PlatformScene() {
  return (
    <svg viewBox="0 0 160 120" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="platform-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="55%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#111827" />
        </linearGradient>
      </defs>
      <rect width="160" height="120" fill="url(#platform-sky)" />
      <rect x="0" y="46" width="160" height="18" fill="#334155" />
      <rect x="0" y="70" width="160" height="50" fill="#1e293b" />
      <path d="M70 120 L92 70 H108 L150 120 Z" fill="#64748b" />
      <path d="M78 120 L96 78 H104 L128 120 Z" fill="#0f172a" />
      <path d="M10 120 L70 70 H78 L40 120 Z" fill="#475569" />
      <rect x="18" y="28" width="36" height="22" rx="2" fill="#e2e8f0" opacity="0.9" />
      <rect x="22" y="32" width="28" height="4" fill="#0f172a" />
      <rect x="22" y="39" width="18" height="3" fill="#0f172a" />
      <circle cx="132" cy="22" r="6" fill="#fde68a" opacity="0.8" />
    </svg>
  );
}

function DeskScene() {
  return (
    <svg viewBox="0 0 160 120" className="h-full w-full" aria-hidden>
      <rect width="160" height="120" fill="#172033" />
      <rect x="28" y="16" width="104" height="72" rx="4" fill="#0f172a" stroke="#38bdf8" />
      <rect x="36" y="24" width="40" height="8" rx="1" fill="#1d4ed8" />
      <rect x="36" y="38" width="88" height="6" rx="1" fill="#1e3a5f" />
      <rect x="36" y="48" width="28" height="16" rx="2" fill="#2563eb" />
      <rect x="68" y="48" width="28" height="16" rx="2" fill="#1d4ed8" />
      <rect x="100" y="48" width="24" height="16" rx="2" fill="#0ea5e9" />
      <rect x="36" y="70" width="52" height="8" rx="1" fill="#334155" />
      <rect x="18" y="92" width="124" height="8" rx="2" fill="#334155" />
      <rect x="10" y="100" width="140" height="20" fill="#0b1220" />
    </svg>
  );
}
