/**
 * Client-side guardrails for Portfolio Pulse KPI tiles so noisy or
 * misleading comparisons never reach the banker (FIX_PASS P1-2).
 */

const SUB_THRESHOLD_USD = 100_000;
const MIN_RELATIVE_DELTA = 0.2;

export interface PulseKpi {
  label: string;
  value: string;
  delta: string;
  direction: "up" | "down" | "flat";
  explanation?: string;
}

function parseUsd(s: string): number | null {
  const t = s.trim().replace(/,/g, "");
  const m = t.match(/^\$\s*([\d.]+)\s*([KMB])?$/i);
  if (!m?.[1]) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suf = (m[2] ?? "").toUpperCase();
  if (suf === "K") n *= 1_000;
  if (suf === "M") n *= 1_000_000;
  if (suf === "B") n *= 1_000_000_000;
  return n;
}

function parsePlainNumber(s: string): number | null {
  const t = s.trim().replace(/,/g, "");
  const m = t.match(/^(\d+)$/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Pull every $… token from a string (delta + explanation). */
function extractUsdAmounts(s: string): number[] {
  const out: number[] = [];
  const re = /\$\s*([\d,.]+)\s*([KMB])?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const n = parseUsd(m[0]);
    if (n !== null) out.push(n);
  }
  return out;
}

function isWinsLabel(label: string): boolean {
  return /\bwin/i.test(label);
}

function isActivityLabel(label: string): boolean {
  return /activity/i.test(label);
}

function isMoneyTile(k: PulseKpi): boolean {
  return /^\s*\$/.test(k.value);
}

/** Model JSON often sends numbers for values — coerce before any `.trim()`. */
function strField(x: unknown): string {
  if (x == null) return "";
  return typeof x === "string" ? x : String(x);
}

/**
 * Returns a shallow-cloned KPI with suppressed deltas / neutralized
 * directions when the FIX_PASS rules say the tile would erode trust.
 */
export function applyPulseMetricHygiene(raw: PulseKpi): PulseKpi {
  const k: PulseKpi = {
    label: strField(raw.label),
    value: strField(raw.value),
    delta: strField(raw.delta),
    direction:
      raw.direction === "up" ||
      raw.direction === "down" ||
      raw.direction === "flat"
        ? raw.direction
        : "flat",
    explanation:
      typeof raw.explanation === "string" ? raw.explanation : undefined,
  };

  const label = k.label;
  const valueMoney = isMoneyTile(k) ? parseUsd(k.value) : null;
  const valueCount = valueMoney === null ? parsePlainNumber(k.value) : null;
  const expl = (k.explanation ?? "").trim();
  const combined = `${k.delta} ${expl}`;

  if (isWinsLabel(label) && valueMoney === 0) {
    return {
      ...k,
      direction: "flat",
      delta: "No closed wins this period.",
      explanation: expl
        ? expl.replace(/\s*·\s*no prior[^.]*\.?/i, "").trim() || undefined
        : undefined,
    };
  }

  if (
    isActivityLabel(label) &&
    /no prior|prior week|comparison available/i.test(combined)
  ) {
    let delta = k.delta
      .replace(/\s*·\s*Single task created[^.]*\./i, "")
      .trim();
    const n = parsePlainNumber(k.value);
    if (n === 1 && /task/i.test(combined)) {
      delta = "Single task created this week.";
    } else if (!delta || delta === "—") {
      delta = k.value.trim() ? `${k.value.trim()} this period.` : "—";
    }
    return { ...k, delta, direction: "flat", explanation: expl || undefined };
  }

  if (valueMoney !== null && valueMoney > 0) {
    const amounts = extractUsdAmounts(`${k.value} ${k.delta}`);
    if (amounts.length >= 2) {
      const sorted = [...amounts].sort((a, b) => a - b);
      const a = sorted[0]!;
      const b = sorted[sorted.length - 1]!;
      const bothSmall = a < SUB_THRESHOLD_USD && b < SUB_THRESHOLD_USD;
      const rel =
        Math.min(a, b) > 0
          ? Math.abs(a - b) / Math.min(a, b)
          : Number.POSITIVE_INFINITY;
      const tinyRel = rel < MIN_RELATIVE_DELTA;
      if (bothSmall || tinyRel) {
        return {
          ...k,
          direction: "flat",
          delta: "—",
          explanation:
            expl ||
            "Change is below the reporting threshold for this tile.",
        };
      }
    }
  }

  if (valueMoney === 0 && isMoneyTile(k) && !isWinsLabel(label)) {
    const amounts = extractUsdAmounts(k.delta);
    const maxAbs = amounts.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    if (maxAbs > 0 && maxAbs < SUB_THRESHOLD_USD) {
      return {
        ...k,
        direction: "flat",
        delta: "—",
        explanation:
          expl || "No meaningful balance in this period; trend not shown.",
      };
    }
  }

  if (valueCount === 0 && !isMoneyTile(k)) {
    return {
      ...k,
      direction: "flat",
      delta: "—",
      explanation: expl || undefined,
    };
  }

  return { ...k };
}

export function applyPulseHygieneToKpis(kpis: PulseKpi[]): PulseKpi[] {
  if (!Array.isArray(kpis)) return [];
  return kpis
    .filter((x): x is PulseKpi => x != null && typeof x === "object")
    .map((raw) => applyPulseMetricHygiene(raw));
}
