/**
 * lib/client/actions/registry.ts — the single source of truth for every
 * clickable thing in Horizon (A-1). An "Action" is a declarative record of
 * intent; a "Dispatcher" turns that intent into a concrete side effect.
 *
 * Every ActionRow, Priority Queue row, Live Signal, Pulse tile, and Pulse
 * Strip segment should go through this registry. The upside: every place
 * the banker taps, we get consistent behavior, one code path for undo +
 * telemetry, and the autonomy guardrails in C-3 attach here.
 */

import {
  dispatchHorizonAskSubmit,
  dispatchHorizonPrepSubmit,
  dispatchHorizonFocusClient,
  HORIZON_REFRESH_BRIEF,
  HORIZON_REFRESH_ARC,
  HORIZON_REFRESH_PRIORITY,
  HORIZON_REFRESH_PULSE,
  HORIZON_REFRESH_DRAFTS,
} from "@/lib/client/horizonEvents";

// ----------------------------------------------------------------------
// Action types — extend freely; keep `kind` as a closed union so
// TypeScript can switch-exhaustively in dispatchers.
// ----------------------------------------------------------------------

export type ActionKind =
  | "ask"            // Route through AskBar with a question + context
  | "open_client"    // Open the Client Detail Sheet
  | "lightning"      // Open Salesforce Lightning record in a new tab
  | "prep"           // Prep-me meeting briefing (C-2)
  | "draft_email"    // Ask the agent to draft an email for this target
  | "draft_call"     // Ask the agent to draft a call script
  | "create_task"    // Ask the agent to draft a Task (approval required)
  | "snooze"         // Snooze this item for N minutes (in-memory or URL snooze)
  | "dismiss"        // Drop from the current surface
  | "refresh"        // Re-fetch a specific Horizon surface
  | "do_for_me"      // C-3: execute end-to-end if allowlist permits
  | "execute"        // Direct execute of an already-approved draft
  | "investigate";   // Shorthand for "ask: why?"

export interface BaseAction<K extends ActionKind = ActionKind> {
  kind: K;
  /** Short label for the button. */
  label: string;
  /** Optional hint on why this is a good/safe action. */
  hint?: string;
}

export interface AskAction extends BaseAction<"ask"> {
  question: string;
  context?: string;
}

export interface OpenClientAction extends BaseAction<"open_client"> {
  clientId: string;
  clientName?: string;
}

export interface LightningAction extends BaseAction<"lightning"> {
  recordId: string;
  /** Used only when the inferred object type cannot be derived from the id. */
  objectOverride?: string;
}

export interface PrepAction extends BaseAction<"prep"> {
  clientId: string;
  clientName?: string;
  /** E.g. "10:00 AM meeting" — gives the agent temporal grounding. */
  meetingHint?: string;
}

export interface DraftEmailAction extends BaseAction<"draft_email"> {
  clientId?: string;
  clientName?: string;
  reason: string;
}

export interface DraftCallAction extends BaseAction<"draft_call"> {
  clientId?: string;
  clientName?: string;
  reason: string;
}

export interface CreateTaskAction extends BaseAction<"create_task"> {
  clientId?: string;
  clientName?: string;
  subject: string;
  dueHint?: string;
}

export interface SnoozeAction extends BaseAction<"snooze"> {
  itemKey: string;
  minutes: number;
}

export interface DismissAction extends BaseAction<"dismiss"> {
  itemKey: string;
}

export interface RefreshAction extends BaseAction<"refresh"> {
  surface: "brief" | "arc" | "priority" | "pulse" | "drafts";
}

export interface DoForMeAction extends BaseAction<"do_for_me"> {
  /** The same shape we'd have drafted — just flagged for auto-execution. */
  plan:
    | { kind: "task"; clientId?: string; subject: string; dueHint?: string }
    | { kind: "email"; clientId?: string; subject: string; body: string }
    | { kind: "note"; clientId: string; body: string };
  reason: string;
}

export interface ExecuteAction extends BaseAction<"execute"> {
  draftId: string;
}

export interface InvestigateAction extends BaseAction<"investigate"> {
  question: string;
  context?: string;
}

export type HorizonAction =
  | AskAction
  | OpenClientAction
  | LightningAction
  | PrepAction
  | DraftEmailAction
  | DraftCallAction
  | CreateTaskAction
  | SnoozeAction
  | DismissAction
  | RefreshAction
  | DoForMeAction
  | ExecuteAction
  | InvestigateAction;

// ----------------------------------------------------------------------
// Agent Log — every dispatched action lands here so the banker has an
// audit trail. Also the substrate for undo + "Do this for me" telemetry.
// ----------------------------------------------------------------------

