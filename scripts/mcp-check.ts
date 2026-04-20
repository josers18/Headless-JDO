/**
 * mcp-check.ts — 1-second health probe for the Salesforce-Hosted MCP token.
 *
 * Answers the single question that keeps us gaslit during debugging: is the
 * SF_ACCESS_TOKEN in .env currently live, or has it expired?
 *
 * Runs four checks in parallel and returns a clean table:
 *   1. Salesforce /services/oauth2/userinfo  (is the token cryptographically
 *      valid and which identity does it belong to?)
 *   2. salesforce_crm MCP  (POST initialize, expects 200/SSE)
 *   3. data_360 MCP        (POST initialize, expects 200/SSE)
 *   4. tableau_next MCP    (POST initialize, expects 200/SSE)
 *
 * Exit code 0 iff every check returns a non-401/403 status. This means
 * `npm run mcp:check` can be a pre-flight gate — e.g. in other scripts or
 * in a git hook — that prevents you from running Cursor-side queries with a
 * stale token and chasing a phantom auth bug.
 *
 * Intentionally does NOT import anything from lib/, so it runs before the
 * Next.js app is even built, and can tolerate partial repo state.
 */

export {};

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[90m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

interface CheckResult {
  name: string;
  ok: boolean;
  status: number;
  detail: string;
  elapsedMs: number;
}

const MCP_URLS = {
  salesforce_crm:
    "https://api.salesforce.com/platform/mcp/v1/platform/sobject-all",
  data_360: "https://api.salesforce.com/platform/mcp/v1/custom/Data360MCP",
  tableau_next:
    "https://api.salesforce.com/platform/mcp/v1/custom/AnalyticsMCP",
} as const;

async function withTiming<T>(
  name: string,
  fn: () => Promise<{ ok: boolean; status: number; detail: string }>
): Promise<CheckResult> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { name, ...r, elapsedMs: Date.now() - t0 };
  } catch (e) {
    return {
      name,
      ok: false,
      status: 0,
      detail: e instanceof Error ? e.message : String(e),
      elapsedMs: Date.now() - t0,
    };
  }
}

async function probeUserInfo(
  token: string,
  instance: string
): Promise<{ ok: boolean; status: number; detail: string }> {
  const res = await fetch(`${instance}/services/oauth2/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  if (res.status === 200) {
    const j = JSON.parse(body) as { preferred_username?: string };
    return {
      ok: true,
      status: res.status,
      detail: j.preferred_username ?? "(identity hidden)",
    };
  }
  return {
    ok: false,
    status: res.status,
    detail: body.slice(0, 120).replace(/\s+/g, " "),
  };
}

async function probeMcp(
  url: string,
  token: string
): Promise<{ ok: boolean; status: number; detail: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-check", version: "0.1.0" },
      },
    }),
  });
  const ct = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const ok = res.status === 200;
  const detail = ok
    ? `content-type=${ct.split(";")[0]}`
    : body.slice(0, 160).replace(/\s+/g, " ");
  return { ok, status: res.status, detail };
}

function renderStatus(r: CheckResult): string {
  const color = r.ok ? GREEN : r.status === 401 || r.status === 403 ? RED : YELLOW;
  const code = r.status === 0 ? "ERR" : String(r.status);
  return `${color}${BOLD}${code.padEnd(4)}${RESET} ${r.name.padEnd(16)} ${DIM}${r.elapsedMs}ms${RESET}  ${r.detail}`;
}

async function main() {
  const token = process.env.SF_ACCESS_TOKEN;
  const instance = process.env.SF_INSTANCE_URL;

  console.log("");
  console.log(`${BOLD}Horizon MCP token health${RESET}`);
  console.log(DIM + "─".repeat(64) + RESET);

  if (!token || !instance) {
    console.error(
      `${RED}Missing SF_ACCESS_TOKEN or SF_INSTANCE_URL in env.${RESET}`
    );
    console.error(
      `${DIM}Run: source scripts/export-mcp-env.sh  (or check .env)${RESET}\n`
    );
    process.exit(2);
  }

  console.log(`token length: ${token.length}   instance: ${instance}`);
  console.log("");

  const checks = await Promise.all([
    withTiming("userinfo", () => probeUserInfo(token, instance)),
    withTiming("salesforce_crm", () =>
      probeMcp(MCP_URLS.salesforce_crm, token)
    ),
    withTiming("data_360", () => probeMcp(MCP_URLS.data_360, token)),
    withTiming("tableau_next", () => probeMcp(MCP_URLS.tableau_next, token)),
  ]);

  for (const c of checks) console.log(renderStatus(c));
  console.log("");

  const authFails = checks.filter((c) => c.status === 401 || c.status === 403);
  const anyFail = checks.some((c) => !c.ok);

  if (authFails.length > 0) {
    console.log(
      `${RED}${BOLD}Token is stale.${RESET} ${authFails.length}/${checks.length} endpoints returned 401/403.`
    );
    console.log(`${DIM}Fix: ${RESET}npm run mcp:refresh\n`);
    process.exit(1);
  }

  if (anyFail) {
    console.log(
      `${YELLOW}Some checks returned non-200 for non-auth reasons. Investigate above.${RESET}\n`
    );
    process.exit(1);
  }

  console.log(`${GREEN}${BOLD}All 4 endpoints healthy.${RESET}\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`${RED}mcp-check crashed:${RESET}`, e);
  process.exit(3);
});
