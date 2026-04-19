export function HorizonMark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="relative inline-flex h-[26px] w-[26px] items-center justify-center">
        {/* Soft accent halo behind the mark */}
        <span
          className="pointer-events-none absolute inset-0 rounded-full bg-accent/25 blur-[10px] animate-glow-pulse"
          aria-hidden
        />
        <svg
          width="22"
          height="22"
          viewBox="0 0 22 22"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
          className="relative z-[1]"
        >
          <defs>
            <linearGradient id="hz-ring" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#5B8DEF" />
              <stop offset="100%" stopColor="#A78BFA" />
            </linearGradient>
          </defs>
          <circle
            cx="11"
            cy="11"
            r="10"
            stroke="url(#hz-ring)"
            strokeWidth="1.25"
          />
          <path
            d="M2 12.5 C 6 10, 10 10, 14 12 S 20 14, 20 14"
            stroke="url(#hz-ring)"
            strokeWidth="1.25"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </span>
      <span className="font-display text-[15px] tracking-tight text-text">
        Horizon
      </span>
    </div>
  );
}
