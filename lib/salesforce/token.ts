import { cookies } from "next/headers";
import { refreshAccessToken, type SfTokenResponse } from "./oauth";
import { optionalEnv } from "@/lib/utils";

const COOKIE_NAME = "hz_sf";
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours, matches typical SF token lifetime

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  issued_at: number;
  user_id?: string;
  /**
   * Cached once at OAuth write / refresh via GET on the token response's
   * `id` URL (Salesforce identity). Not refetched on every page render.
   */
  banker_display_name?: string;
  banker_email?: string;
}

async function fetchSalesforceIdentity(
  accessToken: string,
  identityUrl: string
): Promise<{ display_name?: string; email?: string }> {
  try {
    const res = await fetch(identityUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return {};
    const j = (await res.json()) as Record<string, unknown>;
    const display_name =
      typeof j.display_name === "string"
        ? j.display_name
        : typeof j.name === "string"
          ? j.name
          : undefined;
    const email =
      typeof j.email === "string"
        ? j.email
        : typeof j.username === "string" && j.username.includes("@")
          ? j.username
          : typeof j.preferred_username === "string"
            ? j.preferred_username
            : undefined;
    return { display_name, email };
  } catch {
    return {};
  }
}

/**
 * Writes `hz_sf` after code exchange or refresh. One GET to the
 * Salesforce identity URL (`id` on the token response) populates
 * banker_display_name / banker_email — cached in the httpOnly cookie,
 * not loaded per render.
 */
export async function persistTokenFromOAuthResponse(
  token: SfTokenResponse,
  previous?: StoredToken | null
): Promise<void> {
  const jar = cookies();
  const identity = await fetchSalesforceIdentity(
    token.access_token,
    token.id
  );
  const payload: StoredToken = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    instance_url: token.instance_url,
    issued_at: Number(token.issued_at),
    user_id: token.id.split("/").pop(),
    banker_display_name:
      identity.display_name?.trim() ||
      previous?.banker_display_name?.trim(),
    banker_email: identity.email?.trim() || previous?.banker_email?.trim(),
  };
  jar.set(COOKIE_NAME, JSON.stringify(payload), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function getTokenCookie(): StoredToken | null {
  const raw = cookies().get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredToken;
  } catch {
    return null;
  }
}

export function clearTokenCookie() {
  cookies().delete(COOKIE_NAME);
}

/**
 * Display name for agent prompts (morning brief, insights, prep). Prefers
 * Salesforce identity from the session cookie (OAuth `id` URL) over
 * `DEMO_BANKER_NAME` so copy matches the signed-in user, not demo env.
 */
export function resolveBankerDisplayName(token: StoredToken | null): string {
  const envName = optionalEnv("DEMO_BANKER_NAME", "").trim();
  return (
    (token?.banker_display_name && token.banker_display_name.trim()) ||
    envName ||
    "there"
  );
}

/** Server-only: banker row for the signed-in header user menu. */
export function getBankerMenuProfile(): { name: string; email: string } {
  const t = getTokenCookie();
  const envEmail = optionalEnv("DEMO_BANKER_EMAIL", "").trim();
  const raw = resolveBankerDisplayName(t);
  const name = raw === "there" ? "Banker" : raw;
  const email =
    (t?.banker_email && t.banker_email.trim()) || envEmail || "\u2014";
  return { name, email };
}

export async function ensureFreshToken(): Promise<StoredToken | null> {
  const current = getTokenCookie();
  if (!current) return null;
  const ageMs = Date.now() - current.issued_at;
  // Refresh proactively when the token is older than 45 minutes.
  const FORTY_FIVE_MIN = 45 * 60 * 1000;
  if (ageMs < FORTY_FIVE_MIN || !current.refresh_token) return current;
  try {
    const refreshed = await refreshAccessToken(current.refresh_token);
    await persistTokenFromOAuthResponse(refreshed, current);
    return getTokenCookie() ?? current;
  } catch {
    return current;
  }
}
