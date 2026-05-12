/**
 * Entry state for /analyze when no model is selected. Lives in the main
 * column of AnalyzeWorkspace. On desktop the picker sits in a sticky
 * sidebar; on mobile (<lg) it lives behind the "Browse models" trigger
 * rendered by AnalyzeMobileSidebar.
 */
export function AnalyzeEntry() {
  return (
    <section className="mt-16 animate-fade-rise">
      <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-muted">
        Analyze
      </div>
      <h1 className="mt-2 font-display text-3xl tracking-tight text-text md:text-4xl">
        Pick a model to explore.
      </h1>
      <p className="mt-3 max-w-xl text-[14px] text-text-muted">
        Choose a semantic data model to get its profile, named metrics, and
        an Ask bar that runs natural-language analysis through Tableau
        Next&rsquo;s Analytics Agent.
      </p>
      <p className="mt-2 max-w-xl text-[13px] text-text-muted/80">
        <span className="hidden lg:inline">
          The full list lives in the sidebar.
        </span>
        <span className="lg:hidden">
          Tap <strong className="font-medium text-text">Browse models</strong>{" "}
          above to open the list.
        </span>{" "}
        Search by name, business domain, or description.
      </p>
    </section>
  );
}
