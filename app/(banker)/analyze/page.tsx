import { SectionTopBar } from "@/components/nav/SectionTopBar";

export const dynamic = "force-dynamic";

export default function AnalyzePlaceholder() {
  return (
    <main className="relative mx-auto w-full max-w-[960px] px-6 pb-56 xl:max-w-[1400px]">
      <SectionTopBar title="Analyze" />
      <section className="mt-16 animate-fade-rise">
        <h1 className="font-display text-3xl tracking-tight">Analyze</h1>
        <p className="mt-4 max-w-xl text-text-muted">
          Governed analytics workbench over Tableau Next. Shipping in Tier 2 of
          the v1.1 expansion.
        </p>
      </section>
    </main>
  );
}
