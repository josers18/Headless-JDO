import type { DraftAction } from "@/types/horizon";
import { inferSalesforceObjectFromId } from "@/lib/salesforce/recordLink";

export interface PrepBriefingPayload {
  situation: string;
  why_it_matters: string;
  next_steps: Array<{ label: string; detail: string; kind: string }>;
  sources_used?: string[];
}

export function isValidPrepPayload(
  v: unknown
): v is PrepBriefingPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.situation !== "string" || typeof o.why_it_matters !== "string")
    return false;
  if (!Array.isArray(o.next_steps)) return false;
  for (const s of o.next_steps) {
    if (!s || typeof s !== "object") return false;
    const st = s as Record<string, unknown>;
    if (typeof st.label !== "string" || typeof st.detail !== "string")
      return false;
  }
  return true;
}

export function targetObjectForDraft(clientId: string): DraftAction["target_object"] {
  const o = inferSalesforceObjectFromId(clientId);
  if (
    o === "Account" ||
    o === "Contact" ||
    o === "Opportunity" ||
    o === "Task" ||
    o === "Case"
  ) {
    return o;
  }
  return "Account";
}

/** Map prep `kind` (incl. meeting) → DraftAction.kind for /api/actions */
export function draftFromPrepStep(
  step: { label: string; detail: string; kind: string },
  clientId: string,
  index: number
): DraftAction {
  const raw = step.kind.trim().toLowerCase();
  let kind: DraftAction["kind"] = "task";
  if (raw === "email") kind = "email";
  else if (raw === "call") kind = "call";
  else if (raw === "update") kind = "update";
  else if (raw === "task" || raw === "meeting") kind = "task";
  /** Stable across re-renders so AskBar actionStatus keys match */
  const id = `prep-${clientId}-step-${index}`;
  return {
    id,
    kind,
    title: step.label.trim().slice(0, 500) || "Next step",
    body: step.detail.trim().slice(0, 12000),
    target_object: targetObjectForDraft(clientId),
    target_id: clientId,
    confidence: 78,
  };
}
