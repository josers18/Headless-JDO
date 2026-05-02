import { SectionTopBar } from "@/components/nav/SectionTopBar";

export const dynamic = "force-dynamic";

export default function AskMyDataPlaceholder() {
  return (
    <main className="relative mx-auto w-full max-w-[960px] px-6 pb-56 xl:max-w-[1400px]">
      <SectionTopBar title="Ask My Data" />
      <section className="mt-16 animate-fade-rise">
        <h1 className="font-display text-3xl tracking-tight">Ask My Data</h1>
        <p className="mt-4 max-w-xl text-text-muted">
          Multi-turn conversational surface over the self-hosted Data 360 MCP.
          Shipping in Tier 1 of the v1.1 expansion.
        </p>
      </section>
    </main>
  );
}
