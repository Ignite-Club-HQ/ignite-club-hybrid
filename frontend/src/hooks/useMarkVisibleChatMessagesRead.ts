import { useEffect, useRef } from "react";

export interface ReadableChatMessage {
  id: string;
  author_id: string;
}

export const CHAT_READ_EXCLUDED_ID_PREFIXES = ["temp-"] as const;
export const CHAT_READ_EXCLUDED_WITH_QUEUED_ID_PREFIXES = ["temp-", "queued-"] as const;

export function selectVisibleChatMessageIdsToMarkRead<TMessage extends ReadableChatMessage>(
  messages: readonly TMessage[] | null | undefined,
  userId: string | undefined,
  excludedIdPrefixes: readonly string[],
  previouslyMarkedIds?: ReadonlySet<string>,
): string[] {
  if (!messages?.length || !userId) return [];

  return messages
    .filter(
      (message) =>
        message.author_id !== userId &&
        !excludedIdPrefixes.some((prefix) => message.id.startsWith(prefix)) &&
        !previouslyMarkedIds?.has(message.id),
    )
    .map((message) => message.id);
}

/**
 * Marks visible, non-own server messages read. Route-specific transport remains
 * in useMessageReads; this only preserves each route's visibility policy.
 */
export function useMarkVisibleChatMessagesRead<TMessage extends ReadableChatMessage>({
  messages,
  userId,
  markMessagesAsRead,
  excludedIdPrefixes = CHAT_READ_EXCLUDED_ID_PREFIXES,
  deduplicate = true,
}: {
  messages: readonly TMessage[] | null | undefined;
  userId: string | undefined;
  markMessagesAsRead: (messageIds: string[]) => void;
  excludedIdPrefixes?: readonly string[];
  deduplicate?: boolean;
}): void {
  const markedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const messageIds = selectVisibleChatMessageIdsToMarkRead(
      messages,
      userId,
      excludedIdPrefixes,
      deduplicate ? markedIdsRef.current : undefined,
    );

    if (messageIds.length === 0) return;

    if (deduplicate) {
      messageIds.forEach((id) => markedIdsRef.current.add(id));
    }
    markMessagesAsRead(messageIds);
  }, [deduplicate, excludedIdPrefixes, markMessagesAsRead, messages, userId]);
}