"use client";

import { useEffect, useMemo, useState } from "react";
import type { PriorityClient } from "@/types/horizon";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import { ReasoningTrail } from "./ReasoningTrail";
import { ClientDetailSheet } from "./ClientDetailSheet";

// Heroku caps non-streaming HTTP at 30s; the priority agent loop routinely
// needs 40–60s for a cold cross-MCP fetch. We ride the same SSE pipeline as
// /api/ask + /api/brief and parse the accumulated narrative as JSON once the
// stream closes. Visible progress is a nice bonus — bankers see the MCPs
// light up instead of staring at a spinner.
export function PriorityQueue() {
  const { narrative, steps, state, error, start } = useAgentStream();
  const [hasStarted, setHasStarted] = useState(false);
  const [selectedClient, setSelectedClient] = useState<PriorityClient | null>(
    null
  );

  useEffect(() => {
    if (hasStarted) return;
    setHasStarted(true);
    start("/api/priority", undefined, { method: "GET" }).catch(() => {});
  }, [hasStarted, start]);

  const { clients, note } = useMemo(() => parsePriorityPayload(narrative), [
    narrative,
  ]);
  const isLoading = state === "streaming" || (state === "idle" && !hasStarted);
  const emptyMessage =
    state === "error"
      ? error ?? "Priority queue unavailable."
      : note ?? null;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-[0.18em] text-text-muted">
          Priority queue
        </h2>
        {isLoading && (
          <span className="text-[10px] font-mono text-text-muted/70">
            {steps.length > 0
              ? `scanning · ${steps.length} MCP call${steps.length === 1 ? "" : "s"}`
              : "reasoning…"}
          </span>
        )}
      </div>

      <ul className="mt-6 divide-y divide-border/60">
        {isLoading && clients.length === 0 && (
          <>
            <li className="h-12 rounded-md shimmer" aria-hidden />
            <li className="h-12 rounded-md shimmer" aria-hidden />
            <li className="h-12 rounded-md shimmer" aria-hidden />
          </>
        )}
        {!isLoading && clients.length === 0 && (
          <li className="py-4 text-sm text-text-muted">
            {emptyMessage ?? "No priorities available yet."}
          </li>
        )}
        {clients.map((c) => (
          <li key={c.client_id}>
            <button
              type="button"
              onClick={() => setSelectedClient(c)}
              className="group flex w-full items-start justify-between gap-6 py-5 text-left transition-colors duration-fast ease-out hover:bg-surface2/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            >
              <div>
                <div className="font-medium text-text group-hover:text-accent">
                  {c.name}
                </div>
                <div className="mt-1 text-sm text-text-muted">{c.reason}</div>
                {c.sources && c.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted/70">
                    {c.sources.map((s) => (
                      <span
                        key={s}
                        className="rounded border border-border/50 px-1.5 py-0.5"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 font-mono text-xs text-accent">
                {c.score.toFixed(0)}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {steps.length > 0 && (
        <div className="mt-4">
          <ReasoningTrail steps={steps} defaultOpen={false} />
        </div>
      )}

      {selectedClient && (
        <ClientDetailSheet
          clientId={selectedClient.client_id}
          clientName={selectedClient.name}
          onClose={() => setSelectedClient(null)}
        />
      )}
    </div>
  );
}

// The priority prompt instructs Claude to return a JSON object with a
// `clients` array. The model sometimes wraps it in a ```json fence; sometimes
// it emits conversational text before the object. We strip fences and try
// to locate a JSON object by balancing braces. Anything unparseable surfaces
// as a note so the UI can explain itself instead of erroring silently.
interface PriorityPayload {
  clients: PriorityClient[];
  note: string | null;
}

function parsePriorityPayload(text: string): PriorityPayload {
  if (!text || !text.trim()) return { clients: [], note: null };
  const parsed = tryParseJson<{
    clients?: PriorityClient[];
    error?: string;
  }>(text);
  if (!parsed) return { clients: [], note: null };
  if (Array.isArray(parsed.clients) && parsed.clients.length > 0) {
    return { clients: parsed.clients, note: null };
  }
  if (typeof parsed.error === "string") {
    return { clients: [], note: parsed.error };
  }
  return { clients: [], note: null };
}
