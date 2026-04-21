import type { LucideIcon } from "lucide-react";
import {
  Calendar,
  CheckCircle2,
  FileText,
  ListTodo,
  Mail,
  Phone,
  Sparkles,
} from "lucide-react";
import type { BriefItem } from "@/types/horizon";

/**
 * FINAL-1 — Right Now primary-button label.
 *
 * Priority:
 *   1. `item.right_now_cta` from the agent (authoritative when valid).
 *   2. Client-side regex extractor over `suggested_action` + `headline`,
 *      biased toward the MOST DEFINITIVE verb that appears.
 *   3. "Take action" as a last resort — NEVER "Review" unless the
 *      suggestion is literally to read/study/inspect something.
 *
 * The model's output is trusted only if it looks specific enough.
 * Generic fillers ("Review", "Take action", "Continue", ...) are
 * treated as parse failures and we fall back to the regex ladder.
 */

/** Widest the button can be before it blows out the flex row next to
 * "View context" + "Snooze 1hr". Accommodates the prompt's own
 * example labels: "Mark closed-lost" (16), "Draft outreach" (14). */
const MAX_LABEL_CHARS = 18;

/** Generic filler verbs the prompt forbids. We also reject them
 * client-side in case the model backslides. "Review" is special —
 * allowed ONLY when the underlying text truly asks the banker to
 * read or study something. */
const FILLER_LABELS = new Set(
  [
    "take action",
    "continue",
    "proceed",
    "handle",
    "manage",
    "open",
    "see",
    "look at",
    "check",
    "do it",
    "act",
  ].map((s) => s.toLowerCase())
);

/** Pattern → canonical label. Ordered: the FIRST match wins, so we
 * put the most-definitive/high-signal phrasings at the top. A single
 * label like "Mark closed-lost" is picked over "Update stage" because
 * closing a deal is a terminal action. The literal-reading "Review"
 * branch sits BEFORE generic meeting/schedule patterns — otherwise
 * "Review the Patel proposal before the 3pm meeting" would resolve
 * to "Schedule" because "meeting" appears later in the sentence. */
const VERB_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /mark\s+closed[-\s]?lost/i, label: "Mark closed-lost" },
  { re: /closed?[-\s]?lost/i, label: "Mark closed-lost" },
  { re: /mark\s+closed[-\s]?won/i, label: "Mark closed-won" },
  { re: /closed?[-\s]?won/i, label: "Mark closed-won" },
  { re: /update\s+(?:the\s+)?(?:close\s+date|stage|forecast|record)/i, label: "Update stage" },
  { re: /update\b/i, label: "Update" },
  { re: /call|phone|ring|dial\b/i, label: "Call" },
  { re: /e[-\s]?mail\b/i, label: "Email" },
  { re: /draft\s+(?:an?\s+)?(?:outreach|note|email|message)/i, label: "Draft outreach" },
  { re: /\bdraft\b/i, label: "Draft" },
  // Literal read/study — matches only when the verb is the LEADING
  // imperative of a sentence or clause, not when "review" appears as
  // a noun inside another verb's object ("Schedule a portfolio
  // review..." should NOT trip this — the leading verb is Schedule).
  { re: /(?:^|[.!?]\s+)(?:review|read|study|inspect)\s+(?:the|a|an|this|that|his|her|their|its|[A-Z])/i, label: "Review" },
  { re: /\bbook\s+\d+\s*(?:m|min|minutes?)/i, label: "Book" },
  { re: /\bbook\b/i, label: "Book" },
  { re: /\bschedule\b|\bset\s+up\b/i, label: "Schedule" },
  { re: /\bprep(?:are)?\b/i, label: "Prep" },
  { re: /\bsend\b/i, label: "Send" },
  { re: /\bfollow[-\s]?up\b/i, label: "Follow up" },
  { re: /\bremind\b/i, label: "Remind" },
  { re: /\bmeet(?:ing)?\b|\bvisit\b/i, label: "Schedule" },
];

/** "Book 20m" / "Book 15m" — if the suggestion gives a duration, keep it. */
const BOOK_WITH_DURATION = /\bbook\s+(?:a\s+)?(\d{1,3})\s*[-\s]*(?:m|min|minutes?)\b/i;

function normalizeCandidate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_LABEL_CHARS) return null;
  return trimmed;
}

function suggestsReading(text: string): boolean {
  // True only when a read-verb leads the sentence/clause. "Schedule
  // a portfolio review" does NOT count — "review" is a noun there.
  return /(?:^|[.!?]\s+)(?:review|read|study|inspect|scan|audit)\s+(?:the|a|an|this|that|his|her|their|its|[A-Z])/i.test(
    text
  );
}

function isAcceptable(label: string, sourceText: string): boolean {
  const lc = label.toLowerCase();
  if (FILLER_LABELS.has(lc)) return false;
  if (lc === "review") return suggestsReading(sourceText);
  return true;
}

function extractFromText(text: string): string {
  const bookMatch = text.match(BOOK_WITH_DURATION);
  if (bookMatch?.[1]) return `Book ${bookMatch[1]}m`;
  for (const { re, label } of VERB_PATTERNS) {
    if (re.test(text)) return label;
  }
  return "Take action";
}

export function resolveRightNowCta(item: BriefItem): {
  label: string;
  Icon: LucideIcon;
} {
  const source = `${item.suggested_action ?? ""} ${item.headline ?? ""}`.trim();

  const candidate = normalizeCandidate(item.right_now_cta);
  const fromAgent =
    candidate && isAcceptable(candidate, source) ? candidate : null;

  const label = fromAgent ?? extractFromText(source);
  return { label, Icon: iconForLabel(label) };
}

function iconForLabel(label: string): LucideIcon {
  const lc = label.toLowerCase();
  if (lc.startsWith("call")) return Phone;
  if (lc === "email" || lc === "send") return Mail;
  if (lc.startsWith("draft")) return Mail;
  if (
    lc.startsWith("book") ||
    lc.startsWith("schedule") ||
    lc.startsWith("meet") ||
    lc.startsWith("prep") ||
    lc.startsWith("follow") ||
    lc.startsWith("remind")
  ) {
    return Calendar;
  }
  if (lc.startsWith("update") || lc.startsWith("mark")) return CheckCircle2;
  if (lc.startsWith("review")) return FileText;
  if (lc.startsWith("take action")) return Sparkles;
  return ListTodo;
}
