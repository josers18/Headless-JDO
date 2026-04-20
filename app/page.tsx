import { cookies } from "next/headers";
import { HorizonMark } from "@/components/brand/HorizonMark";
import { HeaderClock } from "@/components/horizon/HeaderClock";
import { MorningBrief } from "@/components/horizon/MorningBrief";
import { TodaysArc } from "@/components/horizon/TodaysArc";
import { PriorityQueue } from "@/components/horizon/PriorityQueue";
import { PortfolioPulse } from "@/components/horizon/PortfolioPulse";
import { PreDraftedActions } from "@/components/horizon/PreDraftedActions";
import { SignalFeed } from "@/components/horizon/SignalFeed";
import { AskBar } from "@/components/horizon/AskBar";
import { PulseStrip } from "@/components/horizon/PulseStrip";
import { SignInBanner } from "@/components/horizon/SignInBanner";

// Force dynamic — we read the Salesforce session cookie server-side to
// decide whether to show the signed-out banner instead of kicking every
// section's SSE stream into a cascade of 401s.
export const dynamic = "force-dynamic";

export default function HorizonHome() {
  const signedIn = Boolean(cookies().get("hz_sf")?.value);

  return (
    <main className="relative mx-auto w-full max-w-[960px] px-6 pb-56">
      {!signedIn && (
        <header className="flex items-center justify-between pt-12 animate-fade-rise md:pt-16">
          <HorizonMark />
          <HeaderClock />
        </header>
      )}

      {signedIn && (
        <div className="sticky top-0 z-40 -mx-6 border-b border-border-soft/50 bg-bg/90 px-6 pb-4 pt-12 shadow-[0_12px_40px_-28px_rgba(0,0,0,0.55)] backdrop-blur-md supports-[backdrop-filter]:bg-bg/80 md:pt-16">
          <header className="flex items-center justify-between animate-fade-rise">
            <HorizonMark />
            <HeaderClock />
          </header>
          <div className="mt-4 animate-fade-rise">
            <PulseStrip />
          </div>
        </div>
      )}

      {!signedIn && (
        <section className="mt-16 animate-fade-rise stagger-1">
          <SignInBanner />
        </section>
      )}

      {signedIn && (
        <>
          <section className="mt-16 md:mt-20 animate-fade-rise stagger-1">
            <MorningBrief />
          </section>

          <Divider className="stagger-2" />
          <section className="mt-16 animate-fade-rise stagger-2">
            <TodaysArc />
          </section>

          <Divider className="stagger-3" />
          <section className="mt-16 animate-fade-rise stagger-3">
            <PriorityQueue />
          </section>

          <Divider className="stagger-4" />
          <section className="mt-16 animate-fade-rise stagger-4">
            <PortfolioPulse />
          </section>

          <Divider className="stagger-5" />
          <section className="mt-16 animate-fade-rise stagger-5">
            <PreDraftedActions />
          </section>

          <Divider className="stagger-6" />
          <section className="mt-16 animate-fade-rise stagger-6">
            <SignalFeed />
          </section>

          <AskBar />
        </>
      )}
    </main>
  );
}

// Hairline section divider — used between the five surface sections of
// the home page to establish rhythm without adding heavy borders.
function Divider({ className = "" }: { className?: string }) {
  return <div className={`mt-20 hairline animate-fade-in ${className}`} aria-hidden />;
}
