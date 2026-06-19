"use client";

import { useState } from "react";
import { Coins, ChevronDown, ChevronUp } from "lucide-react";
import { useSessionUsage } from "./SessionUsageProvider";

/** Humanize a token count: 950 → "950", 48230 → "48.2k", 1_200_000 → "1.2M". */
function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Format a USD cost: <$0.01 → "<$0.01", else trimmed 2–4 decimals with $. */
function fmtUsd(n: number): string {
  if (n <= 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  if (n < 1) {
    // Trim trailing zeros so $0.050 → $0.05, $0.010 → $0.01.
    const trimmed = n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    return `$${trimmed}`;
  }
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}

/** Format a duration in ms: 940 → "0.9s", 12400 → "12.4s", 75000 → "1m15s". */
function fmtDuration(ms: number): string {
  if (ms <= 0) return "—";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${Math.round(s - m * 60)}s`;
}

/** Strip a provider prefix for display: "claude-4-5-sonnet" stays; long ids trim. */
function modelLabel(model: string): string {
  return model.replace(/^.*\//, "");
}

/** A label → value row with a hairline separator above, used across sections. */
function Row({
  label,
  value,
  muted = false,
  strong = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span
        className={
          muted
            ? "text-[11px] text-text-muted/70"
            : "text-[12px] text-text-muted"
        }
      >
        {label}
      </span>
      <span
        className={`font-mono tabular-nums ${
          strong ? "text-[12px] text-text" : "text-[11px] text-text/90"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** Section heading: tiny all-caps label with a hairline rule beneath. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-4 border-b border-border-soft/40 pb-1 text-[9px] uppercase tracking-[0.2em] text-text-muted/70">
      {children}
    </div>
  );
}

export function TokenSpendPanel() {
  const { data } = useSessionUsage();
  const [open, setOpen] = useState(false);

  if (!data || data.models.length === 0) return null;

  const grandTokens = data.totals.inputTokens + data.totals.outputTokens;
  const approx = !data.totals.exact;
  const hasCost = data.totals.costUsd > 0;

  return (
    <section
      aria-labelledby="token-spend-h"
      className="mt-4 rounded-xl border border-border-soft bg-surface px-4 py-3"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span
          id="token-spend-h"
          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-text-muted"
        >
          <Coins size={12} className="opacity-70" />
          Session spend
          <span className="rounded-full border border-border-soft px-2 py-0.5 font-mono text-[9px] text-text-muted/80">
            {approx ? "≈" : ""}
            {fmt(grandTokens)}
            {hasCost ? ` · ${fmtUsd(data.totals.costUsd)}` : ""}
          </span>
        </span>
        {open ? (
          <ChevronUp size={12} className="text-text-muted" />
        ) : (
          <ChevronDown size={12} className="text-text-muted" />
        )}
      </button>

      {open && (
        <div className="mt-1">
          {/* TOKENS — per model, stacked (in / out / total) */}
          <SectionLabel>Tokens by model</SectionLabel>
          {data.models.map((m) => (
            <div key={m.model} className="py-1.5">
              <div className="flex items-center gap-1.5 text-[12px] text-text">
                {modelLabel(m.model)}
                {!m.exact && (
                  <span
                    title="Includes estimated counts"
                    className="text-text-muted/60"
                  >
                    ≈
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-4 pl-1 font-mono text-[11px] tabular-nums text-text-muted">
                <span>
                  <span className="text-text-muted/60">in </span>
                  {fmt(m.inputTokens)}
                </span>
                <span>
                  <span className="text-text-muted/60">out </span>
                  {fmt(m.outputTokens)}
                </span>
                <span className="text-text/90">
                  <span className="text-text-muted/60">total </span>
                  {fmt(m.inputTokens + m.outputTokens)}
                </span>
              </div>
            </div>
          ))}

          {/* COST — per model + total (only when we have rates) */}
          {hasCost && (
            <>
              <SectionLabel>Estimated cost</SectionLabel>
              {data.models.map((m) => (
                <Row
                  key={m.model}
                  label={modelLabel(m.model)}
                  value={fmtUsd(m.costUsd)}
                  muted
                />
              ))}
              <div className="mt-1 border-t border-border-soft/60 pt-1">
                <Row
                  label="Total"
                  value={`${approx ? "≈ " : ""}${fmtUsd(data.totals.costUsd)}`}
                  strong
                />
              </div>
            </>
          )}

          {/* SESSION TOTALS */}
          <SectionLabel>Session totals</SectionLabel>
          <Row
            label="Tokens"
            value={`${approx ? "≈ " : ""}${fmt(grandTokens)}`}
            strong
          />
          <Row label="Turns" value={String(data.turns)} />
          <Row label="Tool calls" value={String(data.toolCalls)} />

          {/* LAST TURN */}
          {data.lastTurn && (
            <>
              <SectionLabel>Last turn</SectionLabel>
              <Row
                label="Latency"
                value={fmtDuration(data.lastTurn.durationMs)}
              />
              <Row
                label="Tokens"
                value={fmt(
                  data.lastTurn.inputTokens + data.lastTurn.outputTokens
                )}
              />
              <Row label="Tool calls" value={String(data.lastTurn.toolCalls)} />
            </>
          )}

          {(approx || hasCost) && (
            <p className="mt-3 text-[10px] leading-relaxed text-text-muted/70">
              {hasCost && "Cost is an estimate from list-price rates. "}
              {approx &&
                "≈ marks counts the provider did not report exactly (estimated)."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
