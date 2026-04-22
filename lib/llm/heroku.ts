/**
 * lib/llm/heroku.ts — OpenAI-compatible agent loop (multi-backend).
 *
 * Defaults to Heroku Managed Inference (Claude 4.5 Sonnet). Optionally
 * uses Moonshot Kimi (`inferenceBackend: "kimi"`) — see inferenceClients.ts.
 *
 * Heroku's Managed Inference exposes an OpenAI-compatible
 * /v1/chat/completions endpoint. This file orchestrates the tool-calling
 * loop against an `McpRegistry`:
 *
 *   user prompt → Claude → [tool_calls?]
 *     → execute via MCP registry in parallel
 *     → feed results back as `role: "tool"` messages
 *     → repeat until Claude returns a plain assistant message
 *
 * Streaming is implemented via a simple async callback (`onEvent`) so the
 * API routes can re-emit each step as an SSE frame.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { McpRegistry } from "@/lib/mcp/client";
import { toOpenAiTools, parseToolName } from "@/lib/mcp/tools";
import type { McpServerName } from "@/types/horizon";
import {
  emptyDcSnapshot,
  ingestDcMetadata,
  hasTable as dcHasTable,
  getTable as dcGetTable,
  suggestTables as dcSuggestTables,
  suggestColumns as dcSuggestColumns,
  type DcSnapshot,
} from "@/lib/llm/dataCloudSchema";
import { extractSqlRefs } from "@/lib/llm/sqlRefs";
import {
  type InferenceBackend,
  modelIdFor,
  openAiClientFor,
} from "@/lib/llm/inferenceClients";

export interface AgentEvent {
  type:
    | "text_delta"
    | "tool_use"
    | "tool_result"
    | "iteration_start"
    | "final"
    | "error";
  text?: string;
  server?: McpServerName;
  tool?: string;
  input?: unknown;
  preview?: string;
  is_error?: boolean;
  iteration?: number;
  message?: string;
}

export interface AgentRunArgs {
  system: string;
  /** Conversation seed without the system message (system is prepended here). */
  messages: ChatCompletionMessageParam[];
  registry: McpRegistry;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  onEvent?: (e: AgentEvent) => void;
  /**
   * If true, force `tool_choice: "required"` on the first iteration so the
   * model must emit at least one structured tool_call before it can finalize
   * a plain text answer. Subsequent iterations use "auto" so the model can
   * exit the loop normally with prose.
   *
   * Use this for endpoints where skipping the tool loop would be
   * catastrophic (e.g. /api/ask, where a tool-less answer is pure
   * hallucination). Do NOT use it for turns that may legitimately answer
   * from prior tool output with no new calls.
   */
  forceFirstToolCall?: boolean;
  /**
   * Which OpenAI-compatible inference stack to call. Resolved by
   * `runAgentWithMcp` from `routeHint` + env unless set explicitly.
   * Default heroku (Claude via Heroku Inference).
   */
  inferenceBackend?: InferenceBackend;
}

export interface AgentRunResult {
  text: string;
  toolCalls: Array<{
    server: McpServerName;
    tool: string;
    input: unknown;
    isError: boolean;
    preview: string;
  }>;
  iterations: number;
  /** Full thread as seen by the model, excluding the system message. */
  transcript: ChatCompletionMessageParam[];
}

/** @deprecated use modelIdFor("heroku") — kept for scripts that grep this name */
export function herokuModel(): string {
  return modelIdFor("heroku");
}

// Trip-worthy error signatures. We trip a circuit breaker on these because
// (a) for schema mismatches the model fabricated a column/table, and (b)
// for transport errors (CloudFront 403 / 503 / "request blocked") the
// endpoint is not reachable and retrying wastes Flex credits and floods
// the reasoning trail with noise. See iterative feedback 2026-04-18/19.
const TRIP_ERROR_PATTERNS = [
  // Schema mismatches
  /invalid_argument/i,
  /unknown column/i,
  /unknown table/i,
  /does not exist/i,
  /no such column/i,
  /malformed_query/i,
  /unexpected token/i,
  // Wrong tool name — model invented or guessed at the tool rather than
  // copying from the tools list. Retrying with another guess always fails.
  /unknown tool/i,
  /invalid_tool_name/i,
  /-32602/,
  /\bmcp error\b/i,
  // Transport / CloudFront / auth / throttle
  /cloudfront/i,
  /request blocked/i,
  /request could not be satisfied/i,
  /\b403\b/,
  /\b401\b/,
  /\b429\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
  /forbidden/i,
  /unauthorized/i,
  /rate.?limit/i,
  /<!doctype/i,
  /<html/i,
] as const;

