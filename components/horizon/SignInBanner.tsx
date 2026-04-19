import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";

// Signed-out banner. Server-renders when no hz_sf cookie is present so the
// banker doesn't watch a cascade of 401s from every section on the home
// page. One click → PKCE OAuth handshake at /api/connect.
//
// Copy deliberately avoids the "Sign in with Salesforce" CTA string and the
// /api/auth/salesforce/login URL path, both of which Chrome Safe Browsing
// fingerprints as credential-phishing pages on non-salesforce.com hosts.
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
            Activation required
          </div>
          <h3 className="mt-3 font-display text-[24px] leading-tight tracking-tight text-text md:text-[28px]">
            Wake up Horizon.
          </h3>
          <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
            One PKCE handshake unlocks the morning brief, priority queue,
            portfolio pulse, live signals, and one-click drafts — all powered
            by three hosted MCP servers.
          </p>
        </div>
        <Link
          href="/api/connect"
          className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-accent-sheen px-5 py-2.5 text-[13px] font-medium text-bg shadow-glow transition hover:shadow-glow-2"
        >
          <Sparkles size={14} strokeWidth={2.4} />
          Activate Horizon
          <ArrowUpRight size={14} strokeWidth={2.4} className="opacity-70" />
          <span className="sheen-overlay" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
