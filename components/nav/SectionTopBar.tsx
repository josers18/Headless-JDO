import { cookies } from "next/headers";
import { HorizonMark } from "@/components/brand/HorizonMark";
import { HeaderClock } from "@/components/horizon/HeaderClock";
import { ThemeSwitcher } from "@/components/horizon/ThemeSwitcher";
import { UserMenu } from "@/components/horizon/UserMenu";
import { getBankerMenuProfile } from "@/lib/salesforce/token";

// Sticky chrome for /ask and /analyze. Intentionally mirrors the shape of
// Today's signed-in header (sticky / blur / same bg treatment) so the three
// surfaces feel like one product, but adds a muted center title slot the
// Today header does not have — the section label is redundant on Today
// because the whole screen *is* Today.
//
// Not used on `/` per the user override to leave Today's existing sticky
// header untouched (see T0-1 discussion).
export async function SectionTopBar({ title }: { title: string }) {
  const signedIn = Boolean((await cookies()).get("hz_sf")?.value);
  const bankerMenu = signedIn ? await getBankerMenuProfile() : null;

  return (
    <div className="sticky top-0 z-40 -mx-6 border-b border-border-soft/50 bg-bg/90 px-6 pb-4 pt-12 shadow-[0_12px_40px_-28px_rgba(0,0,0,0.55)] backdrop-blur-md supports-[backdrop-filter]:bg-bg/80 md:pt-16">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 animate-fade-rise">
        <div className="flex min-w-0 items-center">
          <HorizonMark />
        </div>
        <div
          className="font-display text-[15px] font-medium tracking-tight text-text md:text-[17px]"
          aria-label={`Section: ${title}`}
        >
          {title}
        </div>
        <div className="flex items-center justify-end gap-3">
          {bankerMenu && (
            <UserMenu
              bankerName={bankerMenu.name}
              bankerEmail={bankerMenu.email}
            />
          )}
          <ThemeSwitcher />
          <HeaderClock />
        </div>
      </header>
    </div>
  );
}
