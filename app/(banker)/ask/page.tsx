import { SectionTopBar } from "@/components/nav/SectionTopBar";
import { AskDataEntry } from "@/components/ask-data/AskDataEntry";

export const dynamic = "force-dynamic";

export default function AskMyDataPage() {
  return (
    <main className="relative mx-auto w-full max-w-[960px] px-6 pb-56 xl:max-w-[1400px]">
      <SectionTopBar title="Ask My Data" />
      <AskDataEntry />
    </main>
  );
}
