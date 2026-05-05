/**
 * Custom-event names for Analyze's intra-page messaging. Parallel to
 * components/ask-data/askDataEvents.ts — both surfaces use a window
 * event bus for producer ↔ consumer coupling when the two sit in
 * unrelated component trees (server component + client component).
 */
export const ANALYZE_ASK_BAR_FILL_EVENT = "horizon:analyze:ask-bar-fill";

export type AnalyzeAskBarFillDetail = {
  value: string;
};

/** Helper — caller sanitizes/chooses the text to drop in. */
export function dispatchAnalyzeAskBarFill(value: string): void {
  window.dispatchEvent(
    new CustomEvent<AnalyzeAskBarFillDetail>(ANALYZE_ASK_BAR_FILL_EVENT, {
      detail: { value },
    })
  );
}
