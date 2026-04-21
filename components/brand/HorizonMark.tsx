/**
 * HorizonMark — the product wordmark.
 *
 * Reads "Cumulus Bank · Horizon" to anchor the product inside its
 * demo-tenant context. The tenant label de-emphasizes (muted text +
 * thin separator) so the eye still lands on "Horizon" as the product.
 * If Institution Demo Mode swaps tenants at runtime, the overlay
 * (InstitutionDemoMode) calls out the swap — this wordmark stays on
 * the home tenant to keep a stable brand anchor.
 */
export function HorizonMark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="relative inline-flex h-[26px] w-[26px] items-center justify-center">
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
      <span className="font-display text-[13px] leading-tight tracking-tight sm:text-[15px] md:text-[16px]">
        <span className="text-text-muted">Cumulus Bank</span>
        <span className="mx-1.5 text-text-muted/50" aria-hidden>
          ·
        </span>
        <span className="text-text">Horizon</span>
      </span>
    </div>
  );
}
