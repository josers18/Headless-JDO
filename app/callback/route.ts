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
import { persistTokenFromOAuthResponse } from "@/lib/salesforce/token";
import { cookies } from "next/headers";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// On Heroku the App Router hands us a NextRequest whose `url` is the
// *internal* dyno URL (http://localhost:$PORT/callback). Constructing
// redirect URLs off that field sends the browser to localhost after a
// successful OAuth round-trip — exactly the misbehavior seen in prod.
// We derive the public origin from SF_REDIRECT_URI (authoritative: this
// is the exact origin Salesforce was told to call back to and the ECA
// whitelists), falling back to x-forwarded-* headers, and use req.url
// only as a last resort.
function publicOrigin(req: NextRequest): string {
  const rurl = process.env.SF_REDIRECT_URI;
  if (rurl) {
    try {
      return new URL(rurl).origin;
    } catch {
      // fall through
    }
  }
  const xfh = req.headers.get("x-forwarded-host");
  const xfp = req.headers.get("x-forwarded-proto") ?? "https";
  if (xfh) return `${xfp}://${xfh}`;
  return new URL(req.url).origin;
}

export async function GET(req: NextRequest) {
  const origin = publicOrigin(req);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    log.error("sf.oauth.error", {
      error,
      desc: url.searchParams.get("error_description"),
    });
    return NextResponse.redirect(new URL("/?auth=error", origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?auth=missing_code", origin));
  }

  const jar = await cookies();
  const expectedState = jar.get("hz_oauth_state")?.value;
  const verifier = jar.get("hz_oauth_verifier")?.value;

  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(new URL("/?auth=bad_state", origin));
  }
  if (!verifier) {
    return NextResponse.redirect(new URL("/?auth=missing_verifier", origin));
  }

  jar.delete("hz_oauth_state");
  jar.delete("hz_oauth_verifier");

  try {
    const token = await exchangeCodeForToken({
      code,
      codeVerifier: verifier,
    });
    await persistTokenFromOAuthResponse(token);
    log.info("sf.oauth.success", { scope: token.scope });
    return NextResponse.redirect(new URL("/", origin));
  } catch (e) {
    log.error("sf.oauth.exchange.failed", { err: String(e) });
    return NextResponse.redirect(new URL("/?auth=exchange_failed", origin));
  }
}
