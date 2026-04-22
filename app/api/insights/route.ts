import { NextRequest } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import {
  sectionInsightBatchPrompt,
  sectionInsightPrompt,
  type SectionKind,
} from "@/lib/prompts/section-insight";
import { makeSseStream, sendInferenceMeta } from "@/lib/anthropic/stream";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * C-1 — SectionInsight banner(s). POST body options:
 * - Legacy: `{ section }` → one banner (still supported).
 * - Batch (preferred on home page): `{ sections: SectionKind[] }` with all four
 *   keys → one agent run, one MCP session — avoids 4× concurrent insight loops.
 */

const ALLOWED: ReadonlyArray<SectionKind> = [
  "priority",
  "pulse",
  "drafts",
  "signals",
];

export async function POST(req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  const b = body as { section?: unknown; sections?: unknown };

  const sectionsRaw = Array.isArray(b.sections) ? b.sections : null;
  if (sectionsRaw) {
    const sections = sectionsRaw.filter(
      (s): s is SectionKind =>
        typeof s === "string" && ALLOWED.includes(s as SectionKind)
    );
    if (sections.length === 0) {
      return new Response("invalid sections", { status: 400 });
    }

    const prompt = sectionInsightBatchPrompt({
      bankerName: optionalEnv("DEMO_BANKER_NAME", "the banker"),
    });

    log.info("insight.batch.start", { cid, sections });

    return makeSseStream(async (send) => {
      const result = await runAgentWithMcp({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        salesforceToken: token.access_token,
        maxIterations: 12,
        onEvent: (e) => {
          if (e.type === "text_delta" && e.text) {
            send({ type: "text_delta", text: e.text });
          } else if (e.type === "tool_use" && e.server && e.tool) {
            send({
              type: "tool_use",
              server: e.server,
              tool: e.tool,
              input: e.input,
            });
          } else if (e.type === "tool_result" && e.server && e.tool) {
            send({
              type: "tool_result",
              server: e.server,
              tool: e.tool,
              is_error: e.is_error,
              preview: e.preview ?? "",
            });
          }
        },
      });
      sendInferenceMeta(send, result.inferenceBackend);
      log.info("insight.batch.done", {
        cid,
        iterations: result.iterations,
        tools: result.toolCalls.length,
      });
    });
  }

  const section =
    typeof b.section === "string" ? (b.section as SectionKind) : undefined;
  if (!section || !ALLOWED.includes(section)) {
    return new Response("invalid section", { status: 400 });
  }

  const prompt = sectionInsightPrompt({
    section,
    bankerName: optionalEnv("DEMO_BANKER_NAME", "the banker"),
  });

  log.info("insight.start", { cid, section });

  return makeSseStream(async (send) => {
    const result = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      salesforceToken: token.access_token,
      maxIterations: 10,
      onEvent: (e) => {
        if (e.type === "text_delta" && e.text) {
          send({ type: "text_delta", text: e.text });
        } else if (e.type === "tool_use" && e.server && e.tool) {
          send({
            type: "tool_use",
            server: e.server,
            tool: e.tool,
            input: e.input,
          });
        } else if (e.type === "tool_result" && e.server && e.tool) {
          send({
            type: "tool_result",
            server: e.server,
            tool: e.tool,
            is_error: e.is_error,
            preview: e.preview ?? "",
          });
        }
      },
    });
    sendInferenceMeta(send, result.inferenceBackend);
    log.info("insight.done", {
      cid,
      section,
      iterations: result.iterations,
      tools: result.toolCalls.length,
    });
  });
}
