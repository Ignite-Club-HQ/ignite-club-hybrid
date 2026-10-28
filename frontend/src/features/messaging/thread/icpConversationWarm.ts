import type { QueryClient } from "@tanstack/react-query";
import { withFeatureBackend } from "@/live/featureRouter";
import { warmLiveLatestMessagesPage } from "@/live/features/messaging";
import { groupChatReadScope } from "./groupChatScope";
import { runFewAtATime } from "./icpTeamThreadPage";

export type WarmConversation =
  | { kind: "club"; id: string }
  | { kind: "group"; id: string; clubId?: string | null }
  | { kind: "dm"; id: string };

// Must match each chat page's first-page size so the warm page is reused.
const PAGE_SIZE: Record<WarmConversation["kind"], number> = { club: 30, group: 30, dm: 15 };
const QUERY_KEY: Record<WarmConversation["kind"], string> = { club: "club-messages", group: "group-messages", dm: "dm-messages" };

/**
 * Quietly load the newest page of the inbox's most recent club chats, group
 * chats and DMs (also confirming each chat's owning group), a few at a time, so
 * opening one does not wait on the canister. Chats already cached are skipped.
 */
export async function warmIcpConversations(queryClient: QueryClient, userId: string, items: ReadonlyArray<WarmConversation>) {
  const queue = items.filter(item => !queryClient.getQueryData([QUERY_KEY[item.kind], item.id]));
  await runFewAtATime(queue, async item => {
    const scope = item.kind === "club" ? { clubId: item.id }
      : item.kind === "group" ? groupChatReadScope(queryClient, userId, item.id, item.clubId)
      : { shared: "person" as const };
    await withFeatureBackend("messaging", {
      supabase: async () => undefined,
      icp: (ctx) => warmLiveLatestMessagesPage(ctx, item.id, PAGE_SIZE[item.kind]),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- scope union
    }, scope as any);
  });
}
