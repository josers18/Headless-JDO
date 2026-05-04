import { SectionTopBar } from "@/components/nav/SectionTopBar";
import { AnalyzeWorkspace } from "@/components/analyze/AnalyzeWorkspace";
import { AnalyzeEntry } from "@/components/analyze/AnalyzeEntry";

export const dynamic = "force-dynamic";

export default function AnalyzePage() {
  return (
    <main className="relative mx-auto w-full max-w-[1600px] px-6 pb-10">
      <SectionTopBar title="Analyze" />
      <AnalyzeWorkspace>
        <AnalyzeEntry />
      </AnalyzeWorkspace>
    </main>
  );
}
