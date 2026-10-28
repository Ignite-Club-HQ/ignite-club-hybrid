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
  cachedComplete = false,
}: {
  hasPrevious: boolean;
  cachedMessageCount: number;
  openedFromNotification: boolean;
  /** Saved copy came from a real read: usable even with 0 or 1 message. */
  cachedComplete?: boolean;
}): ChatPlaceholderSource {
  if (openedFromNotification && cachedMessageCount >= 5) return "cache";
  if (hasPrevious) return "previous";
  if (cachedMessageCount >= 2 || cachedComplete) return "cache";
  return "none";
}
