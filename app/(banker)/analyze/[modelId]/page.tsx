import { Suspense } from "react";
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
import { getModelMetrics } from "@/lib/analyze/getModelMetrics";
import {
  getLatestAnalysis,
  isAnalyzeDbConfigured,
} from "@/lib/db/analyzeSessions";
import { currentBankerUserId } from "@/lib/ask/currentUser";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ modelId: string }> };

/**
 * The page paints its shell (SectionTopBar + AnalyzeWorkspace + skeleton)
 * immediately. The three slow dependencies — profile, metrics, latest
 * analysis — stream in behind Suspense boundaries so the banker sees
 * instant feedback on click, not a blank screen for 4 seconds while
 * three serial MCP calls complete.
 *
 * Architecture note: `ProfileSection` awaits `getModelProfile` (the
 * `notFound()` contract must be reachable from an awaited RSC); the
 * header + metrics + workbench render inside it once the profile
 * resolves. Metrics + latest are wrapped individually so each streams
 * independently.
 */
export default async function AnalyzeModelPage({ params }: PageProps) {
  const { modelId } = await params;

  return (
    <main className="relative mx-auto w-full max-w-[1600px] px-6 pb-10">
      <SectionTopBar title="Analyze" />
      <AnalyzeWorkspace>
        <Suspense
          key={modelId}
          fallback={<ModelSectionSkeleton />}
        >
          <ModelSection modelId={modelId} />
        </Suspense>
      </AnalyzeWorkspace>
    </main>
  );
}

/**
 * Server component that awaits the profile, then streams the header +
 * nested Suspense boundaries for metrics + workbench. The `key` on the
 * outer Suspense ensures switching models remounts this subtree so the
 * skeleton re-shows instead of keeping stale content on screen.
 */
async function ModelSection({ modelId }: { modelId: string }) {
  const profile = await getModelProfile(modelId);
  if (!profile) notFound();

  return (
    <>
      <ModelHeader profile={profile} />
      <ModelMetricsPills modelId={profile.id} />
      <Suspense fallback={<WorkbenchSkeleton />}>
        <WorkbenchSection
          modelId={profile.id}
          modelApiName={profile.apiName}
        />
      </Suspense>
    </>
  );
}

async function WorkbenchSection({
  modelId,
  modelApiName,
}: {
  modelId: string;
  modelApiName: string;
}) {
  // These two awaits run inside a lower boundary so they don't block
  // ModelHeader + metrics pills painting.
  const [metrics, latest] = await Promise.all([
    getModelMetrics(modelId),
    fetchLatestAnalysis(modelId),
  ]);

  return (
    <AnalyzeWorkbench
      modelId={modelId}
      modelApiName={modelApiName}
      metrics={metrics}
      latest={latest}
    />
  );
}

async function fetchLatestAnalysis(
  modelId: string
): Promise<AnalyzeLatest | null> {
  const userId = await currentBankerUserId();
  if (!userId || !isAnalyzeDbConfigured()) return null;
  try {
    const row = await getLatestAnalysis({ userId, modelId });
    if (!row) return null;
    return {
      question: row.question,
      content: row.content,
      updatedAt: row.updated_at,
    };
  } catch {
    return null;
  }
}

function ModelSectionSkeleton() {
  return (
    <div className="flex flex-col gap-6 py-8 animate-fade-in">
      <div className="flex flex-col gap-3">
        <div className="h-3 w-16 rounded bg-surface2/70" />
        <div className="h-9 w-80 rounded bg-surface2/90" />
        <div className="h-4 w-[32rem] max-w-full rounded bg-surface2/60" />
      </div>
      <div className="flex gap-2">
        <div className="h-8 w-28 rounded-full bg-surface2/70" />
        <div className="h-8 w-24 rounded-full bg-surface2/70" />
        <div className="h-8 w-32 rounded-full bg-surface2/70" />
      </div>
      <WorkbenchSkeleton />
    </div>
  );
}

function WorkbenchSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-4 animate-fade-in">
      <div className="h-20 w-full max-w-[700px] rounded-lg bg-surface2/50" />
      <div className="h-12 w-full max-w-[760px] rounded-2xl bg-surface2/40" />
    </div>
  );
}