function isTrippedError(preview: string | undefined | null): boolean {
  if (!preview) return false;
  return TRIP_ERROR_PATTERNS.some((re) => re.test(preview));
}

// Pre-flight guardrail for Data Cloud SQL. The hygiene prompt forbids
// these patterns, but the model occasionally ignores the rule. We
// intercept the arguments before dispatch and return a synthetic "rejected"
// tool result so the model never actually fires a bad query. Catches the
// two biggest demo-killers: information_schema introspection and SELECT *.
const FORBIDDEN_DC_SQL_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\binformation_schema\b/i,
    reason:
      "INFORMATION_SCHEMA does not exist in Data Cloud SQL. Use getDcMetadata to enumerate objects instead.",
  },
  {
    re: /\bpg_catalog\b/i,
    reason:
      "pg_catalog does not exist in Data Cloud SQL. Use getDcMetadata to enumerate objects instead.",
  },
  {
    re: /\bselect\s+\*/i,
    reason:
      "SELECT * is not allowed — pick specific columns by name from the metadata response.",
  },
  // Known-hallucinated column names. The system prompt already forbids
  // these, but the model still reaches for them when the real field list
  // from getDcMetadata feels awkward. Pattern enforcement is whack-a-mole
  // by nature, but each entry here maps 1:1 to an actual INVALID_ARGUMENT
  // we've seen in the trail. Add new entries as new variants surface.
  //
  // Note: ssot__*__c columns are no longer handled here — the
  // schema-grounded column check in preflightDataCloudSql rejects
  // them naturally when the current org's metadata doesn't expose
  // any ssot__ columns.
  {
    // Bare unquoted lowercase identifiers in SELECT/WHERE that the
    // model sometimes produces as "normalized" versions of quoted
    // DMO columns. Real DMO columns are mixed-case with suffixes
    // ("Acc_Name__c"), so a bare lowercase "name" / "id" / "owner_id"
    // reference is almost always a guess.
    //
    // We only trip on these when they appear as standalone column
    // references — not as parts of quoted identifiers or longer
    // snake_case column names. Anchoring with word boundaries plus
    // a negative lookbehind for quote/underscore/dot keeps false
    // positives off legitimate queries.
    re: /(?<!["_.a-zA-Z0-9])(?:name|id|owner_id|ownerid)(?!["_a-zA-Z0-9])\s*(?:,|FROM\b|WHERE\b|=|\))/i,
    reason:
      "Bare lowercase 'name' / 'id' / 'owner_id' is not a real column in Data Cloud DMOs. Real column names are mixed-case with a DMO-specific prefix (e.g. Acc_Name__c, ssot__Id__c). Copy a column name verbatim from the getDcMetadata response for the DMO you are querying.",
  },
];

