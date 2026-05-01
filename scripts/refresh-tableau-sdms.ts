/**
 * scripts/refresh-tableau-sdms.ts
 *
 * Scheduled companion to refresh-dc-metadata.ts. Every 12h:
 *   1. Calls list_semantic_models on tableau_next (unfiltered — categories
 *      are empty on every real model in this org, so filters return zero).
 *   2. Drops internal models (Agentforce_*, Data_Mask, Test_*, GenAI_*,
 *      Platform_Events) that aren't banker-relevant.
 *   3. For each survivor, calls get_semantic_model to enrich with the
 *      semanticDataObjects -> semanticDimensions / semanticMeasurements
 *      shape. That's what the model needs to write targeted analyze_data
 *      utterances instead of asking vague "show me sales" questions.
 *   4. Writes to Redis at tableau:sdms:v1:default with 13h TTL.
 *
 * Runtime impact: 1 list call + N get_semantic_model calls (N ≈ 10 for
 * banker-relevant filter). Total ~15s on the scheduler dyno. Cheap.
 *
 * Manual run:      npm run refresh:tableau-sdms
 * Scheduled run:   heroku addons:open scheduler → add this command
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MCP_URLS } from "../lib/mcp/urls";
import { getRedis } from "../lib/redis";
import { log } from "../lib/log";

// --- config ---

const DATASPACE = process.env.TABLEAU_SDM_DATASPACE ?? "default";
const REDIS_KEY = `tableau:sdms:v1:${DATASPACE}`;
const TTL_SECONDS = 13 * 60 * 60;

// Same cadence-gating pattern as refresh-dc-metadata.ts. Scheduler's
// smallest preset is hourly; we skip when the cache is < MIN_AGE_HOURS old.
const MIN_AGE_HOURS = Number(
  process.env.TABLEAU_SDM_MIN_AGE_HOURS ?? "12"
);
const FORCE = process.env.TABLEAU_SDM_FORCE === "1";

const LIST_TIMEOUT_MS = 15_000;
const GET_TIMEOUT_MS = 15_000;

// Regex matching SDM names that are CLEARLY internal/infrastructure and
// not useful to a relationship banker. Case-insensitive.
const EXCLUDE_SDM_RE =
  /^(Agentforce_|sfm_Agentforce_|Employee_Agent_|Service_Agent_|Data_Mask|Test_|GenAI_|Platform_Events|Agentforce_Analytics|Agentforce_Interactions)/i;

// --- types ---

interface RawSdmListItem {
  id?: string;
  apiName?: string;
  label?: string;
  description?: string;
  dataspace?: string;
  categories?: string[];
}

interface CachedDataObject {
  apiName: string;
  label?: string;
  dimensions: Array<{ apiName: string; label?: string }>;
  measurements: Array<{ apiName: string; label?: string }>;
}

interface CachedSdm {
  apiName: string;
  label?: string;
  description?: string;
  dataspace?: string;
  dataObjects: CachedDataObject[];
  metrics: Array<{ apiName: string; label?: string; description?: string }>;
}

interface CacheEnvelope {
  generatedAt: string;
  dataspace: string;
  totalSdms: number;
  survivingSdms: number;
  excludedSdms: number;
  sdms: CachedSdm[];
}

// --- main ---

async function main() {
  const start = Date.now();
  console.log(`[refresh-tableau-sdms] starting for dataspace=${DATASPACE}`);

  const token = process.env.SF_ACCESS_TOKEN;
  if (!token) {
    console.error("SF_ACCESS_TOKEN missing");
    process.exit(1);
  }

  const redis = getRedis();
  if (!redis) {
    console.error("REDIS_URL missing");
    process.exit(1);
  }

  // Early exit if cache is still fresh.
  if (!FORCE) {
    try {
      const existing = await redis.get(REDIS_KEY);
      if (existing) {
        const parsed = JSON.parse(existing) as { generatedAt?: string };
        const generated = parsed.generatedAt
          ? new Date(parsed.generatedAt).getTime()
          : 0;
        const ageHours = (Date.now() - generated) / (1000 * 60 * 60);
        if (generated > 0 && ageHours < MIN_AGE_HOURS) {
          console.log(
            `[refresh-tableau-sdms] cache is ${ageHours.toFixed(1)}h old (< ${MIN_AGE_HOURS}h) — skipping. Set TABLEAU_SDM_FORCE=1 to bypass.`
          );
          await redis.quit().catch(() => {});
          return;
        }
      }
    } catch {
      // Freshness probe failed — fall through to a full refresh.
    }
  }

  // Connect to tableau_next MCP.
  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_URLS.tableau_next),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const client = new Client(
    { name: "horizon-refresh-tableau", version: "0.1.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  console.log(
    `[refresh-tableau-sdms] connected in ${Date.now() - start}ms`
  );

  try {
    // Step 1: unfiltered list_semantic_models.
    const listCtl = new AbortController();
    const listTimer = setTimeout(() => listCtl.abort(), LIST_TIMEOUT_MS);
    let listRes: Awaited<ReturnType<typeof client.callTool>>;
    try {
      listRes = await client.callTool(
        { name: "list_semantic_models", arguments: {} },
        undefined,
        { timeout: LIST_TIMEOUT_MS, signal: listCtl.signal }
      );
    } finally {
      clearTimeout(listTimer);
    }

    const listText = extractText(listRes.content);
    const listParsed = JSON.parse(listText);
    const allItems: RawSdmListItem[] = Array.isArray(listParsed?.items)
      ? listParsed.items
      : [];
    console.log(
      `[refresh-tableau-sdms] list_semantic_models returned ${allItems.length} SDMs`
    );

    // Step 2: filter out internal models.
    const kept = allItems.filter((it) => {
      const apiName = it.apiName ?? "";
      if (!apiName) return false;
      if (EXCLUDE_SDM_RE.test(apiName)) return false;
      return true;
    });
    const excluded = allItems.length - kept.length;
    console.log(
      `[refresh-tableau-sdms] kept ${kept.length}, excluded ${excluded}`
    );

    // Step 3: enrich each survivor with dimensions + measurements.
    const sdms: CachedSdm[] = [];
    for (const it of kept) {
      const apiName = it.apiName ?? "";
      if (!apiName) continue;
      const enriched = await enrichSdm(client, it);
      if (enriched) sdms.push(enriched);
    }

    // Step 4: write to Redis.
    const envelope: CacheEnvelope = {
      generatedAt: new Date().toISOString(),
      dataspace: DATASPACE,
      totalSdms: allItems.length,
      survivingSdms: sdms.length,
      excludedSdms: excluded,
      sdms,
    };
    const serialized = JSON.stringify(envelope);
    await redis.set(REDIS_KEY, serialized, "EX", TTL_SECONDS);
    console.log(
      `[refresh-tableau-sdms] wrote ${(serialized.length / 1024).toFixed(1)}KB to ${REDIS_KEY} (ttl ${TTL_SECONDS}s)`
    );

    log.info("tableau.sdms.refresh.ok", {
      total: allItems.length,
      survived: sdms.length,
      excluded,
      bytes: serialized.length,
      duration_ms: Date.now() - start,
    });
  } finally {
    await client.close().catch(() => {});
    await redis.quit().catch(() => {});
  }
}

// --- helpers ---

async function enrichSdm(
  client: Client,
  base: RawSdmListItem
): Promise<CachedSdm | null> {
  const apiName = base.apiName;
  if (!apiName) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GET_TIMEOUT_MS);
  try {
    const res = await client.callTool(
      {
        name: "get_semantic_model",
        arguments: { modelApiNameOrId: apiName },
      },
      undefined,
      { timeout: GET_TIMEOUT_MS, signal: ctl.signal }
    );
    if (res.isError) {
      console.warn(
        `[refresh-tableau-sdms] get_semantic_model error for ${apiName}`
      );
      return { ...projectBase(base), dataObjects: [], metrics: [] };
    }
    const text = extractText(res.content);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const dataObjects = projectDataObjects(
      Array.isArray(parsed.semanticDataObjects)
        ? (parsed.semanticDataObjects as unknown[])
        : []
    );
    const metrics = projectMetrics(
      Array.isArray(parsed.semanticMetrics)
        ? (parsed.semanticMetrics as unknown[])
        : []
    );
    return { ...projectBase(base), dataObjects, metrics };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[refresh-tableau-sdms] enrich failed for ${apiName}: ${msg.slice(0, 120)}`
    );
    return { ...projectBase(base), dataObjects: [], metrics: [] };
  } finally {
    clearTimeout(timer);
  }
}

function projectBase(base: RawSdmListItem): Omit<
  CachedSdm,
  "dataObjects" | "metrics"
> {
  return {
    apiName: base.apiName ?? "",
    label: base.label,
    description: base.description,
    dataspace: base.dataspace,
  };
}

function projectDataObjects(raw: unknown[]): CachedDataObject[] {
  const out: CachedDataObject[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const apiName = typeof r.apiName === "string" ? r.apiName : "";
    if (!apiName) continue;
    const dims = Array.isArray(r.semanticDimensions)
      ? projectAttrs(r.semanticDimensions as unknown[])
      : [];
    const msr = Array.isArray(r.semanticMeasurements)
      ? projectAttrs(r.semanticMeasurements as unknown[])
      : [];
    out.push({
      apiName,
      label: typeof r.label === "string" ? r.label : undefined,
      dimensions: dims,
      measurements: msr,
    });
  }
  return out;
}

function projectAttrs(
  raw: unknown[]
): Array<{ apiName: string; label?: string }> {
  const out: Array<{ apiName: string; label?: string }> = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const apiName = typeof r.apiName === "string" ? r.apiName : "";
    if (!apiName) continue;
    out.push({
      apiName,
      label: typeof r.label === "string" ? r.label : undefined,
    });
  }
  return out;
}

function projectMetrics(
  raw: unknown[]
): Array<{ apiName: string; label?: string; description?: string }> {
  const out: Array<{
    apiName: string;
    label?: string;
    description?: string;
  }> = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const apiName = typeof r.apiName === "string" ? r.apiName : "";
    if (!apiName) continue;
    out.push({
      apiName,
      label: typeof r.label === "string" ? r.label : undefined,
      description:
        typeof r.description === "string" ? r.description : undefined,
    });
  }
  return out;
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
  console.error("[refresh-tableau-sdms] FAILED:", err);
  process.exit(1);
});
