/**
 * scripts/verify-p01.ts
 *
 * P0-1 verification probe. Hits POST /api/brief against a live Horizon
 * deployment, streams the SSE response, and prints every tool_use event's
 * server+tool. Used to confirm the morning brief exercises more than one
 * MCP server after the P0-1 prompt fix.
 *
 * Usage:
 *   HZ_BASE_URL=https://headless-jdo-002d2a119b15.herokuapp.com \
 *     npm run verify:p01
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

interface ToolResult {
  server: string;
  tool: string;
  preview?: string;
}

interface ProbeResult {
  servers: string[];
  toolUses: ToolUse[];
  toolResults: ToolResult[];
  errors: string[];
  finalText: string;
  elapsed: number;
  status: number;
}

async function probe(
  label: string,
  path: string,
  method: "GET" | "POST",
  cookie: string
): Promise<ProbeResult> {
  console.log(`--- ${label}: ${method} ${path} ---`);
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      Accept: "text/event-stream",
      Cookie: cookie,
    },
    ...(method === "POST" ? { body: "{}" } : {}),
  });

  const toolUses: ToolUse[] = [];
  const toolResults: ToolResult[] = [];
  const errors: string[] = [];
  let finalText = "";

  if (!res.ok || !res.body) {
    return {
      servers: [],
      toolUses,
      toolResults,
      errors: [`non-200 status: ${res.status}`],
      finalText,
      elapsed: Date.now() - t0,
      status: res.status,
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
          preview?: string;
          message?: string;
        };
        if (evt.type === "tool_use" && evt.server && evt.tool) {
          toolUses.push({ server: evt.server, tool: evt.tool });
        } else if (evt.type === "tool_result" && evt.server && evt.tool) {
          toolResults.push({
            server: evt.server,
            tool: evt.tool,
            preview: evt.preview?.slice(0, 120),
          });
        } else if (evt.type === "text_delta" && evt.text) {
          finalText += evt.text;
        } else if (evt.type === "error" && evt.message) {
          errors.push(evt.message);
        }
      } catch {
        // ignore non-JSON frames
      }
    }
  }

  const elapsed = Date.now() - t0;
  const servers = Array.from(new Set(toolUses.map((t) => t.server))).sort();
  return { servers, toolUses, toolResults, errors, finalText, elapsed, status: res.status };
}

function printResult(label: string, r: ProbeResult) {
  console.log(
    `${label} — status=${r.status} elapsed=${r.elapsed}ms calls=${r.toolUses.length} servers=[${r.servers.join(", ")}]`
  );
  r.toolUses.forEach((t, i) => {
    console.log(`    ${String(i + 1).padStart(2)}. ${t.server} :: ${t.tool}`);
  });
  if (r.errors.length) {
    console.log(`  errors:`);
    r.errors.forEach((m, i) => console.log(`    ${i + 1}. ${m.slice(0, 200)}`));
  }
  if (r.finalText) {
    console.log(`  narrative (first 200): ${r.finalText.slice(0, 200).replace(/\s+/g, " ").trim()}`);
  }
  console.log("");
}

async function main() {
  const cookie = buildCookie();
  console.log(`P0-1 probe against ${BASE}\n`);

  const brief = await probe("brief", "/api/brief", "POST", cookie);
  printResult("brief", brief);

  const pulse = await probe("pulse", "/api/pulse", "GET", cookie);
  printResult("pulse", pulse);

  const briefOk = brief.servers.length >= 2;
  const pulseOk =
    pulse.servers.includes("tableau_next") ||
    pulse.toolUses.some((t) => t.server === "tableau_next");

  console.log("=== P0-1 verdict ===");
  console.log(
    `  brief: ${briefOk ? "PASS" : "FAIL"} — ${brief.servers.length} servers: [${brief.servers.join(", ")}]`
  );
  console.log(
    `  pulse: ${pulseOk ? "PASS" : "FAIL"} — tableau_next ${pulseOk ? "fired" : "did NOT fire"} (servers: [${pulse.servers.join(", ")}])`
  );

  process.exit(briefOk && pulseOk ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-p01 failed:", e);
  process.exit(1);
});
