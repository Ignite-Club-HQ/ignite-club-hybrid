// Pure conversion: Supabase notifications + scheduled_messages ->
// notification_queue FenceSnapshot. No network, no source writes.
// Historical notifications import as already-delivered receipts; pending
// scheduled messages keep their future send time and recurrence.
import { claimedPrincipal, timestamp } from './migrate-club-members.mjs';
const opt = (v) => (v == null || v === '' ? [] : [v]);
const optTs = (v) => (v == null ? [] : [timestamp(v)]);
const CHAT_TYPES = { team: { Team: null }, club: { Club: null }, group: { Group: null }, direct: { Direct: null }, club_admin: { ClubAdmin: null }, broadcast: { Broadcast: null } };
const RECURRENCE = { none: { None: null }, daily: { Daily: null }, weekly: { Weekly: null }, monthly: { Monthly: null } };
const SCHED_STATUS = { pending: { Pending: null }, sent: { Sent: null }, failed: { Failed: null }, cancelled: { Cancelled: null } };

export function buildNotificationSnapshot({ clubId, notifications = [], scheduledMessages = [], claims }) {
  for (const n of notifications) if (n.club_id !== clubId) throw Error('Foreign notification refused');
  for (const s of scheduledMessages) if (s.club_id !== clubId) throw Error('Foreign scheduled message refused');
  return {
    broadcast_proofs: [], // no competition broadcast receipts exist before cutover
    items: notifications.map((n) => ({
      id: n.id, user: claimedPrincipal(claims, n.user_id).toText(), club: clubId, kind: n.type, body: n.message,
      idempotency_key: n.dedupe_key ?? `migrated:${n.id}`, status: { Delivered: null }, attempts: 0,
      next_attempt_ms: 0n, read: !!n.is_read, related_id: opt(n.related_id), created_at_ms: timestamp(n.created_at),
    })),
    scheduled: scheduledMessages.map((s) => {
      const chatType = CHAT_TYPES[s.chat_type];
      if (!chatType) throw Error(`Unsupported scheduled chat type: ${s.chat_type}`);
      const status = SCHED_STATUS[s.status];
      if (!status) throw Error(`Unsupported scheduled status: ${s.status}`);
      const recurrence = RECURRENCE[s.recurrence ?? 'none'];
      if (!recurrence) throw Error(`Unsupported recurrence: ${s.recurrence}`);
      return {
        id: s.id, author: claimedPrincipal(claims, s.author_id).toText(), chat_type: chatType,
        team_id: opt(s.team_id), club_id: opt(s.club_id), group_id: opt(s.group_id), conversation_id: opt(s.conversation_id),
        body: s.text ?? '', image_url: opt(s.image_url), reply_to_id: opt(s.reply_to_id),
        scheduled_for_ms: timestamp(s.scheduled_for), status, sent_message_id: opt(s.sent_message_id),
        error_message: opt(s.error_message), attempted_at_ms: optTs(s.attempted_at), created_at_ms: timestamp(s.created_at),
        updated_at_ms: timestamp(s.updated_at), recurrence, recurrence_until_ms: optTs(s.recurrence_until),
        recurrence_parent_id: opt(s.recurrence_parent_id),
      };
    }),
  };
}
