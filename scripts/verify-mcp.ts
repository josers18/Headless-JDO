/**
 * scripts/verify-mcp.ts — Day 1 done-when (CLAUDE.md §8), Heroku-driven.
 *
 * Opens live MCP connections to the three Salesforce MCPs (plus the Heroku
 * Inference toolkit if configured), lists every tool on each, then fires a
 * single "hello, probe each server" prompt at Claude 4.5 Sonnet (via Heroku
 * Inference, OpenAI-compatible) and prints the resulting tool calls.
 *
 * Pass criteria:
 *   - ≥ 1 tool discovered from each required SF MCP server.
 *   - Agent loop completes without provider errors.
 *
 * Run: npm run verify:mcp
 */

export {};

import { connectMcpClients, type McpRegistry } from "../lib/mcp/client";
import { runAgent } from "../lib/llm/heroku";
import { MCP_URLS } from "../lib/anthropic/mcp-servers";
import type { McpServerName } from "../types/horizon";

const CHECK = "\u2713";
const CROSS = "\u2717";
const DASH = "\u2014";
const DOTS = "\u2026";
const WARN = "\u26a0";

function must(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${CROSS} Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function getSfToken(): Promise<string> {
  const preset = process.env.SF_ACCESS_TOKEN;
  if (preset) {
    console.log(`${CHECK} Using SF_ACCESS_TOKEN from env`);
    return preset;
  }
  console.error(
    `${CROSS} No SF_ACCESS_TOKEN found. The Salesforce MCP gateway requires a
   token with the \`mcp_api\` scope, which only the PKCE auth-code flow can
   mint. Run:
     npm run sf:login
   to capture one (opens a browser, writes SF_ACCESS_TOKEN + SF_INSTANCE_URL
   back to .env), then rerun verify:mcp.`
  );
  process.exit(1);
}

async function main() {
  must("INFERENCE_URL");
  must("INFERENCE_KEY");

  console.log("\nHorizon — MCP verification (Heroku Inference path)");
  console.log("----------------------------------------");
  console.log("Endpoints:");
  for (const [k, v] of Object.entries(MCP_URLS)) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }
  if (process.env.INFERENCE_URL && process.env.INFERENCE_KEY) {
    const toolkit = `${process.env.INFERENCE_URL.replace(/\/$/, "")}/mcp/sse`;
    console.log(`  ${"heroku_toolkit".padEnd(16)} ${toolkit}`);
  }
  console.log(
    `  LLM             ${process.env.INFERENCE_URL} (${
      process.env.INFERENCE_MODEL_ID ?? "claude-4-5-sonnet"
    })`
  );
  console.log("");

  const sfToken = await getSfToken();

  console.log(`${DOTS} Opening MCP connections`);
  let registry: McpRegistry;
  try {
    registry = await connectMcpClients({ salesforceToken: sfToken });
  } catch (e) {
    console.error(`${CROSS} Could not open any MCP connection:`, e);
    process.exit(2);
  }
  console.log(
    `${CHECK} Connected: ${registry.servers.join(", ")} (${registry.servers.length} server${registry.servers.length === 1 ? "" : "s"})`
  );

  console.log(`${DOTS} Listing tools on each server`);
  const tools = await registry.listAllTools();
  const byServer = new Map<McpServerName, number>();
  for (const t of tools) {
    byServer.set(t.server, (byServer.get(t.server) ?? 0) + 1);
  }
  for (const s of registry.servers) {
    console.log(`  ${CHECK} ${s.padEnd(16)} ${byServer.get(s) ?? 0} tool(s)`);
  }

  console.log(
    `\n${DOTS} Asking Claude 4.5 Sonnet (via Heroku Inference) to exercise the tools`
  );
  const sawCalls: { server: McpServerName; tool: string; ok: boolean }[] = [];
  let narrative = "";

  const result = await runAgent({
    system:
      "You are a diagnostic probe. For each MCP server attached " +
      "(salesforce_crm, data_360, tableau_next), call the cheapest available " +
      "tool to confirm connectivity — prefer listing/describe/ping tools over " +
      "queries that return large data. Use no more than 1 tool call per server. " +
      "After all calls, produce a one-line summary. Do not invent data.",
    messages: [
      {
        role: "user",
        content:
          "hello — confirm all three Salesforce MCP servers are reachable and exercise one tool on each.",
      },
    ],
    registry,
    maxIterations: 5,
    onEvent: (e) => {
      if (e.type === "tool_use" && e.server && e.tool) {
        sawCalls.push({ server: e.server, tool: e.tool, ok: true });
      } else if (e.type === "tool_result" && e.is_error && sawCalls.length) {
        const last = sawCalls[sawCalls.length - 1];
        if (last) last.ok = false;
      } else if (e.type === "final" && e.text) {
        narrative = e.text;
      }
    },
  });

  await registry.close();

  console.log("\nClaude narrative:");
  const narrativeText = result.text || narrative || "(empty)";
  console.log("  " + narrativeText.trim().split("\n").join("\n  "));

  console.log("\nMCP calls:");
  if (sawCalls.length === 0) {
    console.log("  (none — Claude did not invoke any MCP tools)");
  } else {
    for (const t of sawCalls) {
      console.log(
        `  ${t.ok ? CHECK : CROSS} ${t.server.padEnd(16)} ${t.tool}`
      );
    }
  }

  const required: McpServerName[] = [
    "salesforce_crm",
    "data_360",
    "tableau_next",
  ];
  const optional: McpServerName[] = ["heroku_toolkit"];

  console.log("\nCoverage (tools discovered):");
  const missingDiscovery: McpServerName[] = [];
  for (const s of required) {
    const n = byServer.get(s) ?? 0;
    const ok = n > 0;
    if (!ok) missingDiscovery.push(s);
    console.log(`  ${ok ? CHECK : CROSS} ${s.padEnd(16)} ${n} tool(s)`);
  }
  for (const s of optional) {
    const present = registry.servers.includes(s);
    const n = byServer.get(s) ?? 0;
    const symbol = present ? (n > 0 ? CHECK : WARN) : DASH;
    console.log(
      `  ${symbol} ${s.padEnd(16)} ${
        present ? `${n} tool(s)` : "(not attached)"
      }`
    );
  }

  if (missingDiscovery.length) {
    console.error(
      `\n${CROSS} FAIL — no tools discovered on: ${missingDiscovery.join(", ")}`
    );
    process.exit(2);
  }
  console.log(
    `\n${CHECK} PASS — all three Salesforce MCPs responded and the Heroku Inference agent loop completed in ${result.iterations} iteration${result.iterations === 1 ? "" : "s"}.`
  );
}

main().catch((e) => {
  console.error(`${CROSS} verify-mcp crashed:`, e);
  process.exit(1);
});
