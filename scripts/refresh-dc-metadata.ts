/**
 * scripts/refresh-dc-metadata.ts
 *
 * Scheduled job (Heroku Scheduler, every 12h) that refreshes the
 * Data Cloud metadata cache in Redis so per-turn agent runs don't
 * each need to call `get_dc_metadata` (5.5MB payload) and don't get
 * caught out by the 64KB modelText truncation.
 *
 * Flow:
 *   1. Connect to data_360 MCP. Call get_dc_metadata once.
 *   2. Parse the full catalog (typically ~1000 DMOs, 5MB+).
 *   3. For each DMO, run SELECT COUNT(*) in parallel batches. Drop
 *      DMOs with 0 rows or count-query errors. Record rowCount.
 *   4. Project each surviving DMO down to the minimum shape the
 *      agent preflight needs: { name, displayName, category, rowCount,
 *      fields: [{name, ty}] } where ty is our compact 1-char kind.
 *   5. Write to Redis:
 *        dc:metadata:v1:default  → JSON.stringify({ generatedAt, dmos })
 *        TTL: 13h (buffer past the 12h schedule)
 *
 * Runtime impact:
 *   - One-time 5.5MB fetch per refresh (scheduler host, not a web dyno)
 *   - ~1000 small COUNT(*) queries, batched 20 at a time. At ~1s per
 *     query that's ~50s wall clock. Safe on a scheduler dyno (H13 is
 *     only on web dynos, not one-off scheduler runs).
 *
 * Manual run:     npx tsx scripts/refresh-dc-metadata.ts
 * Scheduled run:  (set via `heroku addons:open scheduler`, same command)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MCP_URLS } from "../lib/mcp/urls";
import { getRedis } from "../lib/redis";
import { log } from "../lib/log";
import {
  classifyDcFieldKind,
  dcFieldKindToCompactTy,
} from "../lib/llm/dataCloudSchema";

// --- config ---

const DATASPACE = process.env.DC_METADATA_DATASPACE ?? "default";
const REDIS_KEY = `dc:metadata:v1:${DATASPACE}`;
const TTL_SECONDS = 13 * 60 * 60; // 13h — buffer past the 12h cadence

// COUNT(*) probing configuration. Batches parallelize on the DC query
// engine; we keep it modest to avoid throttling. Error + 0-row DMOs are
// dropped from the surviving list.
const COUNT_BATCH_SIZE = 20;
const COUNT_BATCH_PAUSE_MS = 150; // brief yield between batches

// Per-call timeout — matches the app's client.ts ceilings.
const METADATA_TIMEOUT_MS = 30_000;
const COUNT_TIMEOUT_MS = 8_000;

// --- types ---

interface DmoRaw {
  name?: string;
  displayName?: string;
  category?: string;
  fields?: Array<{ name?: string; type?: string; displayName?: string }>;
}

interface DmoProjected {
  name: string;
  displayName?: string;
  category?: string;
  rowCount: number;
  fields: Array<{ name: string; ty?: string }>;
}

interface CacheEnvelope {
  /** ISO 8601 timestamp of when this cache was written. */
  generatedAt: string;
  /** Dataspace this catalog is for (typically "default"). */
  dataspace: string;
  /** Total DMOs returned by get_dc_metadata before filtering. */
  totalDmos: number;
  /** DMOs with ≥ 1 row OR a successful count (survivors of filtering). */
  survivingDmos: number;
  /** DMOs dropped because COUNT(*) returned 0. */
  emptyDmos: number;
  /** DMOs dropped because COUNT(*) errored. */
  errorDmos: number;
  /** The projected catalog, ordered by rowCount desc. */
  dmos: DmoProjected[];
}

// --- main ---

