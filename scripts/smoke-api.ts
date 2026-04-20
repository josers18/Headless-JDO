/**
 * scripts/smoke-api.ts — end-to-end smoke test of Horizon's streaming API
 * routes against a live dev server.
 *
 * Reads SF_ACCESS_TOKEN + SF_INSTANCE_URL from env, crafts the `hz_sf` session
 * cookie the same way setTokenCookie() does, and hits:
 *
 *   GET  /api/health
 *   POST /api/brief   (SSE)
 *   POST /api/ask     (SSE, "who am I?")
 *   GET  /api/priority
 *   GET  /api/pulse-strip
 *
 * Prints a brief pass/fail summary for each.
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

interface StreamCounts {
  text_delta: number;
  tool_use: number;
  tool_result: number;
  error: number;
}

async function streamSseGet(
  path: string,
  cookie: string
): Promise<{ status: number; counts: StreamCounts; firstText: string }> {
  return streamResponse(
    fetch(`${BASE}${path}`, {
      method: "GET",
      headers: { Accept: "text/event-stream", Cookie: cookie },
    })
  );
}

async function streamSse(
  path: string,
  body: unknown,
  cookie: string
): Promise<{ status: number; counts: StreamCounts; firstText: string }> {
  return streamResponse(
    fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    })
  );
}

async function streamResponse(
  pending: Promise<Response>
): Promise<{ status: number; counts: StreamCounts; firstText: string }> {
  const res = await pending;

  const counts: StreamCounts = {
    text_delta: 0,
    tool_use: 0,
    tool_result: 0,
    error: 0,
  };
  let firstText = "";
  if (!res.ok || !res.body) return { status: res.status, counts, firstText };

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
      if (!data) continue;
      if (data === "[DONE]") continue;
      try {
        const evt = JSON.parse(data) as { type: keyof StreamCounts; text?: string };
        if (evt.type in counts) counts[evt.type]++;
        if (evt.type === "text_delta" && firstText.length < 160 && evt.text) {
          firstText += evt.text;
        }
      } catch {
        // ignore non-JSON frames (comments, etc.)
      }
    }
  }
  return { status: res.status, counts, firstText: firstText.trim() };
}

async function main() {
  const cookie = buildCookie();
  console.log(`Smoke testing ${BASE} with session cookie hz_sf=... (${cookie.length} chars)\n`);

  // Health.
  const h = await fetch(`${BASE}/api/health`);
  console.log(`GET  /api/health         ${h.status} ${h.status === 200 ? "OK" : "FAIL"}`);

  // Morning brief.
  console.log(`POST /api/brief          streaming...`);
  const t0 = Date.now();
  const brief = await streamSse("/api/brief", {}, cookie);
  console.log(
    `                         status=${brief.status} ` +
      `text_deltas=${brief.counts.text_delta} ` +
      `tool_use=${brief.counts.tool_use} ` +
      `tool_result=${brief.counts.tool_result} ` +
      `errors=${brief.counts.error} ` +
      `(${Date.now() - t0}ms)`
  );
  if (brief.firstText) console.log(`                         snippet: "${brief.firstText}..."`);

  // Ask Anything.
  console.log(`\nPOST /api/ask            "Who am I in Salesforce?"`);
  const t1 = Date.now();
  const ask = await streamSse(
    "/api/ask",
    { q: "Who am I in Salesforce? Call getUserInfo and tell me the name." },
    cookie
  );
  console.log(
    `                         status=${ask.status} ` +
      `text_deltas=${ask.counts.text_delta} ` +
      `tool_use=${ask.counts.tool_use} ` +
      `tool_result=${ask.counts.tool_result} ` +
      `errors=${ask.counts.error} ` +
      `(${Date.now() - t1}ms)`
  );
  if (ask.firstText) console.log(`                         snippet: "${ask.firstText}..."`);

  // Priority — now streaming SSE like brief/ask.
  console.log(`\nGET  /api/priority       streaming...`);
  const t2 = Date.now();
  const priority = await streamSseGet("/api/priority", cookie);
  console.log(
    `                         status=${priority.status} ` +
      `text_deltas=${priority.counts.text_delta} ` +
      `tool_use=${priority.counts.tool_use} ` +
      `tool_result=${priority.counts.tool_result} ` +
      `errors=${priority.counts.error} ` +
      `(${Date.now() - t2}ms)`
  );
  if (priority.firstText)
    console.log(`                         snippet: "${priority.firstText}..."`);

  console.log(`\nGET  /api/pulse-strip    streaming...`);
  const t3 = Date.now();
  const strip = await streamSseGet("/api/pulse-strip", cookie);
  console.log(
    `                         status=${strip.status} ` +
      `text_deltas=${strip.counts.text_delta} ` +
      `tool_use=${strip.counts.tool_use} ` +
      `tool_result=${strip.counts.tool_result} ` +
      `errors=${strip.counts.error} ` +
      `(${Date.now() - t3}ms)`
  );
  if (strip.firstText)
    console.log(`                         snippet: "${strip.firstText.slice(0, 120)}..."`);

  const pass =
    h.status === 200 &&
    brief.status === 200 &&
    brief.counts.text_delta > 0 &&
    ask.status === 200 &&
    ask.counts.tool_use > 0 &&
    priority.status === 200 &&
    strip.status === 200 &&
    strip.counts.text_delta > 0;
  console.log(`\n${pass ? "PASS" : "FAIL"} — end-to-end ${pass ? "OK" : "issues above"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke-api failed:", e);
  process.exit(1);
});