export interface AgentLogEntry {
  id: string;
  timestamp: number;
  action: HorizonAction;
  outcome: "queued" | "success" | "error" | "skipped";
  message?: string;
  /** Optional undo token registered by the dispatcher. */
  undo?: () => void | Promise<void>;
}

type LogListener = (entries: AgentLogEntry[]) => void;

const MAX_LOG = 50;

class AgentLogStore {
  private entries: AgentLogEntry[] = [];
  private listeners = new Set<LogListener>();

  push(entry: AgentLogEntry) {
    this.entries = [entry, ...this.entries].slice(0, MAX_LOG);
    this.notify();
  }

  update(id: string, patch: Partial<AgentLogEntry>) {
    this.entries = this.entries.map((e) =>
      e.id === id ? { ...e, ...patch } : e
    );
    this.notify();
  }

  all(): AgentLogEntry[] {
    return this.entries;
  }

  subscribe(l: LogListener): () => void {
    this.listeners.add(l);
    l(this.entries);
    return () => this.listeners.delete(l);
  }

  private notify() {
    for (const l of this.listeners) l(this.entries);
  }
}

export const agentLog = new AgentLogStore();

// ----------------------------------------------------------------------
// Snooze store — session-scoped map of itemKey → until-timestamp.
// Dismissals are also snoozes with a very long TTL.
// ----------------------------------------------------------------------

const SNOOZE_KEY = "hz:snoozes:v1";

