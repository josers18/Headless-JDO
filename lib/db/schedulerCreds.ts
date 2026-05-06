/**
 * Scheduler credentials — a singleton Postgres row storing the refresh
 * token of the LAST successful banker login. Heroku Scheduler jobs
 * (refresh-dc-metadata, refresh-tableau-sdms) read it, exchange the
 * refresh_token for a fresh access_token, and run the cache refresh
 * with that.
 *
 * "Last-good" beats "first-ever" because refresh tokens get revoked
 * (logout, deactivation, idle-revoke window). Pinning the *first*
 * banker means the day they leave, the scheduler dies silently.
 * Last-good self-heals — whoever logged in most recently keeps the
 * cache alive.
 *
 * For production rollout, swap to a designated service-account
 * refresh token in a config var (`SF_REFRESH_TOKEN`). The scripts
 * prefer that env var when set; otherwise they fall back to this row.
 */

import { Pool } from "pg";

let _pool: Pool | null = null;

function pool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _pool = new Pool({
    connectionString: url,
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 2,
  });
  return _pool;
}

export interface SchedulerCredentials {
  refresh_token: string;
  instance_url: string;
  sf_user_id: string | null;
  updated_at: Date;
}

export async function upsertSchedulerCredentials(args: {
  refresh_token: string;
  instance_url: string;
  sf_user_id?: string | null;
}): Promise<void> {
  await pool().query(
    `insert into scheduler_credentials (id, refresh_token, instance_url, sf_user_id, updated_at)
     values (1, $1, $2, $3, now())
     on conflict (id) do update set
       refresh_token = excluded.refresh_token,
       instance_url  = excluded.instance_url,
       sf_user_id    = excluded.sf_user_id,
       updated_at    = excluded.updated_at`,
    [args.refresh_token, args.instance_url, args.sf_user_id ?? null]
  );
}

export async function loadSchedulerCredentials(): Promise<SchedulerCredentials | null> {
  const { rows } = await pool().query<SchedulerCredentials>(
    `select refresh_token, instance_url, sf_user_id, updated_at
     from scheduler_credentials where id = 1`
  );
  return rows[0] ?? null;
}
