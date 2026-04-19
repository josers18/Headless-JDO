import { NextResponse } from "next/server";
import { buildAuthorizeUrl, generatePkce } from "@/lib/salesforce/oauth";
import { cookies } from "next/headers";
import crypto from "node:crypto";

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
