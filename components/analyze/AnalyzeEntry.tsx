/**
 * Entry state for /analyze when no model is selected. Lives in the main
 * column of AnalyzeWorkspace; the sidebar (ModelList) carries the actual
 * picker. Kept copy-focused — everything useful happens on the left.
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
        Select a semantic data model from the sidebar. You&rsquo;ll get the
        model&rsquo;s profile, named metrics, and an Ask bar that runs
        natural-language analysis through Tableau Next&rsquo;s Analytics Agent.
      </p>
      <p className="mt-2 max-w-xl text-[13px] text-text-muted/80">
        All 16 models in this org&rsquo;s dataspace are listed. Search by
        name, business domain, or description.
      </p>
    </section>
  );
}
