/**
 * Best-effort chronological sort for extracted tabular rows.
 *
 * When MiniMax extracts structured data from an Analytics Agent
 * narrative, it preserves the order the narrative presented (typically
 * "highlights first" — top 3, then bottom 3). That produces charts
 * with non-chronological x-axes, which is wrong whenever the x-axis is
 * a date.
 *
 * We detect a date-like column by parseability of its values, then
 * stable-sort rows ascending. If no column looks date-like, rows pass
 * through unchanged.
 */

export type Row = Record<string, unknown>;

/**
 * Returns { sorted, dateColumn } — sorted is the rows (either reordered
 * or the original reference), dateColumn is the column that drove the
 * sort (null if none).
 */
export function sortRowsByDateLikeColumn(
  columns: readonly string[],
  rows: readonly Row[]
): { sorted: Row[]; dateColumn: string | null } {
  if (rows.length < 2) return { sorted: [...rows], dateColumn: null };

  const dateColumn = findDateLikeColumn(columns, rows);
  if (!dateColumn) return { sorted: [...rows], dateColumn: null };

  // Build (row, epochMs) pairs. Rows that don't parse get pushed to the
  // end rather than dropped — we never want a sort to lose data.
  const annotated = rows.map((r) => ({
    row: r,
    epoch: toEpochMs(r[dateColumn]),
  }));

  annotated.sort((a, b) => {
    if (a.epoch === null && b.epoch === null) return 0;
    if (a.epoch === null) return 1;
    if (b.epoch === null) return -1;
    return a.epoch - b.epoch;
  });

  return { sorted: annotated.map((a) => a.row), dateColumn };
}

/**
 * A column is "date-like" if at least 70% of its non-null values parse
 * into a valid Date. 70% tolerates a few malformed entries without
 * false-positiving on label columns with occasional date strings.
 */
function findDateLikeColumn(
  columns: readonly string[],
  rows: readonly Row[]
): string | null {
  // Prefer columns whose names hint at dates — reduces false positives
  // on free-text columns that happen to contain dateable substrings.
  const nameRanked = [...columns].sort(
    (a, b) => nameScore(b) - nameScore(a)
  );

  for (const col of nameRanked) {
    let parseable = 0;
    let nonNull = 0;
    for (const r of rows) {
      const v = r[col];
      if (v === null || v === undefined || v === "") continue;
      nonNull += 1;
      if (toEpochMs(v) !== null) parseable += 1;
    }
    if (nonNull === 0) continue;
    if (parseable / nonNull >= 0.7) return col;
  }
  return null;
}

function nameScore(col: string): number {
  const n = col.toLowerCase();
  if (/(^|_)date($|_)/.test(n)) return 5;
  if (/(^|_)month($|_)/.test(n)) return 5;
  if (/(^|_)week($|_)/.test(n)) return 4;
  if (/(^|_)year($|_)/.test(n)) return 4;
  if (/(^|_)quarter($|_)|(^|_)qtr($|_)/.test(n)) return 4;
  if (/(^|_)period($|_)/.test(n)) return 3;
  if (/(^|_)day($|_)/.test(n)) return 3;
  if (/(^|_)time($|_)/.test(n)) return 3;
  if (/timestamp|datetime/.test(n)) return 3;
  return 1;
}

/**
 * Parse the value as a timestamp (epoch ms). Handles:
 *  - "2024-01" / "January 2024" / "Jan 2024" / "2024-01-15" / ISO strings
 *  - Numeric years ("2024")
 *  - Date instances
 * Returns null if the value cannot be interpreted as a date.
 */
function toEpochMs(v: unknown): number | null {
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "number") {
    // Bare year like 2024 → Jan 1 of that year.
    if (Number.isInteger(v) && v >= 1900 && v <= 2200) {
      return Date.UTC(v, 0, 1);
    }
    return null;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  // "YYYY-MM" shorthand — Date.parse is inconsistent across runtimes,
  // normalize to "YYYY-MM-01".
  const ym = s.match(/^(\d{4})-(\d{1,2})$/);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]);
    if (m >= 1 && m <= 12) return Date.UTC(y, m - 1, 1);
  }

  // "Month YYYY" / "Mon YYYY" — let Date.parse handle it.
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return parsed;

  // Bare 4-digit year string.
  if (/^\d{4}$/.test(s)) {
    const y = Number(s);
    if (y >= 1900 && y <= 2200) return Date.UTC(y, 0, 1);
  }

  return null;
}
