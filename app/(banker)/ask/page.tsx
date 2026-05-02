import { SectionTopBar } from "@/components/nav/SectionTopBar";
import { AskDataEntry } from "@/components/ask-data/AskDataEntry";
import { AskWorkspace } from "@/components/ask-data/AskWorkspace";

export const dynamic = "force-dynamic";

export default function AskMyDataPage() {
  return (
    <main className="relative mx-auto w-full max-w-[1600px] px-6 pb-10">
      <SectionTopBar title="Ask My Data" />
      <AskWorkspace>
        <AskDataEntry />
      </AskWorkspace>
    </main>
  );
}
