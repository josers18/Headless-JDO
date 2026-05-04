import { notFound } from "next/navigation";
import { SectionTopBar } from "@/components/nav/SectionTopBar";
import { AnalyzeWorkspace } from "@/components/analyze/AnalyzeWorkspace";
import { ModelHeader } from "@/components/analyze/ModelHeader";
import { ModelMetricsPills } from "@/components/analyze/ModelMetricsPills";
import {
  AnalyzeWorkbench,
  type AnalyzeLatest,
} from "@/components/analyze/AnalyzeWorkbench";
import { getModelProfile } from "@/lib/analyze/getModelProfile";
import {
  getLatestAnalysis,
  isAnalyzeDbConfigured,
} from "@/lib/db/analyzeSessions";
import { currentBankerUserId } from "@/lib/ask/currentUser";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ modelId: string }> };

export default async function AnalyzeModelPage({ params }: PageProps) {
  const { modelId } = await params;

  const profile = await getModelProfile(modelId);
  if (!profile) notFound();

  // Fetch persisted latest analysis in parallel with the request — it's
  // a fast Postgres lookup, not worth a Suspense split.
  const userId = await currentBankerUserId();
  let latest: AnalyzeLatest | null = null;
  if (userId && isAnalyzeDbConfigured()) {
    try {
      const row = await getLatestAnalysis({ userId, modelId: profile.id });
      if (row) {
        latest = {
          question: row.question,
          content: row.content,
          updatedAt: row.updated_at,
        };
      }
    } catch {
      // Persistence is optional — a DB hiccup should not 500 the page.
      latest = null;
    }
  }

  return (
    <main className="relative mx-auto w-full max-w-[1600px] px-6 pb-10">
      <SectionTopBar title="Analyze" />
      <AnalyzeWorkspace>
        <ModelHeader profile={profile} />
        <ModelMetricsPills modelId={profile.id} />
        <AnalyzeWorkbench modelId={profile.id} latest={latest} />
      </AnalyzeWorkspace>
    </main>
  );
}
