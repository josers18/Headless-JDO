import { NextResponse, type NextRequest } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { loadCachedDcMetadata } from "@/lib/llm/dcMetadataCache";
import { loadCachedSdms } from "@/lib/llm/tableauSemanticCache";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min — refresh takes ~75s typically

/**
 * Admin endpoints for the metadata caches (Data Cloud DMO + Tableau SDM).
 *
 * Production flow: scheduled refresh runs every 12–24h on Heroku, using
 * the `SF_ACCESS_TOKEN` config var + `heroku run npm run refresh:*`
 * as manual escape hatches.
 *
 * Local dev flow: the POST handler below (or GET with ?run=1) spawns
 * the refresh script(s) as child processes, forwarding the banker's
 * logged-in session token. No Heroku CLI, no env-var plumbing.
 *
 * Diagnostic GET returns DC cache freshness (Tableau cache isn't
 * reported here yet — add if useful).
 *
 * Query params:
 *   ?run=1         — GET-trigger equivalent to POST (browsers don't POST
 *                    from the address bar).
 *   ?tool=dc       — refresh Data Cloud only (default).
 *   ?tool=tableau  — refresh Tableau SDM only.
 *   ?tool=both     — refresh both, sequentially.
 *   ?force=1       — bypass the 12h skip gate. Required after schema
 *                    changes (new DMO / new SDM / renamed apiName).
 */
/**
 * POST /api/admin/refresh-dc-cache
 *
 * Dev-only trigger — runs one or both refresh scripts as child
 * processes with the banker's freshly-refreshed Salesforce access
 * token injected. DC refresh is ~75s (probes ~587 DMOs with
 * COUNT(*)); Tableau is ~15s (1 list + N get_semantic_model calls).
 */
type RefreshScript = {
  label: string;
  relPath: string;
  forceEnv: Record<string, string>;
};

const SCRIPTS: Record<"dc" | "tableau", RefreshScript> = {
  dc: {
    label: "dc",
    relPath: "scripts/refresh-dc-metadata.ts",
    forceEnv: { DC_METADATA_FORCE: "1" },
  },
  tableau: {
    label: "tableau",
    relPath: "scripts/refresh-tableau-sdms.ts",
    forceEnv: { TABLEAU_SDM_FORCE: "1" },
  },
};

function runScript(
  script: RefreshScript,
  token: string,
  force: boolean
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const projectRoot = path.resolve(process.cwd());
  const output: string[] = [];
  const errors: string[] = [];
  log.info("admin.refresh.start", { tool: script.label, force });
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["tsx", path.join(projectRoot, script.relPath)],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          SF_ACCESS_TOKEN: token,
          ...(force ? script.forceEnv : {}),
        },
      }
    );
    child.stdout?.on("data", (d: Buffer) => {
      const text = d.toString();
      output.push(text);
      log.info("admin.refresh.stdout", {
        tool: script.label,
        chunk: text.trim(),
      });
    });
    child.stderr?.on("data", (d: Buffer) => {
      const text = d.toString();
      errors.push(text);
      log.warn("admin.refresh.stderr", {
        tool: script.label,
        chunk: text.trim(),
      });
    });
    child.on("exit", (code) =>
      resolve({
        exitCode: code ?? -1,
        stdout: output.join(""),
        stderr: errors.join(""),
      })
    );
    child.on("error", (e) => {
      errors.push(String(e));
      resolve({
        exitCode: -1,
        stdout: output.join(""),
        stderr: errors.join(""),
      });
    });
  });
}

