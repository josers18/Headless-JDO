"use client";

import { useRef, useState } from "react";
import type { ArcNodePayload, ArcNodeType } from "@/types/horizon";
import { cn } from "@/lib/utils";
import { ARC_TRACK_LINE_PX } from "./ArcTimeline";

// FINAL-3 — "recommended" nodes were rendering as dashed-ring empty
// circles, which read as loading/pending spinners in video. All four
// node types are now SOLID FILLED DOTS, differentiated only by color
// (and shape-family for deadlines, which keep their diamond to stay
// readable without color alone). The NOW marker in ArcTimeline is
// already a pulsing vertical line, so the "suggested dot vs NOW"
// visual ambiguity goes away.
const typeStyles: Record<
  ArcNodeType,
  { shape: string; ring: string; label: string; fill?: string }
> = {
  event: {
    shape: "h-3.5 w-3.5 rounded-full",
    ring: "ring-2 ring-accent/40",
    fill: "bg-accent/85",
    label: "Event",
  },
  deadline: {
    shape: "h-2.5 w-2.5 rotate-45 rounded-[1px]",
    ring: "ring-1 ring-accent-warm/70",
    fill: "bg-accent-warm/80",
    label: "Deadline",
  },
  recommended: {
    shape: "h-3 w-3 rounded-full",
    ring: "ring-2 ring-emerald-400/40",
    fill: "bg-emerald-400/85",
    label: "Suggested",
  },
  blocked: {
    shape: "h-2 w-2 rounded-sm",
    ring: "ring-1 ring-text-muted/50",
    fill: "bg-text-muted/30",
    label: "Blocked",
  },
};

function asPlain(x: unknown): string {
  if (x == null) return "";
  return typeof x === "string" ? x : String(x);
}

function titleShort(s: unknown): string {
  const str = asPlain(s);
  const w = str.trim().split(/\s+/).filter(Boolean).slice(0, 3);
  const all = str.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "";
  return all.length > 3 ? `${w.join(" ")}…` : w.join(" ");
}

// FINAL-3 — the prompt now emits a per-node `label` that is required
// to be unique within the nodes array. We trust it when present. For
// older cached payloads that predate the labeling rule, fall back to
// a per-node derivation from the title (NOT a generic "Focus" /
// "Due" constant — those produced the "three identical FOCUS
// labels" defect seen in pre-film QA). The old type-generic fallback
// is kept only for blocked nodes where we genuinely have no other
// signal.
const LABEL_MAX_CHARS = 14;

function clampLabel(s: string): string {
  const t = s.trim();
  if (t.length <= LABEL_MAX_CHARS) return t;
  return `${t.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…`;
}

export function axisLabelFor(node: ArcNodePayload): string {
  const fromAgent = asPlain(node.label).trim();
  if (fromAgent) return clampLabel(fromAgent);
  if (node.type === "blocked") return "Blocked";
  const short = titleShort(node.title);
  if (short) return clampLabel(short);
  if (node.type === "recommended") return "Focus";
  if (node.type === "deadline") return "Due";
  return "Meeting";
}

