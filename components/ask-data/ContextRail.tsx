"use client";

import { useFollowUps } from "./followUpsBus";
import { ASK_DATA_FOLLOW_UP_PICK_EVENT } from "./askDataEvents";
import { TokenSpendPanel } from "@/components/horizon/TokenSpendPanel";

/**
 * Right rail on /ask. Per spec §T1-2: "Suggested follow-ups / Memory
 * cues / Related threads."
 *
 * T1-3 wires the "Suggested follow-ups" card to real MiniMax-generated
 * pills (via followUpsBus). Memory cues + Related threads stay
 * empty-state copy (Q-T1-2-c = A) until a later polish task.
 */
export function ContextRail() {
  const followUps = useFollowUps();

  function pick(suggestion: string) {
    window.dispatchEvent(
      new CustomEvent(ASK_DATA_FOLLOW_UP_PICK_EVENT, {
        detail: { suggestion },
      })
    );
  }

  return (
    <aside className="flex flex-col gap-6 pr-2 pt-4 text-[13px] text-text-muted">
      <section>
        <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
          Suggested follow-ups
        </h3>
        {followUps.length === 0 ? (
          <p className="rounded-md border border-border-soft/60 bg-surface/40 px-3 py-2 leading-relaxed text-text-muted/80">
            Ask a question to see follow-ups the agent suggests based on its
            response.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {followUps.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => pick(s)}
                  className="w-full rounded-md border border-border-soft bg-surface/60 px-3 py-2 text-left leading-relaxed transition hover:border-accent/50 hover:bg-surface-raised hover:text-text"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ContextCard title="Memory cues">
        Context the agent carries across turns will surface here as the
        conversation progresses.
      </ContextCard>
      <ContextCard title="Related threads">
        Past conversations touching similar clients or segments.
      </ContextCard>

      {/* Session token spend — in-flow at the foot of the rail, expands
          downward. Renders null until there's spend to show. */}
      <TokenSpendPanel />
    </aside>
  );
}

function ContextCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
        {title}
      </h3>
      <p className="rounded-md border border-border-soft/60 bg-surface/40 px-3 py-2 leading-relaxed text-text-muted/80">
        {children}
      </p>
    </section>
  );
}
