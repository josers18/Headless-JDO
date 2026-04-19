"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { PriorityClient } from "@/types/horizon";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import { cn } from "@/lib/utils";
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
        <h2 className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-text-muted">
          <span
            className={cn(
              "inline-block h-[6px] w-[6px] rounded-full bg-accent-2/80",
              isLoading && "animate-glow-pulse"
            )}
          />
          Priority queue
        </h2>
        {isLoading && (
          <span className="font-mono text-[10px] text-text-muted/70">
            {steps.length > 0
              ? `${steps.length} MCP call${steps.length === 1 ? "" : "s"}`
              : "reasoning…"}
          </span>
        )}
      </div>

      <ul className="mt-6 space-y-1">
        {isLoading && clients.length === 0 && (
          <>
            <li className="h-[72px] rounded-lg shimmer" aria-hidden />
            <li className="h-[72px] rounded-lg shimmer" aria-hidden />
            <li className="h-[72px] rounded-lg shimmer" aria-hidden />
          </>
        )}
        {!isLoading && clients.length === 0 && (
          <li className="py-4 text-sm text-text-muted">
            {emptyMessage ?? "No priorities available yet."}
          </li>
        )}
        {clients.map((c, idx) => (
          <li key={c.client_id} className="animate-fade-rise">
            <button
              type="button"
              onClick={() => setSelectedClient(c)}
              className="group relative grid w-full grid-cols-[56px_1fr_auto] items-center gap-5 rounded-lg border border-transparent px-4 py-4 text-left transition-colors duration-med ease-out hover:border-border-soft hover:bg-surface/60 focus:outline-none focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/30"
            >
              {/* Row index — set in a soft disk so it reads as a badge. */}
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-surface text-[12px] font-mono tabular-nums text-text-muted group-hover:border-accent/40 group-hover:text-accent">
                {String(idx + 1).padStart(2, "0")}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[15px] font-medium text-text group-hover:text-text">
                    {c.name}
                  </span>
                  <ChevronRight
                    size={13}
                    className="shrink-0 text-text-muted/40 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:text-accent/80"
                  />
                </div>
                <div className="mt-1 truncate text-[13px] leading-relaxed text-text-muted">
                  {c.reason}
                </div>
                {c.sources && c.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted/70">
                    {c.sources.map((s) => (
                      <span
                        key={s}
                        className="rounded border border-border-soft px-1.5 py-0.5"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <ScorePill score={c.score} />
            </button>
          </li>
        ))}
      </ul>

      {steps.length > 0 && (
        <div className="mt-6">
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

// Score pill — a mini horizontal bar + numeric readout. The bar uses the
// accent gradient and a subtle glow that scales with the score so high-
// priority rows pop. Score is clamped to [0, 100].
function ScorePill({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const pct = `${clamped}%`;
  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className="relative h-[6px] w-[72px] overflow-hidden rounded-full bg-border-soft">
        <div
          className="h-full rounded-full bg-accent-sheen"
          style={{
            width: pct,
            boxShadow:
              clamped >= 70
                ? "0 0 12px rgba(91, 141, 239, 0.55)"
                : "0 0 6px rgba(91, 141, 239, 0.3)",
          }}
        />
      </div>
      <span className="w-[28px] text-right font-mono text-[13px] tabular-nums text-text">
        {clamped.toFixed(0)}
      </span>
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
