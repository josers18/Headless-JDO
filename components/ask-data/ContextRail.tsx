/**
 * Right rail on /ask. Per spec §T1-2: "Suggested follow-ups / Memory
 * cues / Related threads." All content is dynamic and lands in T1-3+.
 *
 * For T1-2 we render the labeled sections as empty-state cards so the
 * layout reads as intentional (Q-T1-2-c = A — minimal empty-state copy).
 */
export function ContextRail() {
  return (
    <aside className="flex flex-col gap-6 pr-2 pt-4 text-[13px] text-text-muted">
      <ContextCard title="Suggested follow-ups">
        Ask a question to see follow-ups the agent suggests based on its
        response.
      </ContextCard>
      <ContextCard title="Memory cues">
        Context the agent carries across turns will surface here as the
        conversation progresses.
      </ContextCard>
      <ContextCard title="Related threads">
        Past conversations touching similar clients or segments.
      </ContextCard>
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
