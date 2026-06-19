/**
 * scripts/verify-token-usage-db.ts — applies schema, writes sample rows,
 * verifies summarizeSessionUsage grouping + exact logic, then cleans up.
 * Run: npx tsx --env-file=.env scripts/verify-token-usage-db.ts
 * Requires DATABASE_URL (a local/dev Postgres).
 */
export {};

import { Client } from "pg";
import { readFileSync } from "fs";
import { join } from "path";
import {
  recordTokenUsage,
  summarizeSessionUsage,
} from "../lib/db/tokenUsage";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(2);
  }
  // Apply schema (idempotent).
  const sql = readFileSync(join(__dirname, "..", "lib", "db", "schema.sql"), "utf8");
  const c = new Client({
    connectionString: url,
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await c.connect();
  await c.query(sql);

  const sid = `verify-${Date.now()}`;
  let failures = 0;
  const check = (n: string, ok: boolean) => {
    console.log(`${ok ? "ok" : "FAIL"}: ${n}`);
    if (!ok) failures++;
  };

  try {
    await recordTokenUsage({ userId: "u1", sessionId: sid, route: "ask", model: "claude-4-5-sonnet", inputTokens: 100, outputTokens: 40, exact: true });
    await recordTokenUsage({ userId: "u1", sessionId: sid, route: "brief", model: "claude-4-5-sonnet", inputTokens: 50, outputTokens: 10, exact: false });
    await recordTokenUsage({ userId: "u1", sessionId: sid, route: "ask-data", model: "kimi-k2-thinking", inputTokens: 200, outputTokens: 80, exact: true });

    const s = await summarizeSessionUsage(sid);
    const claude = s.models.find((m) => m.model === "claude-4-5-sonnet");
    const kimi = s.models.find((m) => m.model === "kimi-k2-thinking");

    check("two models grouped", s.models.length === 2);
    check("claude input summed", claude?.inputTokens === 150);
    check("claude output summed", claude?.outputTokens === 50);
    check("claude exact=false (one estimated run)", claude?.exact === false);
    check("kimi exact=true", kimi?.exact === true);
    check("grand total input", s.totals.inputTokens === 350);
    check("grand total output", s.totals.outputTokens === 130);
    check("grand total exact=false", s.totals.exact === false);

    const empty = await summarizeSessionUsage(`nonexistent-${Date.now()}`);
    check("empty session: no models", empty.models.length === 0);
    check("empty session: totals zero", empty.totals.inputTokens === 0 && empty.totals.outputTokens === 0);
    check("empty session: exact=true default", empty.totals.exact === true);
  } finally {
    await c.query("delete from token_usage where session_id = $1", [sid]);
    await c.end();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall token-usage-db checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
