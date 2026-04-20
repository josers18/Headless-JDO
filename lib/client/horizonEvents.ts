/** Cross-surface Horizon UI events (UI v2 pull-refresh, ghost ask, focus). */

export const HORIZON_REFRESH_BRIEF = "horizon:refresh-brief";
export const HORIZON_REFRESH_ARC = "horizon:refresh-arc";
export const HORIZON_REFRESH_PULSE = "horizon:refresh-pulse";
export const HORIZON_REFRESH_PRIORITY = "horizon:refresh-priority";
export const HORIZON_REFRESH_DRAFTS = "horizon:refresh-drafts";

export const HORIZON_ASK_SUBMIT = "horizon:ask-submit";
export const HORIZON_FOCUS_CLIENT = "horizon:focus-client";

export type HorizonAskSubmitDetail = { q: string; context?: string };

export function dispatchHorizonAskSubmit(detail: HorizonAskSubmitDetail): void {
  window.dispatchEvent(
    new CustomEvent<HorizonAskSubmitDetail>(HORIZON_ASK_SUBMIT, { detail })
  );
}

export type HorizonFocusClientDetail = { name: string; clientId?: string };

export function dispatchHorizonFocusClient(detail: HorizonFocusClientDetail): void {
  window.dispatchEvent(
    new CustomEvent<HorizonFocusClientDetail>(HORIZON_FOCUS_CLIENT, {
      detail,
    })
  );
}
