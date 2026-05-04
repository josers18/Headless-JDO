"use client";

import type { AnalyzeTable as AnalyzeTableType } from "@/lib/client/useAnalyzeStream";

/**
 * Rendering of the table fallback (Q-T2-3-c = B). Small, bordered,
 * max-10 rows visible with truncation; full data is in state but
 * displaying more than 10 rows in an exploratory view tends to feel
 * more like "I'm doing your homework" than an insight.
 *
 * Real chart rendering (Recharts, 6 types) lands in T2-4 and will
 * replace this component when the chart-selector says anything other
 * than "table".
 */
export function AnalyzeTable({ table }: { table: AnalyzeTableType }) {
  const previewRows = table.rows.slice(0, 10);
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border-soft/60 bg-surface/30">
      {table.caption && (
        <div className="border-b border-border-soft/40 bg-surface2/40 px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-text-muted">
          {table.caption}
        </div>
      )}
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border-soft/40 bg-surface2/30 text-left text-[11px] uppercase tracking-[0.14em] text-text-muted">
            {table.columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {previewRows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border-soft/30 last:border-b-0"
            >
              {table.columns.map((c) => (
                <td
                  key={c}
                  className="max-w-[280px] truncate px-3 py-2 text-text"
                  title={stringify(row[c])}
                >
                  {stringify(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {table.rows.length > 10 && (
        <div className="border-t border-border-soft/40 px-3 py-1.5 text-[11px] text-text-muted">
          Showing 10 of {table.rows.length} rows.
        </div>
      )}
    </div>
  );
}

function stringify(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 120 ? s.slice(0, 117) + "…" : s;
  } catch {
    return String(v);
  }
}
