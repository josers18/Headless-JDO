import { ThreadList } from "./ThreadList";
import { ContextRail } from "./ContextRail";
import { AskMobileSidebar } from "./AskMobileSidebar";

/**
 * 3-column workspace shell for /ask and /ask/[threadId] (spec §T1-2).
 *
 * Breakpoints:
 *  - ≥1280px (xl) : threads sidebar (260px) + main + context rail (260px)
 *  - 1024–1279px  : threads sidebar (260px) + main; context rail hides
 *  - <1024px      : main column only; thread picker lives in a slide-in
 *                   drawer triggered by AskMobileSidebar. ContextRail
 *                   stays desktop-only — it's a power-user surface.
 *
 * The sidebar is `sticky` at the top of the main scroll context so it
 * scrolls with the workspace but stays pinned while messages accumulate
 * in the main column.
 */
export function AskWorkspace({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-[calc(100vh-120px)] grid-cols-1 gap-6 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_260px]">
      <aside className="hidden border-r border-border-soft/40 pt-4 lg:block">
        <div className="sticky top-[96px] h-[calc(100vh-120px)]">
          <ThreadList />
        </div>
      </aside>

      <div className="relative flex min-w-0 flex-col pb-40">
        <AskMobileSidebar />
        {children}
      </div>

      <div className="hidden xl:block">
        <div className="sticky top-[96px] h-[calc(100vh-120px)] overflow-y-auto">
          <ContextRail />
        </div>
      </div>
    </div>
  );
}