async function main() {
  const start = Date.now();
  console.log(
    `[refresh-dc-metadata] starting for dataspace=${DATASPACE}`
  );

  const token = process.env.SF_ACCESS_TOKEN;
  if (!token) {
    console.error(
      "SF_ACCESS_TOKEN missing — cannot refresh Data Cloud metadata"
    );
    process.exit(1);
  }

  const redis = getRedis();
  if (!redis) {
    console.error("REDIS_URL missing — cannot cache Data Cloud metadata");
    process.exit(1);
  }

  // 1. Connect to data_360 MCP.
  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_URLS.data_360),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
      },
    }
  );
  const client = new Client(
    { name: "horizon-refresh-dc", version: "0.1.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  console.log(`[refresh-dc-metadata] connected to data_360 in ${Date.now() - start}ms`);

  try {
    // 2. Call get_dc_metadata with a generous timeout.
    const metaCtl = new AbortController();
    const metaTimer = setTimeout(
      () => metaCtl.abort(),
      METADATA_TIMEOUT_MS
    );
    let raw: Awaited<ReturnType<typeof client.callTool>>;
    try {
      raw = await client.callTool(
        { name: "get_dc_metadata", arguments: { dataspace: DATASPACE } },
        undefined,
        { timeout: METADATA_TIMEOUT_MS, signal: metaCtl.signal }
      );
    } finally {
      clearTimeout(metaTimer);
    }

    const rawText = extractText(raw.content);
    const parsed = JSON.parse(rawText);
    const rows: DmoRaw[] = Array.isArray(parsed?.metadata)
      ? parsed.metadata
      : [];
    console.log(
      `[refresh-dc-metadata] catalog fetched — ${rows.length} DMOs, raw size ${(rawText.length / 1024 / 1024).toFixed(2)}MB`
    );

    // 3. COUNT(*) probe each DMO in batches.
    const probedStart = Date.now();
    const survived: DmoProjected[] = [];
    let emptyCount = 0;
    let errorCount = 0;
    let progressCount = 0;

    for (let i = 0; i < rows.length; i += COUNT_BATCH_SIZE) {
      const batch = rows.slice(i, i + COUNT_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (r) => {
          if (!r.name) return { r, count: null as number | null, err: null };
          const count = await probeCount(client, r.name);
          return { r, count: count.count, err: count.err };
        })
      );
      for (const { r, count, err } of results) {
        progressCount++;
        if (err || !r.name) {
          errorCount++;
          continue;
        }
        if (count === null) {
          errorCount++;
          continue;
        }
        if (count === 0) {
          emptyCount++;
          continue;
        }
        survived.push(projectDmo(r, count));
      }
      // Periodic progress log.
      if (i % (COUNT_BATCH_SIZE * 10) === 0) {
        console.log(
          `[refresh-dc-metadata] probed ${progressCount}/${rows.length} (survived=${survived.length}, empty=${emptyCount}, err=${errorCount})`
        );
      }
      if (COUNT_BATCH_PAUSE_MS > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, COUNT_BATCH_PAUSE_MS)
        );
      }
    }
    console.log(
      `[refresh-dc-metadata] count-probing done in ${Date.now() - probedStart}ms — survived=${survived.length}, empty=${emptyCount}, error=${errorCount}`
    );

    // Sort by rowCount desc so the most-populated DMOs surface first.
    survived.sort((a, b) => b.rowCount - a.rowCount);

    // 4. Write to Redis.
    const envelope: CacheEnvelope = {
      generatedAt: new Date().toISOString(),
      dataspace: DATASPACE,
      totalDmos: rows.length,
      survivingDmos: survived.length,
      emptyDmos: emptyCount,
      errorDmos: errorCount,
      dmos: survived,
    };
    const serialized = JSON.stringify(envelope);
    await redis.set(REDIS_KEY, serialized, "EX", TTL_SECONDS);
    console.log(
      `[refresh-dc-metadata] wrote ${(serialized.length / 1024).toFixed(1)}KB to ${REDIS_KEY} (ttl ${TTL_SECONDS}s)`
    );

    log.info("dc.metadata.refresh.ok", {
      total: rows.length,
      survived: survived.length,
      empty: emptyCount,
      error: errorCount,
      bytes: serialized.length,
      duration_ms: Date.now() - start,
    });
  } finally {
    await client.close().catch(() => {});
    await redis.quit().catch(() => {});
  }
}

// --- helpers ---

async function probeCount(
  client: Client,
  dmoName: string
): Promise<{ count: number | null; err: string | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), COUNT_TIMEOUT_MS);
  try {
    const res = await client.callTool(
      {
        name: "post_dc_query_sql",
        arguments: {
          dataspace: DATASPACE,
          sql: `SELECT COUNT(*) AS total FROM ${dmoName} LIMIT 1`,
        },
      },
      undefined,
      { timeout: COUNT_TIMEOUT_MS, signal: ctl.signal }
    );
    if (res.isError) return { count: null, err: "isError" };
    const text = extractText(res.content);
    // Response shape observed in live probe:
    //   {"defaultExc":"{\"data\":[[159]],\"metadata\":[...],\"responseCode\":201.0}", ...}
    // Sometimes the outer is already parsed; sometimes it's a string-in-string.
    let outer: unknown;
    try {
      outer = JSON.parse(text);
    } catch {
      return { count: null, err: "bad outer JSON" };
    }
    const defaultExc = (outer as { defaultExc?: string })?.defaultExc;
    let inner: unknown = outer;
    if (typeof defaultExc === "string") {
      try {
        inner = JSON.parse(defaultExc);
      } catch {
        return { count: null, err: "bad inner JSON" };
      }
    }
    const data = (inner as { data?: unknown[][] })?.data;
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      return { count: null, err: "no data rows" };
    }
    const first = data[0][0];
    const count = typeof first === "number" ? first : Number(first);
    if (Number.isNaN(count)) return { count: null, err: "count not numeric" };
    return { count, err: null };
  } catch (e) {
    return {
      count: null,
      err: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

function projectDmo(r: DmoRaw, rowCount: number): DmoProjected {
  const fields: DmoProjected["fields"] = [];
  for (const f of r.fields ?? []) {
    if (!f.name) continue;
    const kind = classifyDcFieldKind(f.type);
    const ty = dcFieldKindToCompactTy(kind);
    fields.push(ty ? { name: f.name, ty } : { name: f.name });
  }
  return {
    name: r.name ?? "",
    displayName: r.displayName,
    category: r.category,
    rowCount,
    fields,
  };
}

function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const p of content) {
    const piece = p as { type?: string; text?: string };
    if (piece?.type === "text" && typeof piece.text === "string") {
      parts.push(piece.text);
    }
  }
  return parts.join("\n");
}

main().catch((err) => {
  console.error("[refresh-dc-metadata] FAILED:", err);
  process.exit(1);
});
