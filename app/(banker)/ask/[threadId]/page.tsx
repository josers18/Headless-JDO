import { notFound } from "next/navigation";
import { SectionTopBar } from "@/components/nav/SectionTopBar";
import { AskWorkspace } from "@/components/ask-data/AskWorkspace";
import { ThreadConversationPlaceholder } from "@/components/ask-data/ThreadConversationPlaceholder";
import { getThread, isDbConfigured } from "@/lib/db/askThreads";
import { currentBankerUserId } from "@/lib/ask/currentUser";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ threadId: string }> };

export default async function AskThreadPage({ params }: PageProps) {
  const { threadId } = await params;
  const userId = await currentBankerUserId();
  // Unauth case renders the workspace shell too so the sidebar's own
  // "sign in to see conversations" state tells the story. Missing DB
  // skips the lookup entirely — the page still renders and the sidebar
  // surfaces the "unconfigured" state via its own API call.
  const thread =
    userId && isDbConfigured()
      ? await getThread({ id: threadId, userId })
      : null;
  if (userId && isDbConfigured() && !thread) notFound();

  return (
    <main className="relative mx-auto w-full max-w-[1600px] px-6 pb-10">
      <SectionTopBar title="Ask My Data" />
      <AskWorkspace>
        <ThreadConversationPlaceholder
          threadId={threadId}
          title={thread?.title ?? "Conversation"}
        />
      </AskWorkspace>
    </main>
  );
}