function preflightDataCloudSql(
  server: string,
  tool: string,
  args: Record<string, unknown>,
  ctx: { snapshot: DcSnapshot }
): string | null {
  if (server !== "data_360") return null;
  // OpenAI tool names are sanitized + max 64 chars; the MCP leaf name is
  // often suffixed (e.g. postDcQuerySqlmarketing_data_cloud_queries).
  if (!/^postDcQuerySql/i.test(tool)) return null;
  const sql = typeof args.sql === "string" ? args.sql : "";
  if (!sql) return null;

  // Pattern-based rejections (information_schema, SELECT *, bare
  // lowercase column references). These are still useful as a first
  // line of defense — they don't require the metadata snapshot to
  // make a decision.
  for (const { re, reason } of FORBIDDEN_DC_SQL_PATTERNS) {
    if (re.test(sql)) {
      return JSON.stringify({
        rejected: true,
        server,
        tool,
        reason,
        instruction:
          "Do NOT retry this query. Either call getDcMetadata first and reference only columns from its response, or skip data_360 and finish your answer with the other tools.",
      });
    }
  }

  // Schema-grounded rejections. Only run when we actually have a
  // metadata snapshot — without one we have no ground truth to check
  // against, and the earlier metadata-before-SQL gate will have
  // blocked execution anyway.
  if (!ctx.snapshot.hasData) return null;

  const refs = extractSqlRefs(sql);
  if (refs.complexity === "complex") {
    // Query shape is past our conservative parser's comfort zone.
    // Allow it through — the network will reject it if the references
    // don't resolve, which is strictly better than a false positive
    // blocking a legitimate advanced query.
    return null;
  }

  // D1 — Table-existence. If the query names a table that is not in
  // any getDcMetadata response we've ingested, reject and cite real
  // candidate tables from the snapshot.
  for (const table of refs.tables) {
    if (dcHasTable(ctx.snapshot, table)) continue;
    // Snapshot may be truncated if the metadata response exceeded
    // our budget. When that happens, unknown tables could legitimately
    // exist past the truncation point. Advise the model to narrow
    // its next metadata call rather than block — there's no way for
    // us to know for sure.
    if (ctx.snapshot.truncated) continue;
    const suggestions = dcSuggestTables(ctx.snapshot, table, 5);
    return JSON.stringify({
      rejected: true,
      server,
      tool,
      reason: `Table "${table}" does not exist in this org's Data Cloud metadata. The getDcMetadata response you just read lists every available DMO; "${table}" is not one of them, so it is a guess, not a real object.`,
      instruction:
        suggestions.length > 0
          ? `Rewrite the query against one of these real tables from the metadata response (closest matches first): ${suggestions.map((s) => `"${s}"`).join(", ")}. If none of these are the right object for the question, the data you are looking for is not in Data Cloud — say so honestly and finish with the tools you have.`
          : "Re-read the metadata response carefully — no table in it matched the name you queried. If the data you need is not in Data Cloud for this org, say so honestly and finish with the tools you have.",
    });
  }

  // D2 — Column-existence. For each named table in the query, verify
  // that every column the query references exists on that table in
  // the snapshot. Columns that the parser couldn't attribute to a
  // specific table (e.g. unqualified refs in a JOIN) are matched
  // against ANY of the named tables — if no table has the column,
  // reject. This avoids false positives on queries that use columns
  // from either side of a JOIN without aliases.
  const tablesInQuery = refs.tables
    .map((t) => dcGetTable(ctx.snapshot, t))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  if (tablesInQuery.length > 0 && refs.columns.length > 0) {
    for (const col of refs.columns) {
      // A column qualifier like "t.foo" comes through as "foo" in
      // the refs list (we strip qualifiers during extraction). We
      // accept the column if ANY referenced table has it.
      const colLc = col.toLowerCase();
      const matched = tablesInQuery.some((t) => t.fieldsLc.has(colLc));
      if (matched) continue;

      // Before rejecting, confirm: the column might be a Data Cloud
      // function output (e.g. COUNT(*), DATE_TRUNC(...)) or a literal
      // alias. Our extractor ignores function calls, but a raw alias
      // like `AS foo` would slip through. We only reject bona-fide
      // DMO-shaped columns (ending in __c) — anything else we pass
      // through to the network.
      if (!/__c$/i.test(col)) continue;

      // Suggest closest matches across all tables named in the query.
      const suggestions: string[] = [];
      for (const t of tablesInQuery) {
        for (const s of dcSuggestColumns(t, col, 3)) {
          if (!suggestions.includes(s)) suggestions.push(s);
        }
      }
      const tableList = refs.tables.map((t) => `"${t}"`).join(", ");
      return JSON.stringify({
        rejected: true,
        server,
        tool,
        reason: `Column "${col}" does not exist on any of the tables in this query (${tableList}). The getDcMetadata response lists every column for each DMO; "${col}" is not one of them, so it is a guess.`,
        instruction:
          suggestions.length > 0
            ? `Copy a real column name verbatim from the metadata response. Closest matches on the tables in this query: ${suggestions.slice(0, 5).map((s) => `"${s}"`).join(", ")}.`
            : `Re-read the fields[] array for ${tableList} in the metadata response and pick a column whose name appears verbatim there.`,
      });
    }
  }

  return null;
}

