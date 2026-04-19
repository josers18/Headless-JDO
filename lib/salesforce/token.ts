import { cookies } from "next/headers";
import { refreshAccessToken, type SfTokenResponse } from "./oauth";

const COOKIE_NAME = "hz_sf";
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours, matches typical SF token lifetime

export interface StoredToken {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  issued_at: number;
  user_id?: string;
}

// NOTE: For MVP we stash the token in an httpOnly cookie (short TTL). For
// production we'd move this to the Postgres `sessions` table keyed by a
// rotating session id. See lib/db/schema.sql.
export function setTokenCookie(token: SfTokenResponse) {
  const jar = cookies();
  const payload: StoredToken = {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    instance_url: token.instance_url,
    issued_at: Number(token.issued_at),
    user_id: token.id.split("/").pop(),
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

export async function ensureFreshToken(): Promise<StoredToken | null> {
  const current = getTokenCookie();
  if (!current) return null;
  const ageMs = Date.now() - current.issued_at;
  // Refresh proactively when the token is older than 45 minutes.
  const FORTY_FIVE_MIN = 45 * 60 * 1000;
  if (ageMs < FORTY_FIVE_MIN || !current.refresh_token) return current;
  try {
    const refreshed = await refreshAccessToken(current.refresh_token);
    setTokenCookie(refreshed);
    return {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? current.refresh_token,
      instance_url: refreshed.instance_url,
      issued_at: Number(refreshed.issued_at),
      user_id: refreshed.id.split("/").pop(),
    };
  } catch {
    return current;
  }
}
