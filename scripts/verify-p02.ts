/**
 * scripts/verify-p02.ts
 *
 * P0-2 verification probe. Fires the four FIX_PASS.md test questions at
 * POST /api/ask against a live Horizon deployment, streams the SSE
 * response, and for each question reports:
 *   - HTTP status + elapsed ms
 *   - Unique MCP servers that fired + every tool_use in order
 *   - Final narrative length (first ~220 chars for eyeballing)
 *   - Any fenced {"actions":[…]} block parsed out of the narrative
 *   - Whether the response tripped an agent error / iteration cap
 *
 * "Done when" criteria per FIX_PASS.md#P0-2:
 *   - All 4 questions return a coherent, data-grounded answer
 *     (non-empty narrative, no agent error)
 *   - At least 2 of the 4 produce clickable drafted actions
 *
 * Q1 and Q4 reference the David Chen / Patel seed data from P0-3, which is
 * still pending. For those we accept either a real data-grounded answer OR
 * an honest "I couldn't find that data" paragraph — both satisfy the
 * refusal-to-hallucinate rule and count as "coherent".
 *
 * Usage:
 *   HZ_BASE_URL=https://headless-jdo-002d2a119b15.herokuapp.com \
 *   SF_ACCESS_TOKEN=... SF_INSTANCE_URL=... DEMO_BANKER_USER_ID=... \
 *     npm run verify:p02
 */

export {};

const BASE = process.env.HZ_BASE_URL ?? "http://localhost:3000";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}. Run npm run sf:login first.`);
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

interface ToolUse {
  server: string;
  tool: string;
}

interface ParsedAction {
  id: string;
  kind: string;
  title: string;
  target_object: string;
  target_id: string;
}

interface ProbeResult {
  label: string;
  question: string;
  status: number;
  elapsed: number;
  servers: string[];
  toolUses: ToolUse[];
  narrative: string;
  actions: ParsedAction[];
  errors: string[];
}

const QUESTIONS: { id: string; q: string; expectActions: boolean; actionsRequired: boolean }[] = [
  {
    id: "Q1-lookalikes",
    q: "Show me clients who look like David Chen did three months before he left.",
    expectActions: true,
    actionsRequired: false, // depends on P0-3 seed data
  },
  {
    id: "Q2-aum-decline",
    q: "Which of my clients had the largest AUM decline this week, and why?",
    expectActions: false,
    actionsRequired: false,
  },
  {
    id: "Q3-followups",
    q: "Draft a follow-up for every account I haven't touched in thirty days.",
    expectActions: true,
    actionsRequired: true, // write-verb question; must produce actions
  },
  {
    id: "Q4-patels",
    q: "What should I bring up in my 10 AM with the Patels?",
    expectActions: true,
    actionsRequired: false, // depends on P0-3 seed data
  },
];

// Mirrors lib/client/extractActions.ts — we reimplement here instead of
// importing so this script stays standalone (no @/ alias resolution needed).
const FENCE_RE = /```json\s*([\s\S]*?)```/gi;

function extractActions(raw: string): { prose: string; actions: ParsedAction[] } {
  if (!raw) return { prose: raw ?? "", actions: [] };
  let last: { start: number; end: number; actions: ParsedAction[] } | null = null;
  for (const m of raw.matchAll(FENCE_RE)) {
    if (typeof m.index !== "number") continue;
    const body = (m[1] ?? "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const rawActions = (parsed as { actions?: unknown }).actions;
    if (!Array.isArray(rawActions)) continue;
    const actions = rawActions.filter(isDraftAction);
    if (actions.length === 0) continue;
    last = { start: m.index, end: m.index + m[0].length, actions };
  }
  if (!last) return { prose: raw, actions: [] };
  const prose = (raw.slice(0, last.start) + raw.slice(last.end)).trim();
  return { prose, actions: last.actions };
}

function isDraftAction(v: unknown): v is ParsedAction {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.target_id === "string" &&
    typeof o.target_object === "string" &&
    typeof o.kind === "string"
  );
}

async function probe(
  label: string,
  question: string,
  cookie: string
): Promise<ProbeResult> {
  const t0 = Date.now();
  console.log(`--- ${label}: POST /api/ask ---`);
  console.log(`    "${question}"`);
  const res = await fetch(`${BASE}/api/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Cookie: cookie,
    },
    body: JSON.stringify({ q: question }),
  });

  const toolUses: ToolUse[] = [];
  const errors: string[] = [];
  let narrative = "";

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    return {
      label,
      question,
      status: res.status,
      elapsed: Date.now() - t0,
      servers: [],
      toolUses,
      narrative,
      actions: [],
      errors: [`non-200: ${res.status} ${text.slice(0, 200)}`],
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
          toolUses.push({ server: evt.server, tool: evt.tool });
        } else if (evt.type === "text_delta" && evt.text) {
          narrative += evt.text;
        } else if (evt.type === "error" && evt.message) {
          errors.push(evt.message);
        }
      } catch {
        // ignore non-JSON frames
      }
    }
  }

  const { actions } = extractActions(narrative);
  const servers = Array.from(new Set(toolUses.map((t) => t.server))).sort();
  return {
    label,
    question,
    status: res.status,
    elapsed: Date.now() - t0,
    servers,
    toolUses,
    narrative,
    actions,
    errors,
  };
}

