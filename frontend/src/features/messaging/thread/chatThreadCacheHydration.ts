import {
  mergeOlderChatMessagesChronologically,
  type ChronologicalChatMessage,
} from "./chatMessageOrdering";

/**
 * Merge notification/local-cache rows into an existing query snapshot while
 * preserving the existing row whenever both stores contain the same id.
 */
export function mergeCachedChatMessagesChronologically<
  TMessage extends ChronologicalChatMessage,
>(
  existingMessages: readonly TMessage[],
  cachedMessages: readonly TMessage[],
): TMessage[] {
  return mergeOlderChatMessagesChronologically(cachedMessages, existingMessages);
}

export type ChatPlaceholderSource = "cache" | "previous" | "none";

/**
 * Select the first-paint source shared by Team, Club and Group chat without
 * knowing or changing each surface's query-envelope shape.
 */
export function selectHistoryChatPlaceholderSource({
  hasPrevious,
  cachedMessageCount,
  openedFromNotification,
}: {
  hasPrevious: boolean;
  cachedMessageCount: number;
  openedFromNotification: boolean;
}): ChatPlaceholderSource {
  if (openedFromNotification && cachedMessageCount >= 5) return "cache";
  if (hasPrevious) return "previous";
  if (cachedMessageCount >= 2) return "cache";
  return "none";
}
