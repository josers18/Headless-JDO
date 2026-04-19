/**
 * scripts/verify-p02.ts
 *
 * P0-2 verification probe. Runs the 4 FIX_PASS Ask-Bar test questions
 * against POST /api/ask on a live Horizon deployment and reports:
 *   - HTTP status
 *   - unique MCP servers fired
 *   - tool call sequence
 *   - whether the narrative parsed a valid {"actions":[...]} JSON block
 *
 * PASS criteria (FIX_PASS P0-2 "Done when" rows 4 + 5):
 *   - all 4 questions return a non-empty narrative
 *   - at least 2 of the 4 questions produce ≥ 1 parseable DraftAction
 *
 * Usage:
 *   SF_ACCESS_TOKEN=... SF_INSTANCE_URL=... \
 *     DEMO_BANKER_USER_ID=005am000003PbCLAA0 \
 *     HZ_BASE_URL=https://headless-jdo-002d2a119b15.herokuapp.com \
 *     npm run verify:p02
 */

export {};

const BASE = process.env.HZ_BASE_URL ?? "http://localhost:3000";

const QUESTIONS = [
  "Show me clients who look like David Chen did three months before he left.",
  "Which of my clients had the largest AUM decline this week, and why?",
  "Draft a follow-up for every account I haven't touched in thirty days.",
  "What should I bring up in my 10 AM with the Patels?",
];

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `Missing required env var ${name}. Run npm run sf:login first.`
    );
    process.exit(2);
  }
  return v;
}

function buildCookie(): string {
  const accessToken = required("SF_ACCESS_TOKEN");
  const instanceUrl = required("SF_INSTANCE_URL");
  const payload = {
    access_token: accessToken,
    instance_url: instanceUrl,
    issued_at: Date.now(),
    user_id: process.env.DEMO_BANKER_USER_ID ?? "smoke-test-user",
  };
  return `hz_sf=${encodeURIComponent(JSON.stringify(payload))}`;
}

interface ProbeResult {
  q: string;
  status: number;
  elapsed: number;
  servers: string[];
  tools: { server: string; tool: string }[];
  errors: string[];
  narrative: string;
  actionsCount: number;
  actionsValid: boolean;
}

async function probe(q: string, cookie: string): Promise<ProbeResult> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Cookie: cookie,
    },
    body: JSON.stringify({ q }),
  });

  const tools: { server: string; tool: string }[] = [];
  const errors: string[] = [];
  let narrative = "";

  if (!res.ok || !res.body) {
    return {
      q,
      status: res.status,
      elapsed: Date.now() - t0,
      servers: [],
      tools,
      errors: [`non-200 status: ${res.status}`],
      narrative,
      actionsCount: 0,
      actionsValid: false,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = frame
        .split("\n")
        .find((l) => l.startsWith("data: "))
        ?.slice(6);
      if (!data || data === "[DONE]") continue;
      try {
        const evt = JSON.parse(data) as {
          type: string;
          server?: string;
          tool?: string;
          text?: string;
          message?: string;
        };
        if (evt.type === "tool_use" && evt.server && evt.tool) {
          tools.push({ server: evt.server, tool: evt.tool });
        } else if (evt.type === "text_delta" && evt.text) {
          narrative += evt.text;
        } else if (evt.type === "error" && evt.message) {
          errors.push(evt.message);
        }
      } catch {
        // ignore
      }
    }
  }

  const servers = Array.from(new Set(tools.map((t) => t.server))).sort();
  const { actions, valid } = parseActions(narrative);

  return {
    q,
    status: res.status,
    elapsed: Date.now() - t0,
    servers,
    tools,
    errors,
    narrative,
    actionsCount: actions.length,
    actionsValid: valid,
  };
}

function parseActions(raw: string): {
  actions: unknown[];
  valid: boolean;
} {
  const fenceRe = /```json\s*([\s\S]*?)```/gi;
  let last: unknown[] | null = null;
  let valid = false;
  for (const m of raw.matchAll(fenceRe)) {
    const body = (m[1] ?? "").trim();
    try {
      const o = JSON.parse(body) as { actions?: unknown };
      if (Array.isArray(o.actions)) {
        last = o.actions;
        valid = o.actions.every((a) => {
          if (!a || typeof a !== "object") return false;
          const x = a as Record<string, unknown>;
          return (
            typeof x.id === "string" &&
            typeof x.title === "string" &&
            typeof x.body === "string" &&
            typeof x.target_id === "string" &&
            typeof x.target_object === "string" &&
            (x.kind === "task" ||
              x.kind === "email" ||
              x.kind === "call" ||
              x.kind === "update")
          );
        });
      }
    } catch {
      // not a valid JSON fence — skip
    }
  }
  return { actions: last ?? [], valid };
}

function fmt(r: ProbeResult, idx: number) {
  console.log(
    `\n[Q${idx + 1}] "${r.q}"\n  status=${r.status} elapsed=${r.elapsed}ms calls=${r.tools.length} servers=[${r.servers.join(", ") || "none"}] actions=${r.actionsCount}${r.actionsCount > 0 && !r.actionsValid ? " (INVALID)" : ""}`
  );
  r.tools.forEach((t, i) =>
    console.log(`    ${String(i + 1).padStart(2)}. ${t.server} :: ${t.tool}`)
  );
  if (r.errors.length) {
    console.log(`  errors:`);
    r.errors.forEach((m) => console.log(`    - ${m.slice(0, 200)}`));
  }
  if (r.narrative) {
    const oneLine = r.narrative.slice(0, 260).replace(/\s+/g, " ").trim();
    console.log(`  narrative (first 260): ${oneLine}`);
  }
}

async function main() {
  const cookie = buildCookie();
  console.log(`P0-2 probe against ${BASE}`);
  console.log(`Running ${QUESTIONS.length} questions sequentially…`);

  const results: ProbeResult[] = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    if (!q) continue;
    const r = await probe(q, cookie);
    fmt(r, i);
    results.push(r);
  }

  const allHaveNarrative = results.every((r) => r.narrative.trim().length > 0);
  const withActions = results.filter(
    (r) => r.actionsCount > 0 && r.actionsValid
  ).length;

  console.log("\n=== P0-2 verdict ===");
  console.log(
    `  narrative on all 4:     ${allHaveNarrative ? "PASS" : "FAIL"} (${results.filter((r) => r.narrative.trim().length > 0).length}/4)`
  );
  console.log(
    `  ≥2 produce actions:     ${withActions >= 2 ? "PASS" : "FAIL"} (${withActions}/4)`
  );

  process.exit(allHaveNarrative && withActions >= 2 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-p02 failed:", e);
  process.exit(1);
});