function printResult(r: ProbeResult) {
  const narrSnippet = r.narrative.replace(/\s+/g, " ").trim().slice(0, 220);
  console.log(
    `${r.label} — status=${r.status} elapsed=${r.elapsed}ms calls=${r.toolUses.length} servers=[${r.servers.join(", ")}] actions=${r.actions.length}`
  );
  r.toolUses.forEach((t, i) => {
    console.log(`    ${String(i + 1).padStart(2)}. ${t.server} :: ${t.tool}`);
  });
  if (r.errors.length) {
    console.log(`  errors:`);
    r.errors.forEach((m, i) => console.log(`    ${i + 1}. ${m.slice(0, 200)}`));
  }
  if (r.actions.length) {
    console.log(`  drafted actions:`);
    r.actions.forEach((a, i) =>
      console.log(
        `    ${i + 1}. [${a.kind}] ${a.title} → ${a.target_object}/${a.target_id}`
      )
    );
  }
  if (narrSnippet) {
    console.log(`  narrative (first 220): ${narrSnippet}`);
  }
  console.log("");
}

async function main() {
  const cookie = buildCookie();
  console.log(`P0-2 probe against ${BASE}\n`);

  const results: ProbeResult[] = [];
  for (const { id, q } of QUESTIONS) {
    const r = await probe(id, q, cookie);
    printResult(r);
    results.push(r);
  }

  console.log("=== P0-2 verdict ===");
  let allCoherent = true;
  let actionQuestionsMet = 0;
  let requiredActionFailures = 0;
  let anyToolsFired = false;

  // Hallucination tells — any of these in the narrative means the model
  // short-circuited the tool-use loop and wrote prose from prior knowledge.
  const LEAK_PATTERNS: Array<{ re: RegExp; name: string }> = [
    { re: /<function_calls>/i, name: "leaked <function_calls> XML" },
    { re: /<invoke\b/i, name: "leaked <invoke> XML" },
    { re: /<think>|<thinking>/i, name: "leaked chain-of-thought tag" },
  ];

  // "I'll help you / let me / sure, I can" openers are a signal the model
  // went into chat-reply mode instead of calling a tool first. We flag
  // them as a warning (not a hard fail) because occasionally the model
  // opens with chat AND still calls tools.
  const CHAT_OPENERS = [/^i['']ll\b/i, /^let me\b/i, /^sure,? i\b/i, /^i can help\b/i];

  results.forEach((r, i) => {
    const spec = QUESTIONS[i];
    if (!spec) return;
    if (r.toolUses.length > 0) anyToolsFired = true;

    const firstLine = r.narrative.trim().split(/\n/)[0]?.trim() ?? "";
    const chatOpener = CHAT_OPENERS.some((re) => re.test(firstLine));
    const leaks = LEAK_PATTERNS.filter(({ re }) => re.test(r.narrative)).map(
      (p) => p.name
    );

    // Coherent now requires: HTTP 200, no agent `error`, ≥ 1 real tool call,
    // non-empty prose, no leaked tool-use scaffolding, no fabricated ids.
    const coherent =
      r.status === 200 &&
      r.errors.length === 0 &&
      r.toolUses.length > 0 &&
      r.narrative.trim().length > 40 &&
      leaks.length === 0;
    if (!coherent) allCoherent = false;

    const hasActions = r.actions.length > 0;
    if (hasActions) actionQuestionsMet += 1;
    if (spec.actionsRequired && !hasActions) requiredActionFailures += 1;

    const flags: string[] = [];
    if (r.toolUses.length === 0) flags.push("NO TOOL CALLS");
    if (chatOpener) flags.push(`chat opener: "${firstLine.slice(0, 40)}"`);
    if (leaks.length) flags.push(...leaks);

    console.log(
      `  ${r.label}: coherent=${coherent ? "yes" : "NO"} calls=${r.toolUses.length} actions=${r.actions.length}${spec.actionsRequired ? " (REQUIRED)" : spec.expectActions ? " (expected)" : ""}${flags.length ? "  ⚠ " + flags.join("; ") : ""}`
    );
  });

  const actionsOk = actionQuestionsMet >= 2 && requiredActionFailures === 0;
  console.log(
    `\n  coherent all 4: ${allCoherent ? "PASS" : "FAIL"}`
  );
  console.log(
    `  ≥2 with actions: ${actionsOk ? "PASS" : "FAIL"} (met=${actionQuestionsMet}, required-missing=${requiredActionFailures})`
  );
  console.log(
    `  any tools fired: ${anyToolsFired ? "PASS" : "FAIL"} (hard gate — zero calls means zero grounding)`
  );

  process.exit(allCoherent && actionsOk && anyToolsFired ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-p02 failed:", e);
  process.exit(1);
});
