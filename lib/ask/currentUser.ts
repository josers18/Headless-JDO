/**
 * Resolve the banker user-id owning an Ask My Data thread. Mirrors the
 * existing Today pattern used across 9 API routes — token.user_id first,
 * then DEMO_BANKER_USER_ID, then the string "unknown".
 *
 * Returns null when the caller is not signed in, so API routes can return
 * a clean 401 without fabricating an owner-id.
 */

import { ensureFreshToken } from "@/lib/salesforce/token";
import { optionalEnv } from "@/lib/utils";

export async function currentBankerUserId(): Promise<string | null> {
  const token = await ensureFreshToken();
  if (!token) return null;
  return token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown");
}
