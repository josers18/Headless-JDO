import { cookies } from "next/headers";
import { HorizonMark } from "@/components/brand/HorizonMark";
import { HeaderClock } from "@/components/horizon/HeaderClock";
import { MorningBrief } from "@/components/horizon/MorningBrief";
import { TodaysArc } from "@/components/horizon/TodaysArc";
import { PriorityQueue } from "@/components/horizon/PriorityQueue";
import { PortfolioPulse } from "@/components/horizon/PortfolioPulse";
import { PreDraftedActions } from "@/components/horizon/PreDraftedActions";
import { SignalFeed } from "@/components/horizon/SignalFeed";
import { SectionInsight } from "@/components/horizon/SectionInsight";
import { AgentLog } from "@/components/horizon/AgentLog";
import { ThemeSwitcher } from "@/components/horizon/ThemeSwitcher";
import { InstitutionDemoMode } from "@/components/horizon/InstitutionDemoMode";
import { AskBar } from "@/components/horizon/AskBar";
import { PulseStrip } from "@/components/horizon/PulseStrip";
import { SignInBanner } from "@/components/horizon/SignInBanner";
import { HorizonSignedIn } from "@/components/horizon/HorizonSignedIn";
import { InsightsBatchProvider } from "@/components/horizon/InsightsBatchProvider";

// Force dynamic — we read the Salesforce session cookie server-side to
// decide whether to show the signed-out banner instead of kicking every
// section's SSE stream into a cascade of 401s.
export const dynamic = "force-dynamic";

export default function HorizonHome() {
  const signedIn = Boolean(cookies().get("hz_sf")?.value);

  return (
    <main className="relative mx-auto w-full max-w-[960px] px-6 pb-56 xl:max-w-[1400px]">
      {!signedIn && (
        <>
          <header className="flex items-center justify-between pt-12 animate-fade-rise md:pt-16">
            <HorizonMark />
            <div className="flex items-center gap-3">
              <ThemeSwitcher />
              <HeaderClock />
            </div>
          </header>
          <InstitutionDemoMode />
        </>
      )}

      {signedIn && (
        <div className="sticky top-0 z-40 -mx-6 border-b border-border-soft/50 bg-bg/90 px-6 pb-4 pt-12 shadow-[0_12px_40px_-28px_rgba(0,0,0,0.55)] backdrop-blur-md supports-[backdrop-filter]:bg-bg/80 md:pt-16">
          <header className="flex items-center justify-between animate-fade-rise">
            <HorizonMark />
            <div className="flex items-center gap-3">
              <ThemeSwitcher />
              <HeaderClock />
            </div>
          </header>
          <div className="mt-4 animate-fade-rise">
            <PulseStrip />
          </div>
          <InstitutionDemoMode />
        </div>
      )}

      {!signedIn && (
        <section className="mt-16 animate-fade-rise stagger-1">
          <SignInBanner />
        </section>
      )}

      {signedIn && (
        <>
          <HorizonSignedIn>
            <InsightsBatchProvider>
              {/* B-3 — at >=1280px we pull Signal Feed into a sticky right rail
                  so the banker can see ambient awareness while scrolling the
                  main briefing column. Below 1280px the layout stays single-
                  column with Signals at the bottom (original rhythm). */}
              <div className="xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] xl:gap-10">
                <div className="min-w-0">
                <section className="mt-12 md:mt-16 animate-fade-rise stagger-1">
                  <MorningBrief />
                </section>

                <Divider className="stagger-2" />
                <section className="mt-12 animate-fade-rise stagger-2">
                  <TodaysArc />
                </section>

                <Divider className="stagger-3" />
                <section className="mt-12 animate-fade-rise stagger-3">
                  <SectionInsight section="priority" label="Priority queue" className="mb-6" />
                  <PriorityQueue />
                </section>

                <Divider className="stagger-4" />
                <section className="mt-12 animate-fade-rise stagger-4">
                  <SectionInsight section="pulse" label="Portfolio pulse" className="mb-6" />
                  <PortfolioPulse />
                </section>

                <Divider className="stagger-5" />
                <section className="mt-12 animate-fade-rise stagger-5">
                  <SectionInsight section="drafts" label="Pre-drafted actions" className="mb-6" />
                  <PreDraftedActions />
                </section>

                <div className="xl:hidden">
                  <Divider className="stagger-6" />
                  <section className="mt-12 animate-fade-rise stagger-6">
                    <SectionInsight section="signals" label="Live signals" className="mb-6" />
                    <SignalFeed />
                  </section>
                </div>
              </div>

              <aside className="mt-12 hidden min-w-0 xl:block">
                <div className="sticky top-[180px] animate-fade-rise stagger-2 space-y-4">
                  <SectionInsight section="signals" label="Live signals" />
                  <SignalFeed />
                  <AgentLog />
                </div>
              </aside>
            </div>

            {/* On <1280px the AgentLog renders inline at the foot of the
                page; on >=1280px it lives in the right rail above. */}
            <div className="xl:hidden">
              <AgentLog />
            </div>
            </InsightsBatchProvider>
          </HorizonSignedIn>

          <AskBar />
        </>
      )}
    </main>
  );
}

// Hairline section divider — used between the five surface sections of
// the home page to establish rhythm without adding heavy borders.
function Divider({ className = "" }: { className?: string }) {
  return <div className={`mt-14 hairline animate-fade-in ${className}`} aria-hidden />;
}
