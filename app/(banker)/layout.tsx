import { cookies } from "next/headers";
import { LeftRail } from "@/components/nav/LeftRail";

export const dynamic = "force-dynamic";

export default async function BankerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const signedIn = Boolean((await cookies()).get("hz_sf")?.value);

  return (
    <div className="flex min-h-dvh">
      <LeftRail signedIn={signedIn} />
      <div className="min-w-0 flex-1 pl-16">{children}</div>
    </div>
  );
}
