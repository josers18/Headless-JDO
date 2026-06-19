import { Suspense } from "react";
import { cookies } from "next/headers";
import { LeftRail } from "@/components/nav/LeftRail";
import { MobileNav } from "@/components/horizon/mobile/MobileNav";
import { SessionUsageProvider } from "@/components/horizon/SessionUsageProvider";

export const dynamic = "force-dynamic";

// Wrap `{children}` in a Suspense boundary so the LeftRail renders
// immediately when the layout resolves. Without it, Next.js waits for
// the destination page's full RSC payload before streaming the shell,
// which means the rail sits unresponsive while Today's 8 section
// fetches (MorningBrief / PriorityQueue / Pulse / Drafts / Signals /
// ClientDetailSheet / etc.) all resolve serially. With the boundary,
// the rail + empty content region paint in <100ms and the banker can
// click ⌘2 / Ask My Data even while Today is still loading.
//
// Mobile chrome: below lg the desktop rail hides and MobileNav (a
// floating bottom pill mirroring the rail's three sections) takes
// over. The rail's `fixed` positioning means we just gate render —
// the layout's pl-16 also gates to lg+ to reclaim the 64px gutter
// for content on phones.
export default async function BankerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const signedIn = Boolean((await cookies()).get("hz_sf")?.value);

  // SessionUsageProvider wraps every banker surface (Today / Ask / Analyze)
  // so the token-spend tally is one shared, cross-tab total — the panel reads
  // from a single hz_sid session in Postgres regardless of which tab spent the
  // tokens. Each surface mounts the panel in-flow in its own right rail /
  // sidebar (Today aside, Ask ContextRail, Analyze model sidebar).
  return (
    <SessionUsageProvider>
      <div className="flex min-h-dvh">
        <div className="hidden lg:contents">
          <LeftRail signedIn={signedIn} />
        </div>
        <div className="min-w-0 flex-1 lg:pl-16">
          <Suspense fallback={null}>{children}</Suspense>
        </div>
        <MobileNav signedIn={signedIn} />
      </div>
    </SessionUsageProvider>
  );
}
