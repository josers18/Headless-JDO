import { Suspense } from "react";
import { cookies } from "next/headers";
import { LeftRail } from "@/components/nav/LeftRail";

export const dynamic = "force-dynamic";

// Wrap `{children}` in a Suspense boundary so the LeftRail renders
// immediately when the layout resolves. Without it, Next.js waits for
// the destination page's full RSC payload before streaming the shell,
// which means the rail sits unresponsive while Today's 8 section
// fetches (MorningBrief / PriorityQueue / Pulse / Drafts / Signals /
// ClientDetailSheet / etc.) all resolve serially. With the boundary,
// the rail + empty content region paint in <100ms and the banker can
// click ⌘2 / Ask My Data even while Today is still loading.
export default async function BankerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const signedIn = Boolean((await cookies()).get("hz_sf")?.value);

  return (
    <div className="flex min-h-dvh">
      <LeftRail signedIn={signedIn} />
      <div className="min-w-0 flex-1 pl-16">
        <Suspense fallback={null}>{children}</Suspense>
      </div>
    </div>
  );
}
