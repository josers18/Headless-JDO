/**
 * Morning brief signoff time bands (I-1) — server builds the hour; the model
 * follows the prompt; this module validates obvious policy violations in tests.
 */

export function hourInTimeZone(now: Date, ianaTz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ianaTz,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const h = parts.find((p) => p.type === "hour")?.value;
  const n = Number.parseInt(h ?? "0", 10);
  return Number.isFinite(n) ? n : 0;
}

export type SignoffBand =
  | "morning"
  | "midday"
  | "wrap_up"
  | "neutral_off_hours";

export function signoffBandForLocalHour(hour24: number): SignoffBand {
  if (hour24 >= 6 && hour24 < 11) return "morning";
  if (hour24 >= 11 && hour24 < 15) return "midday";
  if (hour24 >= 15 && hour24 < 19) return "wrap_up";
  return "neutral_off_hours";
}

const REST_SLEEP = [
  /get\s+some\s+rest/i,
  /go\s+to\s+sleep/i,
  /\bwellness\b/i,
  /\bbedtime\b/i,
  /catch\s+up\s+on\s+sleep/i,
  /get\s+sleep/i,
];

const TOMORROW_MORNING = /first\s+thing\s+in\s+the\s+morning/i;

/** Returns human-readable violations (empty => pass). */
export function validateSignoffCompliance(
  signoff: string,
  hour24: number
): string[] {
  const band = signoffBandForLocalHour(hour24);
  const out: string[] = [];
  const s = signoff.trim();
  if (!s) return ["empty signoff"];

  if (band === "neutral_off_hours") {
    for (const re of REST_SLEEP) {
      if (re.test(s)) out.push(`forbidden wellness/rest phrase (${re})`);
    }
    if (TOMORROW_MORNING.test(s)) {
      out.push("tomorrow-morning scheduling cue in off-hours band");
    }
  }

  if (band !== "morning" && /\b(good\s+morning|morning\b)/i.test(s)) {
    out.push('"morning" wording outside morning band');
  }

  if (s.split(/\s+/).filter(Boolean).length > 14) {
    out.push("signoff exceeds 14 words");
  }

  return out;
}
