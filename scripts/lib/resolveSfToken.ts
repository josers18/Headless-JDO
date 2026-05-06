/**
 * Token resolver for refresh scripts running in three contexts:
 *
 *   1. Local dev: `SF_ACCESS_TOKEN` populated via `.env` (sf:login or
 *      manual paste). Just use it.
 *   2. Heroku admin route: spawns the script with `SF_ACCESS_TOKEN`
 *      env var set to the live banker session token. Same as case 1.
 *   3. Heroku Scheduler: no SF_ACCESS_TOKEN env var, no banker session.
 *      Look at `SF_REFRESH_TOKEN` config var (designated service
 *      principal) first; fall back to `scheduler_credentials` row in
 *      Postgres (last-good banker login). Exchange for a fresh
 *      access token via OAuth refresh-token grant and use that.
 *
 * Returns an access_token string. Callers don't need to know which
 * path produced it.
 */

import { refreshAccessToken } from "@/lib/salesforce/oauth";
import { loadSchedulerCredentials } from "@/lib/db/schedulerCreds";

export async function resolveSalesforceAccessToken(): Promise<{
  access_token: string;
  source: "env" | "config_refresh_token" | "scheduler_creds";
}> {
  const direct = process.env.SF_ACCESS_TOKEN?.trim();
  if (direct) return { access_token: direct, source: "env" };

  const configRefresh = process.env.SF_REFRESH_TOKEN?.trim();
  if (configRefresh) {
    const fresh = await refreshAccessToken(configRefresh);
    return {
      access_token: fresh.access_token,
      source: "config_refresh_token",
    };
  }

  const stored = await loadSchedulerCredentials();
  if (!stored) {
    throw new Error(
      "No SF token source available: SF_ACCESS_TOKEN unset, SF_REFRESH_TOKEN unset, scheduler_credentials row missing. Sign in once via /callback to seed scheduler_credentials, or set SF_REFRESH_TOKEN to a service-account refresh token."
    );
  }
  const fresh = await refreshAccessToken(stored.refresh_token);
  return {
    access_token: fresh.access_token,
    source: "scheduler_creds",
  };
}
