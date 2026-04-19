import { cookies } from "next/headers";
import { HorizonMark } from "@/components/brand/HorizonMark";
import { MorningBrief } from "@/components/horizon/MorningBrief";
import { PriorityQueue } from "@/components/horizon/PriorityQueue";
import { PortfolioPulse } from "@/components/horizon/PortfolioPulse";
import { PreDraftedActions } from "@/components/horizon/PreDraftedActions";
import { SignalFeed } from "@/components/horizon/SignalFeed";
import { AskBar } from "@/components/horizon/AskBar";
import { SignInBanner } from "@/components/horizon/SignInBanner";

// Force dynamic — we read the Salesforce session cookie server-side to
// decide whether to show the signed-out banner instead of kicking every
// section's SSE stream into a cascade of 401s.
export const dynamic = "force-dynamic";

export default function HorizonHome() {
  const now = new Date();
  const greetingTime = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const signedIn = Boolean(cookies().get("hz_sf")?.value);

  return (
    <main className="relative mx-auto w-full max-w-[920px] px-6 pb-48 pt-16 md:pt-24">
      <header className="flex items-center justify-between animate-fade-rise">
        <HorizonMark />
        <div className="font-mono text-xs text-text-muted">{greetingTime}</div>
      </header>

      {!signedIn && (
        <section className="mt-16 animate-fade-rise">
          <SignInBanner />
        </section>
      )}

      {signedIn && (
        <>
          <section className="mt-20 animate-fade-rise">
            <MorningBrief />
          </section>

          <section className="mt-24 animate-fade-rise">
            <PriorityQueue />
          </section>

          <section className="mt-24 animate-fade-rise">
            <PortfolioPulse />
          </section>

          <section className="mt-24 animate-fade-rise">
            <PreDraftedActions />
          </section>

          <section className="mt-24 animate-fade-rise">
            <SignalFeed />
          </section>

          <AskBar />
        </>
      )}
    </main>
  );
}
