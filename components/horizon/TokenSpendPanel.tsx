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

/** Strip a provider prefix for display: "claude-4-5-sonnet" stays; long ids trim. */
function modelLabel(model: string): string {
  return model.replace(/^.*\//, "");
}

export function TokenSpendPanel() {
  const { data } = useSessionUsage();
  const [open, setOpen] = useState(false);

  if (!data || data.models.length === 0) return null;

  const grand = data.totals.inputTokens + data.totals.outputTokens;
  const approx = !data.totals.exact;

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
          Tokens
          <span className="rounded-full border border-border-soft px-2 py-0.5 font-mono text-[9px] text-text-muted/80">
            {approx ? "≈" : ""}
            {fmt(grand)}
          </span>
        </span>
        {open ? (
          <ChevronUp size={12} className="text-text-muted" />
        ) : (
          <ChevronDown size={12} className="text-text-muted" />
        )}
      </button>

      {open && (
        <div className="mt-3">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-text-muted/70">
                <th className="pb-1 text-left font-medium uppercase tracking-[0.12em]">
                  Model
                </th>
                <th className="pb-1 text-right font-medium uppercase tracking-[0.12em]">
                  In
                </th>
                <th className="pb-1 text-right font-medium uppercase tracking-[0.12em]">
                  Out
                </th>
                <th className="pb-1 text-right font-medium uppercase tracking-[0.12em]">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft/30">
              {data.models.map((m) => (
                <tr key={m.model} className="text-text">
                  <td className="py-1.5 pr-2">
                    {modelLabel(m.model)}
                    {!m.exact && (
                      <span
                        title="Includes estimated counts"
                        className="ml-1 text-text-muted/60"
                      >
                        ≈
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {fmt(m.inputTokens)}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {fmt(m.outputTokens)}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {fmt(m.inputTokens + m.outputTokens)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-soft text-text">
                <td className="pt-2 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                  Session total
                </td>
                <td className="pt-2 text-right font-mono tabular-nums">
                  {fmt(data.totals.inputTokens)}
                </td>
                <td className="pt-2 text-right font-mono tabular-nums">
                  {fmt(data.totals.outputTokens)}
                </td>
                <td className="pt-2 text-right font-mono tabular-nums">
                  {approx ? "≈" : ""}
                  {fmt(grand)}
                </td>
              </tr>
            </tfoot>
          </table>
          {approx && (
            <p className="mt-2 text-[10px] text-text-muted/70">
              ≈ includes estimated counts (provider did not report exact
              usage for some runs).
            </p>
          )}
        </div>
      )}
    </section>
  );
}
