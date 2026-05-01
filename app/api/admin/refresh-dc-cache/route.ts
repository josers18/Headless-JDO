import { NextResponse } from "next/server";
import { loadCachedDcMetadata } from "@/lib/llm/dcMetadataCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/refresh-dc-cache
 *
 * Diagnostic endpoint — returns the current Data Cloud metadata cache
 * freshness + size. We deliberately do NOT kick off the refresh job
 * here: the full refresh takes ~60s (one metadata fetch + ~1000 COUNT
 * probes), far longer than Heroku's 30s H12 limit. Instead:
 *
 *   - Scheduled refresh runs every 12h via Heroku Scheduler:
 *       heroku addons:open scheduler
 *     Command: `npm run refresh:dc-metadata`
 *   - Manual refresh (faster than waiting for the next cron tick):
 *       heroku run --app headless-jdo npm run refresh:dc-metadata
 *     Or locally:
 *       npm run refresh:dc-metadata
 *
 * This endpoint is useful for verifying the cache exists after a
 * refresh run and for checking survivor-count delta over time.
 */
export async function GET() {
  const cached = await loadCachedDcMetadata();
  if (!cached) {
    return NextResponse.json(
      {
        cached: false,
        message:
          "No Data Cloud metadata cache found. Run `heroku run --app headless-jdo npm run refresh:dc-metadata` to populate.",
      },
      { status: 404 }
    );
  }
  const now = Date.now();
  const generated = new Date(cached.generatedAt).getTime();
  const ageMs = now - generated;
  const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
  return NextResponse.json({
    cached: true,
    generatedAt: cached.generatedAt,
    ageHours,
    dataspace: cached.dataspace,
    totalDmos: cached.totalDmos,
    survivingDmos: cached.survivingDmos,
    emptyDmos: cached.emptyDmos,
    errorDmos: cached.errorDmos,
    topByRowCount: cached.dmos.slice(0, 10).map((d) => ({
      name: d.name,
      category: d.category,
      rowCount: d.rowCount,
      fieldCount: d.fields.length,
    })),
  });
}
