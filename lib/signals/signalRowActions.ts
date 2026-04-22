import type { Signal } from "@/types/horizon";
import type { HorizonAction } from "@/lib/client/actions/registry";
import { plainText } from "@/lib/utils";

export interface SignalRowPrimary {
  action: HorizonAction;
  /** Short label for aria / tooltip */
  aria: string;
}

/**
 * Maps a signal row to its right-edge primary action (I-3).
 * Heuristics use summary text because API `kind` is coarse-grained.
 */
export function primaryActionForSignal(signal: Signal): SignalRowPrimary {
  const s = plainText(signal.summary).toLowerCase();
  const cid = signal.client_id;
  const name = signal.client_name;

  if (cid && /\bopportunity\b/.test(s) && /(new|created|opened)/.test(s)) {
    return {
      aria: "Review opportunity",
      action: {
        kind: "investigate",
        label: "Review",
        question: `Review this new opportunity signal: "${signal.summary}". What changed in CRM, and what is the recommended next step?`,
        context: cid ? `Client id: ${cid}` : undefined,
      },
    };
  }

  if (cid && /\bopportunity\b/.test(s) && /(moved|stage|negotiation|updated)/.test(s)) {
    return {
      aria: "Review stage change",
      action: {
        kind: "investigate",
        label: "Review",
        question: `Review this pipeline update: "${signal.summary}". Who owns the next step and by when?`,
        context: cid ? `Client id: ${cid}` : undefined,
      },
    };
  }

  if (cid && /\btask\b/.test(s) && /overdue/.test(s)) {
    return {
      aria: "Call contact",
      action: {
        kind: "draft_call",
        label: "Call",
        clientId: cid,
        clientName: name,
        reason: signal.summary,
      },
    };
  }

  if (/\btask\b/.test(s) && /(completed|done|closed)/.test(s)) {
    return {
      aria: "Log outcome",
      action: {
        kind: "investigate",
        label: "Log outcome",
        question: `Task completion signal: "${signal.summary}". Suggest a one-line outcome log for the banker.`,
        context: cid ? `Client id: ${cid}` : undefined,
      },
    };
  }

  if (/\bcase\b/.test(s)) {
    return {
      aria: "Acknowledge case",
      action: {
        kind: "investigate",
        label: "Acknowledge",
        question: `Case signal: "${signal.summary}". Summarize severity and the first acknowledgement step.`,
        context: cid ? `Client id: ${cid}` : undefined,
      },
    };
  }

  if (
    cid &&
    /(meeting|calendar|invited|scheduled|holds?\s+at)/.test(s)
  ) {
    return {
      aria: "Prep me",
      action: {
        kind: "prep",
        label: "Prep",
        clientId: cid,
        clientName: name,
        meetingHint: signal.summary,
      },
    };
  }

  if (cid && signal.kind === "transaction") {
    return {
      aria: "Call",
      action: {
        kind: "draft_call",
        label: "Call",
        clientId: cid,
        clientName: name,
        reason: signal.summary,
      },
    };
  }

  if (cid && signal.severity === "high") {
    return {
      aria: "Respond",
      action: {
        kind: "draft_email",
        label: "Respond",
        clientId: cid,
        clientName: name,
        reason: signal.summary,
      },
    };
  }

  return {
    aria: "Why",
    action: {
      kind: "investigate",
      label: "Why?",
      question: `Investigate this signal: "${signal.summary}". What is the context, and what should I do next?`,
      context: cid ? `Client id: ${cid}` : undefined,
    },
  };
}
