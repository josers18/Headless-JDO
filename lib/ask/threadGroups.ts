/**
 * Group threads into recency buckets for the sidebar, matching the spec
 * §T1-2 mock:  Today / Yesterday / This Week / Earlier.
 *
 * Pinned threads render in their own "Pinned" group above the rest — the
 * T1-2 schema keeps the pinned column but does not expose pin/unpin UI
 * (per Q-T1-2-e = A), so in practice "Pinned" will be empty until a
 * future polish task adds the control.
 */

export type ThreadLike = {
  id: string;
  title: string;
  updated_at: string;
  pinned: boolean;
};

export type ThreadGroupKey =
  | "Pinned"
  | "Today"
  | "Yesterday"
  | "This Week"
  | "Earlier";

export type ThreadGroup = {
  label: ThreadGroupKey;
  threads: ThreadLike[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfLocalDay(d: Date): number {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

export function groupThreadsByRecency(
  threads: readonly ThreadLike[],
  now: Date = new Date()
): ThreadGroup[] {
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = todayStart - MS_PER_DAY;
  const weekStart = todayStart - 7 * MS_PER_DAY;

  const pinned: ThreadLike[] = [];
  const today: ThreadLike[] = [];
  const yesterday: ThreadLike[] = [];
  const week: ThreadLike[] = [];
  const earlier: ThreadLike[] = [];

  for (const t of threads) {
    if (t.pinned) {
      pinned.push(t);
      continue;
    }
    const ts = new Date(t.updated_at).getTime();
    if (Number.isNaN(ts)) {
      earlier.push(t);
      continue;
    }
    if (ts >= todayStart) today.push(t);
    else if (ts >= yesterdayStart) yesterday.push(t);
    else if (ts >= weekStart) week.push(t);
    else earlier.push(t);
  }

  const out: ThreadGroup[] = [];
  if (pinned.length > 0) out.push({ label: "Pinned", threads: pinned });
  if (today.length > 0) out.push({ label: "Today", threads: today });
  if (yesterday.length > 0) out.push({ label: "Yesterday", threads: yesterday });
  if (week.length > 0) out.push({ label: "This Week", threads: week });
  if (earlier.length > 0) out.push({ label: "Earlier", threads: earlier });
  return out;
}
