import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearTokenCookie } from "@/lib/salesforce/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicOrigin(req: NextRequest): string {
  const rurl = process.env.SF_REDIRECT_URI;
  if (rurl) {
    try {
      return new URL(rurl).origin;
    } catch {
      /* fall through */
    }
  }
  const xfh = req.headers.get("x-forwarded-host");
  const xfp = req.headers.get("x-forwarded-proto") ?? "https";
  if (xfh) return `${xfp}://${xfh}`;
  return new URL(req.url).origin;
}

/**
 * Clears the Salesforce session cookie (no remote revoke — demo scope).
 * PKCE verifier cookies are cleared defensively. Redirects to `/`.
 */
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  clearTokenCookie();
  const jar = cookies();
  jar.delete("hz_oauth_state");
  jar.delete("hz_oauth_verifier");
  return NextResponse.redirect(new URL("/", origin));
}
