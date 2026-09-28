import { fuzzyMatchesQuery } from "@/lib/fuzzySearch";
import { orderChatMessagesChronologically } from "./chatMessageOrdering";

export interface SearchableChatMessage {
  id: string;
  text: string;
  created_at: string;
}

/**
 * Preserves the chat pages' local search behavior after remote history results
 * have merged: blank searches retain all loaded rows and non-blank searches
 * use fuzzy text matching. The output is always a newly ordered array, so
 * virtualized lists receive deterministic chronological positions.
 */
export function filterChatMessagesForSearch<TMessage extends SearchableChatMessage>(
  messages: readonly TMessage[] | undefined,
  searchQuery: string,
): TMessage[] | undefined {
  if (!messages) return undefined;
  const matchingMessages = searchQuery.trim()
    ? messages.filter((message) => fuzzyMatchesQuery(message.text, searchQuery))
    : [...messages];
  return orderChatMessagesChronologically(matchingMessages);
}
