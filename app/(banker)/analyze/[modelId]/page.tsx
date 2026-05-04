import { notFound } from "next/navigation";
import { SectionTopBar } from "@/components/nav/SectionTopBar";
import { AnalyzeWorkspace } from "@/components/analyze/AnalyzeWorkspace";
import { ModelHeader } from "@/components/analyze/ModelHeader";
import { ModelMetricsPills } from "@/components/analyze/ModelMetricsPills";
import { getModelProfile } from "@/lib/analyze/getModelProfile";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ modelId: string }> };

export default async function AnalyzeModelPage({ params }: PageProps) {
  const { modelId } = await params;

  // Server-render the profile (Q-T2-2-a = C). If the banker isn't
  // signed in or the MCP can't reach Tableau, getModelProfile returns
  // null and we 404 — clearer than rendering an empty shell.
  const profile = await getModelProfile(modelId);
  if (!profile) notFound();

  return (
    <main className="relative mx-auto w-full max-w-[1600px] px-6 pb-10">
      <SectionTopBar title="Analyze" />
      <AnalyzeWorkspace>
        <ModelHeader profile={profile} />
        <ModelMetricsPills modelId={profile.id} />
        {/* T2-3: Ask bar + question/answer flow lands here. */}
      </AnalyzeWorkspace>
    </main>
  );
}
