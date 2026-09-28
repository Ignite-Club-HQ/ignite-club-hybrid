/**
 * Shared helpers for grouping consecutive chat messages from the same
 * sender (iMessage / WhatsApp style). Two messages are considered part of
 * the same group when the author matches AND they fall within a short
 * time window AND the same calendar day.
 *
 * Pages compute these flags inside their `renderRow` (which receives
 * `(msg, index, arr)`) and forward them to `<ChatMessage>` so it can:
 *   - drop the author label / avatar on follow-up messages
 *   - flatten the inner bubble corner toward its neighbour
 *   - suppress the per-bubble timestamp / read-receipt strip until the
 *     final message in the group
 */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

type Loose = {
  author_id?: string | null;
  authorId?: string | null;
  created_at?: string | null;
  is_system_message?: boolean | null;
} | null | undefined;

const authorOf = (m: Loose) => (m ? (m.author_id ?? m.authorId ?? null) : null);

export function shouldGroupWithPrev(curr: Loose, prev: Loose): boolean {
  if (!curr || !prev) return false;
  if (prev.is_system_message || curr.is_system_message) return false;
  const a = authorOf(curr);
  const b = authorOf(prev);
  if (!a || !b || a !== b) return false;
  if (!curr.created_at || !prev.created_at) return false;
  const t1 = new Date(curr.created_at).getTime();
  const t0 = new Date(prev.created_at).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t0)) return false;
  if (Math.abs(t1 - t0) > GROUP_WINDOW_MS) return false;
  return new Date(t1).toDateString() === new Date(t0).toDateString();
}