export async function POST(req: NextRequest) {
  const token = await ensureFreshToken();
  if (!token?.access_token) {
    return NextResponse.json(
      { error: "salesforce session expired — sign in first" },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const toolParam = (url.searchParams.get("tool") ?? "dc").toLowerCase();
  const tools: Array<"dc" | "tableau"> =
    toolParam === "tableau"
      ? ["tableau"]
      : toolParam === "both"
        ? ["dc", "tableau"]
        : ["dc"];

  log.info("admin.refresh_dc_cache.start", { tools, force });

  const results: Array<{
    tool: string;
    exitCode: number;
    stdoutTail: string;
    stderrTail: string;
  }> = [];

  for (const t of tools) {
    const r = await runScript(SCRIPTS[t], token.access_token, force);
    results.push({
      tool: t,
      exitCode: r.exitCode,
      stdoutTail: r.stdout.slice(-2_000),
      stderrTail: r.stderr.slice(-1_000),
    });
  }

  const exitCode = results.every((r) => r.exitCode === 0) ? 0 : 1;

  // Back-compat names for the existing DC-only client code path.
  const output: string[] = results.map((r) => r.stdoutTail);
  const errors: string[] = results.map((r) => r.stderrTail);

  log.info("admin.refresh_dc_cache.done", { exitCode, results: results.map((r) => ({ tool: r.tool, exitCode: r.exitCode })) });

  if (exitCode !== 0) {
    return NextResponse.json(
      {
        ok: false,
        exitCode,
        stdout: output.join(""),
        stderr: errors.join(""),
      },
      { status: 500 }
    );
  }

  // Report the now-current cache state for whichever caches were
  // touched. Shape is back-compat for the DC-only client (keeps
  // top-level `survivingDmos` and `generatedAt`), but also includes
  // per-tool details.
  const [dcCached, tableauCached] = await Promise.all([
    loadCachedDcMetadata(),
    loadCachedSdms(),
  ]);
  return NextResponse.json({
    ok: true,
    tools,
    cached: Boolean(dcCached),
    survivingDmos: dcCached?.survivingDmos ?? 0,
    generatedAt: dcCached?.generatedAt,
    tableau: tableauCached
      ? {
          cached: true,
          survivingSdms: tableauCached.survivingSdms,
          generatedAt: tableauCached.generatedAt,
        }
      : { cached: false },
    perTool: results.map((r) => ({
      tool: r.tool,
      exitCode: r.exitCode,
      stdoutTail: r.stdoutTail.slice(-600),
    })),
  });
}

/**
 * GET /api/admin/refresh-dc-cache
 * GET /api/admin/refresh-dc-cache?run=1 → same as POST (dev convenience)
 *
 * Default behavior is diagnostic (cache freshness report). When
 * `?run=1` is present we forward to the POST handler so the banker
 * can trigger a refresh from a logged-in browser tab — browsers
 * don't POST from the address bar, so this escape hatch exists for
 * local dev only.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  if (url.searchParams.get("run") === "1") {
    return POST(req);
  }
  const [cached, sdms] = await Promise.all([
    loadCachedDcMetadata(),
    loadCachedSdms(),
  ]);
  if (!cached && !sdms) {
    return NextResponse.json(
      {
        cached: false,
        message:
          "No caches found. Run `?run=1&tool=both&force=1` from a logged-in browser tab, or `heroku run --app headless-jdo npm run refresh:dc-metadata` / `refresh:tableau-sdms` from the CLI.",
      },
      { status: 404 }
    );
  }
  const now = Date.now();
  const dcAgeHours = cached
    ? Math.floor(
        (now - new Date(cached.generatedAt).getTime()) / (1000 * 60 * 60)
      )
    : null;
  const sdmAgeHours = sdms
    ? Math.floor(
        (now - new Date(sdms.generatedAt).getTime()) / (1000 * 60 * 60)
      )
    : null;
  return NextResponse.json({
    cached: Boolean(cached),
    generatedAt: cached?.generatedAt,
    ageHours: dcAgeHours,
    dataspace: cached?.dataspace,
    totalDmos: cached?.totalDmos,
    survivingDmos: cached?.survivingDmos,
    emptyDmos: cached?.emptyDmos,
    errorDmos: cached?.errorDmos,
    topByRowCount: cached?.dmos.slice(0, 10).map((d) => ({
      name: d.name,
      category: d.category,
      rowCount: d.rowCount,
      fieldCount: d.fields.length,
    })),
    tableau: sdms
      ? {
          cached: true,
          generatedAt: sdms.generatedAt,
          ageHours: sdmAgeHours,
          dataspace: sdms.dataspace,
          totalSdms: sdms.totalSdms,
          survivingSdms: sdms.survivingSdms,
          excludedSdms: sdms.excludedSdms,
          apiNames: sdms.sdms.map((s) => ({
            apiName: s.apiName,
            label: s.label,
            dataspace: s.dataspace,
            objects: s.dataObjects.length,
            metrics: s.metrics.length,
          })),
        }
      : { cached: false },
  });
}
