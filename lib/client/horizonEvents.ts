/** Cross-surface Horizon UI events (UI v2 pull-refresh, ghost ask, focus). */

export const HORIZON_REFRESH_BRIEF = "horizon:refresh-brief";
export const HORIZON_REFRESH_ARC = "horizon:refresh-arc";
export const HORIZON_REFRESH_PULSE = "horizon:refresh-pulse";
export const HORIZON_REFRESH_PRIORITY = "horizon:refresh-priority";
export const HORIZON_REFRESH_DRAFTS = "horizon:refresh-drafts";

export const HORIZON_ASK_SUBMIT = "horizon:ask-submit";
/** C-2 — fires `POST /api/prep` from the Ask surface (Prep me everywhere). */
export const HORIZON_PREP_SUBMIT = "horizon:prep-submit";
export const HORIZON_FOCUS_CLIENT = "horizon:focus-client";
/** Clears Ask Bar thread + in-flight stream before navigating to logout. */
export const HORIZON_SIGN_OUT = "horizon:sign-out";

export type HorizonAskSubmitDetail = {
  q: string;
  context?: string;
  /** True when the ask was launched from a GhostPrompt click (routes to Onyx when configured). */
  fromGhost?: boolean;
};

export function dispatchHorizonAskSubmit(detail: HorizonAskSubmitDetail): void {
  window.dispatchEvent(
    new CustomEvent<HorizonAskSubmitDetail>(HORIZON_ASK_SUBMIT, { detail })
  );
}

export type HorizonPrepSubmitDetail = {
  clientId: string;
  clientName?: string;
  reason?: string;
};

export function dispatchHorizonPrepSubmit(
  detail: HorizonPrepSubmitDetail
): void {
  window.dispatchEvent(
    new CustomEvent<HorizonPrepSubmitDetail>(HORIZON_PREP_SUBMIT, { detail })
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
