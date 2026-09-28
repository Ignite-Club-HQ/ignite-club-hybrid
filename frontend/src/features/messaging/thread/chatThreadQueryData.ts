export interface ChatMessagesEnvelope<TMessage> {
  messages?: TMessage[];
}

export type ChatMessagesQueryData<TMessage> =
  | TMessage[]
  | ChatMessagesEnvelope<TMessage>
  | null
  | undefined;

/**
 * Read the message array from the two query-data shapes retained by the chat
 * pages during cache hydration. The returned array is never cloned, so callers
 * keep the same identity and remain responsible for sorting/reconciliation.
 */
export function extractChatQueryMessages<TMessage>(
  data: ChatMessagesQueryData<TMessage>,
): TMessage[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.messages)) return data.messages;
  return [];
}