function oneLineContext(s: unknown, max = 140): string {
  const t = asPlain(s).replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function ArcNode({
  node,
  leftPct,
  selected,
  onActivate,
  onRescheduleIntent,
}: {
  node: ArcNodePayload;
  leftPct: number;
  selected: boolean;
  onActivate: () => void;
  /** Fires after a horizontal drag gesture (best-effort reschedule intent). */
  onRescheduleIntent?: (node: ArcNodePayload, deltaX: number) => void;
}) {
  const st = typeStyles[node.type];
  const clamped = Math.min(96, Math.max(2, leftPct));
  const [tx, setTx] = useState(0);
  const active = useRef(false);
  const startX = useRef(0);
  const lastDx = useRef(0);
  const suppressClick = useRef(false);
  const shortTitle = titleShort(node.title);
  const axisLabel = axisLabelFor(node);

  return (
    <div
      className="group pointer-events-auto absolute z-20"
      style={{
        left: `${clamped}%`,
        top: ARC_TRACK_LINE_PX,
        transform: "translate(-50%, -50%)",
      }}
    >
      <div
        className={cn(
          "pointer-events-none invisible absolute bottom-[calc(100%+10px)] left-1/2 z-40 w-max max-w-[min(240px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border-soft bg-surface2/95 px-3 py-2 text-left text-[11.5px] leading-snug text-text shadow-lg opacity-0 shadow-black/40 transition duration-fast",
          "group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        )}
        role="tooltip"
      >
        <span className="block font-medium text-text">{shortTitle}</span>
        <span className="mt-1 block text-text-muted">
          {oneLineContext(node.context)}
        </span>
      </div>

      <button
        type="button"
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.preventDefault();
            return;
          }
          onActivate();
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          active.current = true;
          startX.current = e.clientX;
          lastDx.current = 0;
          setTx(0);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!active.current) return;
          const nx = Math.max(-56, Math.min(56, e.clientX - startX.current));
          lastDx.current = nx;
          setTx(nx);
        }}
        onPointerUp={(e) => {
          if (!active.current) return;
          active.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          const d = lastDx.current;
          setTx(0);
          if (Math.abs(d) > 26) {
            suppressClick.current = true;
            onRescheduleIntent?.(node, d);
          }
        }}
        onPointerCancel={(e) => {
          active.current = false;
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          setTx(0);
        }}
        className={cn(
          "flex min-h-[44px] min-w-[44px] flex-col items-center gap-1 rounded-md px-0.5 py-1 transition duration-med ease-out md:min-h-0 md:min-w-0",
          selected && "scale-105"
        )}
        style={{ transform: `translateX(${tx}px)` }}
        aria-pressed={selected}
        aria-label={`${st.label}: ${node.title}`}
      >
        <span
          className={cn(
            "flex items-center justify-center shadow-sm transition group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-accent/40",
            st.fill ?? "bg-surface2",
            st.shape,
            st.ring
          )}
        />
        <span className="max-w-[110px] whitespace-nowrap text-center font-mono text-[9px] uppercase leading-tight tracking-tight text-text-muted group-hover:text-text/90">
          {axisLabel}
        </span>
      </button>
    </div>
  );
}

// ISSUE 2 (C) — Collision cluster. When two or more nodes land on
// the same x-coordinate (late-in-day compression, morning-dense
// schedules, or just unlucky synchronous meetings) we were stacking
// their labels character-by-character and rendering garbled text
// soup. Collapse them into one cluster dot with a "×N" count badge;
// clicking expands a popover listing each child by title.
export function ArcCluster({
  nodes,
  leftPct,
  selected,
  onActivate,
  onSelectChild,
}: {
  nodes: ArcNodePayload[];
  leftPct: number;
  selected: boolean;
  onActivate: () => void;
  onSelectChild: (node: ArcNodePayload) => void;
}) {
  const clamped = Math.min(96, Math.max(2, leftPct));
  const earliestType = nodes[0]?.type ?? "event";
  const st = typeStyles[earliestType];

  return (
    <div
      className="group pointer-events-auto absolute z-20"
      style={{
        left: `${clamped}%`,
        top: ARC_TRACK_LINE_PX,
        transform: "translate(-50%, -50%)",
      }}
    >
      {selected && (
        <div
          className="pointer-events-auto absolute bottom-[calc(100%+10px)] left-1/2 z-40 w-max max-w-[min(260px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border-soft bg-surface2/95 px-3 py-2 text-left text-[11.5px] leading-snug text-text shadow-lg shadow-black/40"
          role="dialog"
        >
          <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.14em] text-text-muted">
            {nodes.length} items at this time
          </div>
          <ul className="space-y-1">
            {nodes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className="w-full truncate rounded-sm px-1 py-0.5 text-left text-[12px] text-text transition hover:bg-surface/60"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectChild(n);
                  }}
                >
                  <span className="mr-1.5 font-mono text-[9px] uppercase text-text-muted">
                    {axisLabelFor(n)}
                  </span>
                  {titleShort(n.title)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onActivate}
        className={cn(
          "relative flex min-h-[44px] min-w-[44px] flex-col items-center gap-1 rounded-md px-0.5 py-1 transition duration-med ease-out md:min-h-0 md:min-w-0",
          selected && "scale-105"
        )}
        aria-haspopup="dialog"
        aria-expanded={selected}
        aria-label={`${nodes.length} items at this time`}
      >
        <span
          className={cn(
            "relative flex items-center justify-center shadow-sm transition group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-accent/40",
            // Cluster dot is slightly larger than a solo node so the
            // ×N badge has room to sit top-right without occluding.
            "h-4 w-4 rounded-full",
            st.fill ?? "bg-surface2",
            st.ring
          )}
        >
          <span
            className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-bg px-[5px] py-[1px] font-mono text-[9px] font-medium leading-none text-text"
            aria-hidden
          >
            ×{nodes.length}
          </span>
        </span>
        <span className="max-w-[110px] whitespace-nowrap text-center font-mono text-[9px] uppercase leading-tight tracking-tight text-text-muted group-hover:text-text/90">
          {nodes.length} items
        </span>
      </button>
    </div>
  );
}