// data_360 metadata-before-SQL gate. Returns true iff the tool is the
// Data Cloud SQL tool (any MCP-suffixed variant). Paired with
// isDataCloudMetadataTool below, we enforce at the dispatcher level that
// at least one successful getDcMetadata* call has been observed this turn
// before any postDcQuerySql* call is dispatched. Structural enforcement —
// the model cannot hallucinate columns when it is required to read the
// metadata response first.
function isDataCloudSqlTool(server: string, tool: string): boolean {
  return server === "data_360" && /^postDcQuerySql/i.test(tool);
}

function isDataCloudMetadataTool(server: string, tool: string): boolean {
  return server === "data_360" && /^getDcMetadata/i.test(tool);
}

function metadataGatePayload(server: string, tool: string): string {
  return JSON.stringify({
    gate_blocked: true,
    server,
    tool,
    reason:
      "postDcQuerySql requires a successful getDcMetadata call earlier in this turn. The runtime blocked this query because no Data Cloud metadata has been read yet, which means any column or DMO name in the SQL is a guess.",
    instruction:
      "Call the data_360 metadata tool (name starts with \"getDcMetadata\") FIRST. Read its response, find the DMO you want to query, and copy column names verbatim from its fields array. Then retry this SQL. This gate does not trip the circuit breaker, so the SQL tool remains callable once metadata has succeeded.",
  });
}

/** Category labels from getSemanticModels filters — not valid model ids for analyze. */
const TABLEAU_PLACEHOLDER_MODEL_ID = /^(sales|service|marketing|finance|operations)$/i;

function preflightTableauAnalyze(
  server: string,
  tool: string,
  args: Record<string, unknown>
): string | null {
  if (server !== "tableau_next") return null;
  if (!/analyzeSemantic/i.test(tool)) return null;
  const keys = [
    "targetEntityIdOrApiName",
    "targetEntityId",
    "semanticModelId",
    "modelId",
    "entityIdentifier",
  ] as const;
  for (const k of keys) {
    const v = args[k];
    if (typeof v === "string" && TABLEAU_PLACEHOLDER_MODEL_ID.test(v.trim())) {
      return JSON.stringify({
        rejected: true,
        server,
        tool,
        reason: `Invalid semantic model binding: "${v.trim()}" is a category label from getSemanticModels, not a semantic model id. Re-call getSemanticModels, pick one row, and copy its id/apiName/semanticModelId verbatim into analyzeSemanticData.`,
        instruction:
          "Do NOT retry analyzeSemanticData with the same placeholder. Call getSemanticModels in this turn, read the JSON rows, copy a real model identifier field from exactly one row, then call analyze once — or skip tableau_next for this turn.",
      });
    }
  }
  return null;
}

function preflightRejection(
  server: string,
  tool: string,
  args: Record<string, unknown>,
  ctx: { snapshot: DcSnapshot }
): string | null {
  return preflightDataCloudSql(server, tool, args, ctx) ??
    preflightTableauAnalyze(server, tool, args);
}

// Threshold for the breaker. We trip on the very FIRST error matching a
// known-bad signature. Rationale: the model almost never self-corrects an
// INVALID_ARGUMENT/unknown-column mistake, and a CloudFront 403 won't
// disappear on retry either. Tripping on strike one keeps the reasoning
// trail clean for the demo and saves Flex credits.
const SCHEMA_BREAKER_THRESHOLD = 1;

// Synthetic response injected in place of a blocked tool call. Phrased
// as a tool result the model will actually respect — "blocked" plus a
// concrete next-step instruction.
function blockedToolPayload(server: string, tool: string): string {
  return JSON.stringify({
    blocked: true,
    server,
    tool,
    reason:
      "Circuit breaker tripped: this tool returned an error in this turn. Further calls are disabled.",
    instruction:
      "Do NOT retry this tool for the rest of this turn. Do NOT quote the prior error message in your response. Proceed with whatever data you already have from other tools. If you have no data for this request, write a single short sentence saying the source was unavailable and stop — do not fabricate numbers.",
  });
}

/**
 * Run the full tool-calling loop, non-streaming. Streaming is opt-in via
 * onEvent: we emit tool_use / tool_result / text_delta events as they happen.
 */
