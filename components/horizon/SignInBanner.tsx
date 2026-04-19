import Link from "next/link";
import { LogIn } from "lucide-react";

// Signed-out banner. Server-renders when no hz_sf cookie is present so the
// banker doesn't watch a cascade of 401s from every section on the home
// page. One click → PKCE OAuth handshake at /api/auth/salesforce/login.
export function SignInBanner() {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-accent/30 bg-accent/5 px-5 py-4">
      <div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-accent">
          Sign in required
        </div>
        <p className="mt-1 text-[14px] text-text">
          Connect Salesforce to unlock the morning brief, priority queue, and
          drafts.
        </p>
      </div>
      <Link
        href="/api/auth/salesforce/login"
        className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-bg transition duration-fast hover:opacity-90"
      >
        <LogIn size={14} />
        Sign in
      </Link>
    </div>
  );
}
