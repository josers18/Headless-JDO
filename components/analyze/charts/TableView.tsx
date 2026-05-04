"use client";

import type { ChartProps } from "@/lib/analyze/chartTypes";

/**
 * Table view — the universal fallback. Same shape as the T2-3
 * AnalyzeTable component but routed through the chart dispatcher
 * (T2-4 treats table as one of the 18 chart types).
 */
export function TableView({ props }: { props: ChartProps }) {
  const { data, columns } = props;
  const cols =
    columns && columns.length > 0
      ? columns
      : data[0]
        ? Object.keys(data[0])
        : [];
  const previewRows = data.slice(0, 10);
  if (cols.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border-soft/60 bg-surface/30">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border-soft/40 bg-surface2/30 text-left text-[11px] uppercase tracking-[0.14em] text-text-muted">
            {cols.map((c) => (
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
              {cols.map((c) => (
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
      {data.length > 10 && (
        <div className="border-t border-border-soft/40 px-3 py-1.5 text-[11px] text-text-muted">
          Showing 10 of {data.length} rows.
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
