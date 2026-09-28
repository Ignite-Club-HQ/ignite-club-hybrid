export interface ChatComposerContent {
  text: string;
  imageUrl?: string | null;
  pendingPollId?: string | null;
}

/** One source of truth for whether a composer has user-sendable content. */
export function hasChatComposerContent({
  text,
  imageUrl,
  pendingPollId,
}: ChatComposerContent): boolean {
  return Boolean(text.trim() || imageUrl || pendingPollId);
}

/** Preserve the existing inline poll marker contract used by chat writes. */
export function buildChatComposerText(text: string, pendingPollId?: string | null): string {
  const trimmed = text.trim();
  if (!pendingPollId) return trimmed;
  return trimmed ? `${trimmed} [poll:${pendingPollId}]` : `[poll:${pendingPollId}]`;
}
