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
  const dayLine = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const signedIn = Boolean(cookies().get("hz_sf")?.value);

  return (
    <main className="relative mx-auto w-full max-w-[960px] px-6 pb-56 pt-12 md:pt-16">
      <header className="flex items-center justify-between animate-fade-rise">
        <HorizonMark />
        <div className="flex items-center gap-4 text-[11px] uppercase tracking-[0.2em] text-text-muted">
          <span className="hidden sm:inline-block">{dayLine}</span>
          <span className="h-[10px] w-px bg-border/70" aria-hidden />
          <span className="font-mono text-[11px] normal-case tracking-normal text-text">
            {greetingTime}
          </span>
        </div>
      </header>

      {!signedIn && (
        <section className="mt-16 animate-fade-rise stagger-1">
          <SignInBanner />
        </section>
      )}

      {signedIn && (
        <>
          <section className="mt-20 md:mt-24 animate-fade-rise stagger-1">
            <MorningBrief />
          </section>

          <Divider className="stagger-2" />
          <section className="mt-16 animate-fade-rise stagger-2">
            <PriorityQueue />
          </section>

          <Divider className="stagger-3" />
          <section className="mt-16 animate-fade-rise stagger-3">
            <PortfolioPulse />
          </section>

          <Divider className="stagger-4" />
          <section className="mt-16 animate-fade-rise stagger-4">
            <PreDraftedActions />
          </section>

          <Divider className="stagger-5" />
          <section className="mt-16 animate-fade-rise stagger-5">
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
