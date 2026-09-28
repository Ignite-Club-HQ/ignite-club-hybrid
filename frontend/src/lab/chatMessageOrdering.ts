export interface ChronologicalChatMessage {
  id: string;
  created_at: string;
}

/**
 * Return a chronologically ordered copy suitable for Realtime reconciliation.
 * Equal (or invalid) timestamps use immutable message id as the deterministic
 * tie-breaker retained by every chat surface.
 */
export function orderChatMessagesChronologically<TMessage extends ChronologicalChatMessage>(
  messages: readonly TMessage[],
): TMessage[] {
  return [...messages].sort(
    (left, right) =>
      (new Date(left.created_at).getTime() - new Date(right.created_at).getTime()) ||
      left.id.localeCompare(right.id),
  );
}

/**
 * Merge an older page into the current thread without allowing a boundary
 * duplicate to overwrite newer in-memory/Realtime state.
 */
export function mergeOlderChatMessagesChronologically<
  TMessage extends ChronologicalChatMessage,
>(
  olderMessages: readonly TMessage[],
  currentMessages: readonly TMessage[] | undefined,
): TMessage[] {
  const byId = new Map<string, TMessage>();
  olderMessages.forEach((message) => byId.set(message.id, message));
  currentMessages?.forEach((message) => byId.set(message.id, message));
  return orderChatMessagesChronologically([...byId.values()]);
}

/**
 * Preserve the strict-timestamp pagination contract used by surfaces whose
 * backend query guarantees that every returned row predates the current page.
 * This intentionally does not deduplicate or reorder either input.
 */
export function prependStrictlyOlderChatMessages<TMessage>(
  olderMessages: readonly TMessage[],
  currentMessages: readonly TMessage[] | undefined,
): TMessage[] {
  return [...olderMessages, ...(currentMessages ?? [])];
}
