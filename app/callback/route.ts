/**
 * /callback — OAuth return leg for the Salesforce External Client App.
 *
 * This path matches the ECA's whitelisted Callback URL
 * (http://localhost:3000/callback). The handshake is initiated from
 * /api/connect. /callback was chosen deliberately over paths containing
 * "salesforce" or "auth" so the URL doesn't trip Chrome Safe Browsing's
 * credential-phishing classifier on a *.herokuapp.com host.
 */

import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/salesforce/oauth";
import { setTokenCookie } from "@/lib/salesforce/token";
import { cookies } from "next/headers";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    log.error("sf.oauth.error", {
      error,
      desc: url.searchParams.get("error_description"),
    });
    return NextResponse.redirect(new URL("/?auth=error", req.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?auth=missing_code", req.url));
  }

  const jar = cookies();
  const expectedState = jar.get("hz_oauth_state")?.value;
  const verifier = jar.get("hz_oauth_verifier")?.value;

  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(new URL("/?auth=bad_state", req.url));
  }
  if (!verifier) {
    return NextResponse.redirect(new URL("/?auth=missing_verifier", req.url));
  }

  jar.delete("hz_oauth_state");
  jar.delete("hz_oauth_verifier");

  try {
    const token = await exchangeCodeForToken({
      code,
      codeVerifier: verifier,
    });
    setTokenCookie(token);
    log.info("sf.oauth.success", { scope: token.scope });
    return NextResponse.redirect(new URL("/", req.url));
  } catch (e) {
    log.error("sf.oauth.exchange.failed", { err: String(e) });
    return NextResponse.redirect(new URL("/?auth=exchange_failed", req.url));
  }
}