export async function runAgent(args: AgentRunArgs): Promise<AgentRunResult> {
  const {
    system,
    messages: seed,
    registry,
    maxIterations = 10,
    temperature = 0.3,
    maxTokens = 4096,
    onEvent = () => {},
    forceFirstToolCall = false,
    inferenceBackend = "heroku",
  } = args;

  const client = openAiClientFor(inferenceBackend);
  const model = modelIdFor(inferenceBackend);

  const toolDefs = await registry.listAllTools();
  const tools = toOpenAiTools(toolDefs);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...seed,
  ];

  const collectedCalls: AgentRunResult["toolCalls"] = [];
  let iteration = 0;
  let finalText = "";
  // why: if the loop hits maxIterations, we still want to surface whatever
  // prose the model produced in its LAST assistant turn instead of throwing
  // that away. We keep a running copy here.
  let lastAssistantText = "";

  // Per-run circuit breaker state. Keyed by `${server}.${tool}` so we can
  // block one data_360 tool without blocking the whole server.
  const schemaErrorCount = new Map<string, number>();
  const blockedTools = new Set<string>();

  // Per-turn metadata-before-SQL gate for data_360. Flips to true when the
  // first getDcMetadata* tool call returns without an error. Used by the
  // dispatcher to short-circuit any postDcQuerySql* call that arrives
  // before metadata has been read. See isDataCloudSqlTool / metadataGatePayload.
  let dataCloudMetadataSeen = false;

  // Schema-grounded snapshot for D1/D2 preflight checks. Successful
  // getDcMetadata responses get ingested here; postDcQuerySql calls
  // have their table and column references verified against it before
  // dispatch. Starts empty and grows monotonically within a turn —
  // nothing is shared across turns, because schema can differ by
  // dataspace and we should never reject on stale data from a prior
  // request. See lib/llm/dataCloudSchema.ts.
  const dcSnapshot = emptyDcSnapshot();

  for (iteration = 1; iteration <= maxIterations; iteration++) {
    onEvent({ type: "iteration_start", iteration });

    // why: stream=true gives us text deltas AND lets us watch tool_calls build
    // up incrementally. We still need to fully drain before executing, so we
    // accumulate into a single assistant message.
    // Iteration 1 + forceFirstToolCall → tool_choice: "required".
    // The OpenAI spec says the model MUST emit a tool_call in this mode.
    // We observed /api/ask skipping the tool loop entirely for several
    // free-form questions despite imperative prompting; "required" is the
    // hard guarantee that ends the ambiguity. Every iteration after the
    // first uses "auto" so the model can finalize with plain prose.
    const toolChoice =
      tools.length > 0
        ? iteration === 1 && forceFirstToolCall
          ? ("required" as const)
          : ("auto" as const)
        : undefined;

    const stream = await client.chat.completions.create({
      model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: toolChoice,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    });

    let assistantContent = "";
    const pendingCalls = new Map<
      number,
      {
        id: string;
        name: string;
        argsJson: string;
      }
    >();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        assistantContent += delta.content;
        onEvent({ type: "text_delta", text: delta.content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const prev = pendingCalls.get(idx) ?? {
            id: "",
            name: "",
            argsJson: "",
          };
          if (tc.id) prev.id = tc.id;
          if (tc.function?.name) prev.name = tc.function.name;
          if (tc.function?.arguments) prev.argsJson += tc.function.arguments;
          pendingCalls.set(idx, prev);
        }
      }
    }

    lastAssistantText = assistantContent;

    const calls = [...pendingCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v)
      .filter((c) => c.name);

    // No tool calls → assistant is done.
    if (calls.length === 0) {
      messages.push({
        role: "assistant",
        content: assistantContent.trim() || " ",
      });
      finalText = assistantContent.trim();
      onEvent({ type: "final", text: finalText });
      return {
        text: finalText,
        toolCalls: collectedCalls,
        iterations: iteration,
        transcript: messages.slice(1),
      };
    }

    // Record the assistant turn with the tool_calls before we execute them.
    //
    // why: Heroku Inference's /v1/chat/completions wrapper rejects a null,
    // omitted, or empty-string `content` on assistant messages with
    // tool_calls ("400 messages[N]: content is required"). OpenAI direct
    // accepts null; Heroku does not. So we ALWAYS pass a non-empty string,
    // falling back to a tiny placeholder when Claude emitted no prose for
    // this turn. Claude ignores placeholder content on assistant turns with
    // tool_calls, so this doesn't pollute the conversation.
    messages.push({
      role: "assistant",
      content: assistantContent || " ",
      tool_calls: calls.map((c) => ({
        id: c.id || cryptoRandomId(),
        type: "function" as const,
        function: { name: c.name, arguments: c.argsJson || "{}" },
      })),
    });

    // Execute in parallel, but gate each call through the circuit breaker.
    // Blocked calls skip the network hop entirely and return a synthetic
    // payload that steers the model toward a different plan.
    const results = await Promise.all(
      calls.map(async (c) => {
        const parsed = parseToolName(c.name);
        const server = parsed?.server ?? "salesforce_crm";
        const tool = parsed?.name ?? c.name;
        const key = `${server}.${tool}`;
        let argObj: Record<string, unknown> = {};
        try {
          argObj = c.argsJson ? JSON.parse(c.argsJson) : {};
        } catch (e) {
          return {
            c,
            server,
            tool,
            argObj: {},
            result: {
              server,
              tool,
              isError: true,
              content: null,
              textPreview: `bad JSON from model: ${String(e)}`,
              modelText: `bad JSON from model: ${String(e)}`,
            },
          };
        }

        // Circuit breaker — short-circuit repeated errors.
        // We still emit tool_use/tool_result events so the reasoning trail
        // shows that the call was attempted and silenced.
        if (blockedTools.has(key)) {
          onEvent({ type: "tool_use", server, tool, input: argObj });
          const blockedPreview = blockedToolPayload(server, tool);
          onEvent({
            type: "tool_result",
            server,
            tool,
            preview: "blocked by schema-mismatch breaker",
            is_error: true,
          });
          return {
            c,
            server,
            tool,
            argObj,
            result: {
              server: server as McpServerName,
              tool,
              isError: true,
              content: null,
              textPreview: blockedPreview,
              modelText: blockedPreview,
            },
          };
        }

        // Metadata-before-SQL gate (data_360). Structural enforcement: a
        // postDcQuerySql call is not dispatched unless at least one
        // getDcMetadata call has already succeeded in this turn. Without
        // this, the model sometimes types column names from memory and
        // the SQL fails with "unknown column", tripping the circuit
        // breaker and showing a rejection row in the reasoning trail.
        // Gate rejections do NOT trip the breaker — the model is
        // expected to satisfy the gate by calling getDcMetadata, then
        // retry. Per-turn by design; we want fresh metadata each Ask.
        if (
          isDataCloudSqlTool(server, tool) &&
          !dataCloudMetadataSeen
        ) {
          onEvent({ type: "tool_use", server, tool, input: argObj });
          const gatePayload = metadataGatePayload(server, tool);
          onEvent({
            type: "tool_result",
            server,
            tool,
            preview: gatePayload,
            is_error: true,
          });
          return {
            c,
            server,
            tool,
            argObj,
            result: {
              server: server as McpServerName,
              tool,
              isError: true,
              content: null,
              textPreview: gatePayload,
              modelText: gatePayload,
            },
          };
        }

        // Pre-flight guardrail — intercept obviously-wrong Data Cloud
        // queries before they hit the network. Cheaper than a round-trip
        // and keeps forbidden patterns out of the trail. The snapshot
        // carries this turn's ingested getDcMetadata responses; the
        // preflight uses it to verify table and column references.
        const rejection = preflightRejection(server, tool, argObj, {
          snapshot: dcSnapshot,
        });
        if (rejection) {
          onEvent({ type: "tool_use", server, tool, input: argObj });
          onEvent({
            type: "tool_result",
            server,
            tool,
            preview: rejection,
            is_error: true,
          });
          // Also trip the breaker so a retry with a different-but-still-bad
          // query doesn't slip through.
          blockedTools.add(key);
          return {
            c,
            server,
            tool,
            argObj,
            result: {
              server: server as McpServerName,
              tool,
              isError: true,
              content: null,
              textPreview: rejection,
              modelText: rejection,
            },
          };
        }

        onEvent({
          type: "tool_use",
          server,
          tool,
          input: argObj,
        });
        const result = await registry.callTool(c.name, argObj);
        onEvent({
          type: "tool_result",
          server: result.server,
          tool: result.tool,
          preview: result.textPreview,
          is_error: result.isError,
        });

        // Trip the breaker on any recognized error signature.
        if (result.isError && isTrippedError(result.textPreview)) {
          const n = (schemaErrorCount.get(key) ?? 0) + 1;
          schemaErrorCount.set(key, n);
          if (n >= SCHEMA_BREAKER_THRESHOLD) {
            blockedTools.add(key);
          }
        }

        // Open the metadata gate on a successful getDcMetadata response
        // and ingest the response into the schema snapshot. Both the
        // gate and the snapshot are per-turn — no cross-request state.
        if (
          !result.isError &&
          isDataCloudMetadataTool(server, tool)
        ) {
          dataCloudMetadataSeen = true;
          ingestDcMetadata(dcSnapshot, result.modelText);
        }

        return { c, server, tool, argObj, result };
      })
    );

    // Push one `role: "tool"` message per call, in the same order as tool_calls.
    for (const r of results) {
      collectedCalls.push({
        server: r.result.server,
        tool: r.result.tool,
        input: r.argObj,
        isError: r.result.isError,
        preview: r.result.textPreview,
      });
      messages.push({
        role: "tool",
        tool_call_id: r.c.id || "unknown",
        // why: the model needs the full tool output to reason correctly
        // (schema-introspection responses like getDcMetadata are multi-KB
        // and were previously truncated to 2KB, forcing the model to
        // hallucinate table/column names). modelText carries the larger
        // per-tool budget; textPreview stays UI-only.
        //
        // Heroku Inference rejects empty tool-result content the same way
        // it rejects empty assistant content. An MCP tool can legitimately
        // return an empty-string result (e.g. a successful void write), so
        // we substitute a minimal summary so the model still sees the
        // call-happened signal.
        content:
          r.result.modelText && r.result.modelText.length > 0
            ? r.result.modelText
            : r.result.isError
              ? "(tool error with empty content)"
              : "(tool call succeeded with no output)",
      });
    }
    // Loop continues — Claude reads the tool results and decides next action.
  }

  // Hit iteration cap without a clean finish. Before giving up, run ONE
  // final no-tools completion to force the model to write prose from the
  // tool results it already has. This catches the "tool_calls=N, prose=''"
  // silent-failure mode we saw on the "top at-risk check-in" Ask Bar run
  // (FIX_PASS.md P0-2 verification): 13 successful tool calls, zero text
  // deltas, blank response panel.
  //
  // why a second request instead of rewriting the loop: the loop condition
  // is "model emits tool_calls → execute → feed back". If the LAST turn
  // emitted tool_calls *again* on iteration maxIterations we exit before
  // the model ever gets the results from that round, so lastAssistantText
  // is empty. A follow-up with tool_choice:"none" forces summarization.
  if (!lastAssistantText.trim() && tools.length > 0) {
    try {
      onEvent({
        type: "error",
        message: `iteration cap (${maxIterations}) reached with no prose — forcing finalize pass`,
      });
      const finalize = await client.chat.completions.create({
        model,
        messages: [
          ...messages,
          {
            role: "user",
            content:
              "You have reached the tool budget. Using only the tool results you have already seen in this turn, write the user-visible answer now. Follow the OUTPUT FORMAT from the original system prompt. Do NOT call any tools.",
          },
        ],
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: "none" as const,
        temperature,
        max_tokens: maxTokens,
        stream: true,
      });
      let forced = "";
      for await (const chunk of finalize) {
        const delta = chunk.choices[0]?.delta;
        const piece = typeof delta?.content === "string" ? delta.content : "";
        if (piece) {
          forced += piece;
          onEvent({ type: "text_delta", text: piece });
        }
      }
      lastAssistantText = forced;
      messages.push({
        role: "assistant",
        content: forced.trim() || " ",
      });
    } catch (e) {
      onEvent({
        type: "error",
        message: `finalize pass failed: ${String(e)}`,
      });
    }
  }

  finalText = (lastAssistantText || finalText).trim();
  if (!finalText || lastAssistantText.length === 0) {
    onEvent({
      type: "error",
      message: `exceeded max iterations (${maxIterations}) — returning best-effort narrative`,
    });
  }
  onEvent({
    type: "final",
    text: finalText || "(agent exceeded iteration cap without final answer)",
  });
  return {
    text: finalText || "(agent exceeded iteration cap without final answer)",
    toolCalls: collectedCalls,
    iterations: iteration - 1,
    transcript: messages.slice(1),
  };
}

function cryptoRandomId(): string {
  // Node 18+ has globalThis.crypto.randomUUID.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `tc_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}
