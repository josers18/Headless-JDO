import type { PulseKpi } from "@/lib/client/pulseMetricHygiene";

export type PulseTileKind = "pipeline" | "wins" | "activity" | "other";

export function classifyPulseTile(kpi: PulseKpi): PulseTileKind {
  const L = kpi.label.toLowerCase();
  if (/\bpipeline\b/i.test(L)) return "pipeline";
  if (/\bwin/i.test(L)) return "wins";
  if (/activity/i.test(L)) return "activity";
  return "other";
}

export function isZeroWinsTile(kpi: PulseKpi): boolean {
  if (classifyPulseTile(kpi) !== "wins") return false;
  const v = kpi.value.trim();
  if (/^\$\s*0(\.0+)?\s*$/i.test(v) || v === "0") return true;
  return /no closed wins/i.test(kpi.delta);
}

export interface PulsePrimarySpec {
  label: string;
  question: string;
  context: string;
}

export function pulsePrimarySpec(
  kpi: PulseKpi,
  kind: PulseTileKind
): PulsePrimarySpec {
  const base = `KPI: ${kpi.label} = ${kpi.value} (${kpi.delta})`;
  if (kind === "pipeline") {
    return {
      label: "Review top 5 stalled",
      question:
        "List the five opportunities on my book with the stalest LastActivityDate among open pipeline — confirm OwnerId is me. One line each on why each is stalled.",
      context: base,
    };
  }
  if (kind === "wins") {
    return {
      label: "See what's close",
      question:
        "Which open opportunities on my book are 30–60 days from CloseDate with the highest Probability — cap at five, ranked by amount.",
      context: base,
    };
  }
  if (kind === "activity") {
    return {
      label: "Log a touchpoint",
      question:
        "Suggest the single best client on my book for a same-day touchpoint log based on engagement gaps in the last 14 days. Draft a one-line Task subject only.",
      context: base,
    };
  }
  return {
    label: "Review metric",
    question: `What changed for ${kpi.label} at ${kpi.value} (${kpi.delta}), and what should I do next?`,
    context: base,
  };
}
