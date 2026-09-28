/**
 * Resolve a reply target from the messages already loaded for a chat.
 *
 * Realtime INSERT payloads only include `reply_to_id`. Looking in the local
 * window before fetching avoids rendering an "unavailable" reply first and
 * patching the same row after a second network round-trip.
 */
export function findLocalReplyMessage<T extends { id: string }>(
  messages: readonly T[] | null | undefined,
  replyToId: string | null | undefined,
): T | null {
  if (!replyToId || !messages?.length) return null;
  return messages.find((message) => message.id === replyToId) ?? null;
}