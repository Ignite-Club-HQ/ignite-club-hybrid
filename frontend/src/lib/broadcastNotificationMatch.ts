/**
 * ICP broadcast chat notification matching.
 *
 * On-chain chat alerts are kind "message_chat" with the conversation id in
 * `club` (falling back to `related_id`). The broadcast feed's conversation
 * id is fixed per deployment (the canister's `ensure_broadcast_conversation`
 * is find-or-create, so it always returns the same id) — callers resolve it
 * once via `ensureLiveBroadcastConversation` and pass it in here.
 *
 * Legacy alerts predate the chat_scope_id plumbing and were enqueued before
 * a conversation id was recorded on the row at all — they carry no `club`/
 * `related_id` scope, so they are matched by notification kind alone
 * ("broadcast", mirroring the Supabase `notifications.type` value) instead.
 */
export interface IcpInboxNotificationLike {
  kind: string;
  club?: string | null;
  related_id?: readonly [] | readonly [string];
}

export function isIcpBroadcastChatNotification(
  notification: IcpInboxNotificationLike,
  broadcastConversationId: string | null,
): boolean {
  // Legacy shape: enqueued directly as a "broadcast" kind, no chat scope at all.
  if (notification.kind === "broadcast") return true;

  if (notification.kind !== "message_chat") return false;

  const scopeId = notification.club || notification.related_id?.[0] || null;
  if (!scopeId) return false;
  if (!broadcastConversationId) return false;
  return scopeId === broadcastConversationId;
}
