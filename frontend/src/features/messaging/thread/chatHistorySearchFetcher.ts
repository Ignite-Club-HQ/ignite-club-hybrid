import {
  buildChatScopeFilter,
  type ChatScopeAdapter,
} from "@/features/messaging/scopes/chatScopeAdapters";
import { searchChatHistory } from "@/lib/searchChatHistory";

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
 */
export function createChatHistorySearchFetcher<TMessage>({
  scope,
  scopeId,
  selectColumns,
  hasAnnouncements,
}: ChatHistorySearchFetcherOptions<TMessage>) {
  return async (query: string, signal: AbortSignal): Promise<TMessage[]> =>
    (await searchChatHistory({
      table: scope.messageTable,
      scope: buildChatScopeFilter(scope, scopeId),
      query,
      signal,
      selectColumns,
      hasAnnouncements,
    })) as TMessage[];
}
