import Link from "next/link";
import { ArrowUpRight, LogIn } from "lucide-react";

// Signed-out banner. Server-renders when no hz_sf cookie is present so the
// banker doesn't watch a cascade of 401s from every section on the home
// page. One click → PKCE OAuth handshake at /api/auth/salesforce/login.
export function SignInBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border-soft bg-surface p-8">
      <div
        className="pointer-events-none absolute inset-0 bg-hero-glow drift"
        aria-hidden
      />
      <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
        <div className="max-w-[520px]">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-accent">
            <span className="inline-block h-[6px] w-[6px] rounded-full bg-accent animate-glow-pulse" />
            Sign in required
          </div>
          <h3 className="mt-3 font-display text-[24px] leading-tight tracking-tight text-text md:text-[28px]">
            Connect Salesforce to wake up Horizon.
          </h3>
          <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
            One PKCE handshake unlocks the morning brief, priority queue,
            portfolio pulse, live signals, and one-click drafts — all powered
            by the three Salesforce hosted MCP servers.
          </p>
        </div>
        <Link
          href="/api/auth/salesforce/login"
          className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-accent-sheen px-5 py-2.5 text-[13px] font-medium text-bg shadow-glow transition hover:shadow-glow-2"
        >
          <LogIn size={14} strokeWidth={2.4} />
          Sign in with Salesforce
          <ArrowUpRight size={14} strokeWidth={2.4} className="opacity-70" />
          <span className="sheen-overlay" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
