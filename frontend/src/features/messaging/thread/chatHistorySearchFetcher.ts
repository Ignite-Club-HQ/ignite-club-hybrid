import {
  buildChatScopeFilter,
  type ChatScopeAdapter,
} from "@/features/messaging/scopes/chatScopeAdapters";
import { searchChatHistory } from "@/lib/searchChatHistory";
import { scopeForChat } from "@/live/chatScope";

interface ChatHistorySearchFetcherOptions<TMessage> {
  scope: ChatScopeAdapter;
  scopeId?: string;
  selectColumns: string;
  hasAnnouncements?: boolean;
}

/**
 * Binds history search to the same typed scope descriptor used for routing,
 * reactions, and cache identities. Pages retain their message-specific select
 * shape while the table and scope column cannot drift independently.
 *
 * ICP-routed conversations (`withFeatureBackend("messaging")`) search the
 * messaging_domain canister instead of Supabase; `scopeId` is the
 * conversation id the canister expects. Dynamic imports keep the Supabase
 * client and live feature module out of bundles that never route to ICP.
 */
export function createChatHistorySearchFetcher<TMessage>({
  scope,
  scopeId,
  selectColumns,
  hasAnnouncements,
}: ChatHistorySearchFetcherOptions<TMessage>) {
  return async (query: string, signal: AbortSignal): Promise<TMessage[]> => {
    const { withFeatureBackend } = await import("@/live/featureRouter");
    return withFeatureBackend("messaging", {
      supabase: async () =>
        (await searchChatHistory({
          table: scope.messageTable,
          scope: buildChatScopeFilter(scope, scopeId),
          query,
          signal,
          selectColumns,
          hasAnnouncements,
        })) as TMessage[],
      icp: async (ctx) => {
        if (!scopeId) throw new Error(`${scope.kind} chat requires a scope id`);
        const { searchLiveMessages } = await import("@/live/features/messaging");
        return (await searchLiveMessages(ctx, scopeId, query, 100)) as unknown as TMessage[];
      },
    }, scopeForChat(scope.kind, scopeId));
  };
}
