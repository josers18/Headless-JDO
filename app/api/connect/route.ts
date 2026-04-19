import { NextResponse } from "next/server";
import { buildAuthorizeUrl, generatePkce } from "@/lib/salesforce/oauth";
import { cookies } from "next/headers";
import crypto from "node:crypto";

// /api/connect — kicks off the PKCE OAuth handshake. The path is
// intentionally neutral. An earlier iteration lived at
// /api/auth/salesforce/login, which Chrome Safe Browsing classified as a
// phishing URL because the path plus the "Sign in with Salesforce" CTA on a
// non-salesforce.com host matches the exact fingerprint of a credential-
// harvesting relay. The handshake behavior is identical; only the name
// changed.
export const runtime = "nodejs";

export async function GET() {
  const state = crypto.randomBytes(16).toString("hex");
  const { verifier, challenge } = generatePkce();

  const jar = cookies();
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  };
  jar.set("hz_oauth_state", state, cookieOpts);
  jar.set("hz_oauth_verifier", verifier, cookieOpts);

  return NextResponse.redirect(
    buildAuthorizeUrl({ state, codeChallenge: challenge })
  );
}
