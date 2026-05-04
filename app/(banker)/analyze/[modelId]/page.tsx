import { SectionTopBar } from "@/components/nav/SectionTopBar";
import { AnalyzeWorkspace } from "@/components/analyze/AnalyzeWorkspace";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ modelId: string }> };

/**
 * Per-model workspace. Full model profile + metric pills + Ask bar land
 * in T2-2. T2-1 only ensures the route resolves so the sidebar's active
 * state has a valid destination.
 */
export default async function AnalyzeModelPage({ params }: PageProps) {
  const { modelId } = await params;
  return (
    <main className="relative mx-auto w-full max-w-[1600px] px-6 pb-10">
      <SectionTopBar title="Analyze" />
      <AnalyzeWorkspace>
        <section className="mt-16 animate-fade-rise">
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-muted">
            Model
          </div>
          <h1 className="mt-2 font-display text-2xl tracking-tight text-text md:text-3xl">
            {modelId}
          </h1>
          <p className="mt-3 max-w-xl text-[13px] text-text-muted">
            Model profile, named metrics, and the Ask bar render here in
            the next increment.
          </p>
        </section>
      </AnalyzeWorkspace>
    </main>
  );
}
