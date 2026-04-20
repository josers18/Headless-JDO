/** Session snooze for Morning Brief "Right Now" hero (UI v2 T0-2). */

export const RIGHT_NOW_SNOOZE_KEY = "hz:right-now-snooze:v1";
export const PULSE_REFRESH_EVENT = "horizon:pulse-refresh";

export interface RightNowSnooze {
  itemKey: string;
  until: number;
}

export function briefItemKey(item: {
  client_id?: string;
  headline: string;
}): string {
  if (item.client_id && item.client_id.trim().length > 0) {
    return item.client_id.trim();
  }
  return `h:${item.headline.trim().slice(0, 80)}`;
}

export function readRightNowSnooze(): RightNowSnooze | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(RIGHT_NOW_SNOOZE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { itemKey?: string; until?: number };
    if (typeof o.itemKey !== "string" || typeof o.until !== "number") {
      return null;
    }
    if (Date.now() >= o.until) {
      sessionStorage.removeItem(RIGHT_NOW_SNOOZE_KEY);
      return null;
    }
    return { itemKey: o.itemKey, until: o.until };
  } catch {
    return null;
  }
}

export function writeRightNowSnooze(itemKey: string, ms = 3_600_000): void {
  try {
    sessionStorage.setItem(
      RIGHT_NOW_SNOOZE_KEY,
      JSON.stringify({ itemKey, until: Date.now() + ms })
    );
  } catch {
    /* quota */
  }
  window.dispatchEvent(new Event(PULSE_REFRESH_EVENT));
}