function readSnoozes(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(SNOOZE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeSnoozes(m: Record<string, number>) {
  try {
    sessionStorage.setItem(SNOOZE_KEY, JSON.stringify(m));
  } catch {
    /* quota — fine, snoozes are non-critical */
  }
}

export function isSnoozed(key: string): boolean {
  const m = readSnoozes();
  const u = m[key];
  return typeof u === "number" && u > Date.now();
}

export function snooze(key: string, minutes: number) {
  const m = readSnoozes();
  m[key] = Date.now() + minutes * 60_000;
  writeSnoozes(m);
  window.dispatchEvent(new CustomEvent("horizon:snoozed", { detail: { key } }));
}

export function dismiss(key: string) {
  snooze(key, 60 * 24 * 7); // 7 days
}

// ----------------------------------------------------------------------
// Autonomy allowlist (C-3) — a short, audited list of what "Do this for me"
// is allowed to execute without per-action approval. Anything not on the
// allowlist routes through approval regardless.
//
// Guardrails (these are HARD rules, not preferences):
//   - Never auto-send an external email.
//   - Never auto-create an Opportunity stage change.
//   - Never auto-update a financial Amount or AUM figure.
//   - Internal Task/Note creation is the only auto-eligible write.
// ----------------------------------------------------------------------

export interface AutonomyRule {
  /** Human-readable name for the log/settings panel. */
  name: string;
  /** True => action can be auto-executed; false => always needs approval. */
  predicate: (a: DoForMeAction) => boolean;
}

export const AUTONOMY_ALLOWLIST: AutonomyRule[] = [
  {
    name: "Internal Task creation",
    predicate: (a) => a.plan.kind === "task",
  },
  {
    name: "Private Note attached to a client",
    predicate: (a) => a.plan.kind === "note",
  },
];

export const AUTONOMY_DENYLIST: AutonomyRule[] = [
  {
    name: "External email sends",
    predicate: (a) => a.plan.kind === "email",
  },
];

export function canAutoExecute(a: DoForMeAction): boolean {
  if (AUTONOMY_DENYLIST.some((r) => r.predicate(a))) return false;
  return AUTONOMY_ALLOWLIST.some((r) => r.predicate(a));
}

/**
 * Bridge a DoForMeAction's embedded plan into the DraftAction shape that
 * `/api/actions` expects. We keep this local so the registry stays the only
 * module that knows the `do_for_me → draft` translation.
 */
function doForMeToDraft(a: DoForMeAction): {
  kind: string;
  target_object: string;
  target_id: string;
  title: string;
  body: string;
  confidence: number;
} {
  const plan = a.plan;
  if (plan.kind === "task") {
    return {
      kind: "task",
      target_object: "Task",
      target_id: plan.clientId ?? "",
      title: plan.subject,
      body: plan.dueHint ? `Due ${plan.dueHint}. ${a.reason}` : a.reason,
      confidence: 100,
    };
  }
  if (plan.kind === "note") {
    return {
      kind: "update",
      target_object: "Note",
      target_id: plan.clientId,
      title: "Private note",
      body: plan.body,
      confidence: 100,
    };
  }
  return {
    kind: "email",
    target_object: "Email",
    target_id: plan.clientId ?? "",
    title: plan.subject,
    body: plan.body,
    confidence: 100,
  };
}

// ----------------------------------------------------------------------
// Dispatcher — the single entry point. Every ActionRow button calls
// `dispatchAction(action)`. Dispatcher returns a promise that resolves
// with the log entry id so callers can wire "undo" if they want to.
// ----------------------------------------------------------------------

export interface DispatchOptions {
  /** Optional focus-client hint so AskBar can tag context. */
  focus?: { clientId?: string; clientName?: string };
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `act-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export async function dispatchAction(
  action: HorizonAction,
  opts: DispatchOptions = {}
): Promise<string> {
  const id = nextId();
  agentLog.push({
    id,
    timestamp: Date.now(),
    action,
    outcome: "queued",
  });

  try {
    await runAction(action, opts);
    agentLog.update(id, { outcome: "success" });
  } catch (e) {
    agentLog.update(id, {
      outcome: "error",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return id;
}

async function runAction(
  action: HorizonAction,
  opts: DispatchOptions
): Promise<void> {
  switch (action.kind) {
    case "ask": {
      const context = [
        opts.focus?.clientName
          ? `Client in focus: ${opts.focus.clientName}`
          : "",
        action.context ?? "",
      ]
        .filter(Boolean)
        .join("\n");
      dispatchHorizonAskSubmit({
        q: action.question,
        context: context.trim() || undefined,
      });
      return;
    }
    case "investigate": {
      dispatchHorizonAskSubmit({
        q: action.question,
        context: action.context,
      });
      return;
    }
    case "open_client": {
      dispatchHorizonFocusClient({
        name: action.clientName ?? "Client",
        clientId: action.clientId,
      });
      return;
    }
    case "lightning": {
      // Lightning link actions are handled by anchors in-row (see
      // <a href target=_blank>). Dispatching here is a no-op fallback so
      // keyboard handlers can still call dispatchAction.
      window.dispatchEvent(
        new CustomEvent("horizon:open-lightning", {
          detail: { recordId: action.recordId },
        })
      );
      return;
    }
    case "prep": {
      dispatchHorizonPrepSubmit({
        clientId: action.clientId,
        clientName: action.clientName,
        reason: action.meetingHint,
      });
      return;
    }
    case "draft_email": {
      const target = action.clientName ?? "this client";
      dispatchHorizonAskSubmit({
        q: `Draft an email to ${target}. Reason: ${action.reason}. Keep it under 120 words, warm but professional, with one clear next step.`,
        context: action.clientId ? `Client id: ${action.clientId}` : undefined,
      });
      return;
    }
    case "draft_call": {
      const target = action.clientName ?? "this client";
      dispatchHorizonAskSubmit({
        q: `Draft a 3-bullet call script for ${target}. Reason: ${action.reason}. Open, ask, close.`,
        context: action.clientId ? `Client id: ${action.clientId}` : undefined,
      });
      return;
    }
    case "create_task": {
      const who = action.clientName ?? "the related client";
      const due = action.dueHint ? ` due ${action.dueHint}` : "";
      dispatchHorizonAskSubmit({
        q: `Create a Salesforce Task for ${who}${due}: "${action.subject}". Draft only — I'll approve before it commits.`,
        context: action.clientId ? `Client id: ${action.clientId}` : undefined,
      });
      return;
    }
    case "snooze": {
      snooze(action.itemKey, action.minutes);
      return;
    }
    case "dismiss": {
      dismiss(action.itemKey);
      return;
    }
    case "refresh": {
      const ev =
        action.surface === "brief"
          ? HORIZON_REFRESH_BRIEF
          : action.surface === "arc"
          ? HORIZON_REFRESH_ARC
          : action.surface === "priority"
          ? HORIZON_REFRESH_PRIORITY
          : action.surface === "pulse"
          ? HORIZON_REFRESH_PULSE
          : HORIZON_REFRESH_DRAFTS;
      window.dispatchEvent(new Event(ev));
      return;
    }
    case "do_for_me": {
      if (!canAutoExecute(action)) {
        // Fall back to approval path via AskBar — the banker reviews the
        // drafted plan and approves before anything commits.
        dispatchHorizonAskSubmit({
          q: `Plan and draft (do not execute): ${action.reason}. I'll review before anything commits.`,
          context: JSON.stringify(action.plan),
        });
        return;
      }
      // Auto-exec path: POST to /api/actions with a DraftAction-shaped
      // payload that /api/actions understands (kind + target_id + title/body).
      const draft = doForMeToDraft(action);
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: draft }),
      });
      if (!res.ok) throw new Error(`do_for_me failed (${res.status})`);
      return;
    }
    case "execute": {
      // `execute` is kept as a legacy entry point; real draft execution is
      // wired through PreDraftedActions's approve handler, which already
      // posts the DraftAction to /api/actions.
      return;
    }
  }
}
