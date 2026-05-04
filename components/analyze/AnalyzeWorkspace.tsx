import { ModelList } from "./ModelList";

/**
 * 2-column shell for /analyze and /analyze/[modelId].
 *
 * - ≥1024px : 280px model sidebar + main column
 * - <1024px : main only (sidebar deferred to a future polish pass)
 *
 * Matches the spec's §T2-4 mock — narrower than Ask My Data's 3-column
 * because the right-rail surface in Analyze (governance trail) is a
 * slide-in drawer (T2-5), not a persistent rail.
 */
export function AnalyzeWorkspace({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[calc(100vh-120px)] grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="hidden border-r border-border-soft/40 pt-4 lg:block">
        <div className="sticky top-[96px] h-[calc(100vh-120px)]">
          <ModelList />
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-col pb-40">{children}</div>
    </div>
  );
}
