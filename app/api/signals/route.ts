import { NextRequest } from "next/server";
import { makeSseStream } from "@/lib/anthropic/stream";
import { log, correlationId } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Placeholder signal feed. Wiring to Data 360 live topics happens on Day 6.
// For scaffolding, we emit a heartbeat every 15s so the UI's EventSource
// plumbing can be exercised end-to-end before the real source is plugged in.
export async function GET(_req: NextRequest) {
  const cid = correlationId();
  log.info("signals.stream.open", { cid });

  return makeSseStream(async (send) => {
    for (let i = 0; i < 4; i++) {
      await new Promise((r) => setTimeout(r, 15_000));
      send({
        type: "reasoning",
        step: {
          server: "data_360",
          tool: "heartbeat",
          output_preview: `tick ${i + 1}`,
          ms: 0,
        },
      });
    }
  });
}
