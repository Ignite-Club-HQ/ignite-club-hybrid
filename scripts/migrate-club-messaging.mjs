// Pure conversion: Supabase chat tables -> messaging_domain ChatPage pages.
// No network, no source writes. Canonical conversation ids match the
// canister's own ensure_conversation convention: team chat id = team id,
// club chat id = club id. Group and club-admin rooms keep their Supabase ids.
// Direct messages are account-to-account, not club data, and stay out.
import { claimedPrincipal, timestamp } from './migrate-club-members.mjs';
const opt = (v) => (v == null || v === '' ? [] : [v]);
const optTs = (v) => (v == null ? [] : [timestamp(v)]);
export const CHAT_PAGE_SIZE = 500;

/**
 * Returns ChatPage-shaped pages: page 0 carries every conversation plus the
 * first messages; later pages carry messages only, in per-conversation order.
 * `claims` maps Supabase user id -> verified destination Principal.
 */
export function buildChatPages({ clubId, teams = [], teamMessages = [], clubMessages = [], chatGroups = [], groupMessages = [], clubAdminConversations = [], clubAdminMessages = [], polls = [], pollVotes = [], claims, creator }) {
  if (!creator) throw Error('Creator principal required');
  const teamIds = new Set(teams.map((t) => t.id));
  for (const m of teamMessages) if (!teamIds.has(m.team_id)) throw Error('Foreign team message refused');
  for (const m of clubMessages) if (m.club_id !== clubId) throw Error('Foreign club message refused');
  const groups = chatGroups.filter((g) => g.club_id === clubId && !g.deleted_at);
  const groupIds = new Set(groups.map((g) => g.id));
  for (const m of groupMessages) if (!groupIds.has(m.group_id)) throw Error('Foreign group message refused');
  const admins = clubAdminConversations.filter((c) => c.club_id === clubId);
  const adminIds = new Set(admins.map((c) => c.id));
  for (const m of clubAdminMessages) if (!adminIds.has(m.conversation_id)) throw Error('Foreign club-admin message refused');

  const conversations = [
    ...teams.map((t) => ({ id: t.id, club_id: clubId, team_id: [t.id], participants: [], next_sequence: 1n })),
    { id: clubId, club_id: clubId, team_id: [], participants: [], next_sequence: 1n },
    ...groups.map((g) => ({ id: g.id, club_id: clubId, team_id: opt(g.team_id), participants: [], next_sequence: 1n })),
    // Club-admin rooms are member<->staff; the member side is known, staff
    // re-join through club authority after cutover.
    ...admins.map((c) => ({ id: c.id, club_id: clubId, team_id: [], participants: [claimedPrincipal(claims, c.member_user_id)], next_sequence: 1n })),
  ];
  if (new Set(conversations.map((c) => c.id)).size !== conversations.length) throw Error('Conversation id collision');

  const rows = [
    ...teamMessages.map((m) => ({ ...m, conv: m.team_id })),
    ...clubMessages.map((m) => ({ ...m, conv: clubId })),
    ...groupMessages.map((m) => ({ ...m, conv: m.group_id })),
    ...clubAdminMessages.map((m) => ({ ...m, conv: m.conversation_id, is_system_message: false })),
  ].filter((m) => !m.deleted_at);
  const liveIds = new Set(rows.map((m) => m.id));
  if (liveIds.size !== rows.length) throw Error('Duplicate message id refused');
  rows.sort((a, b) => (a.conv < b.conv ? -1 : a.conv > b.conv ? 1 : a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));

  const sequences = new Map();
  const messages = rows.map((m) => {
    const seq = (sequences.get(m.conv) ?? 0) + 1;
    sequences.set(m.conv, seq);
    return {
      conversation_id: m.conv, id: m.id,
      sender: m.is_system_message ? creator : claimedPrincipal(claims, m.author_id),
      body: m.text ?? '', sequence: BigInt(seq), idempotency_key: `migrated:${m.id}`,
      edited_at_ms: optTs(m.edited_at),
      attachment: m.image_url ? [{ kind: 'image', ref_id: '', url: [m.image_url] }] : [],
      created_at_ms: timestamp(m.created_at),
      reply_to_id: m.reply_to_id && liveIds.has(m.reply_to_id) ? [m.reply_to_id] : [],
    };
  });
  for (const c of conversations) c.next_sequence = BigInt((sequences.get(c.id) ?? 0) + 1);

  // Polls and votes travel on page 0 with the conversations. Every vote must
  // reference an included poll, within its option range, one per voter.
  const convIds = new Set(conversations.map((c) => c.id));
  const pollRows = polls.filter((p) => !p.deleted_at).map((p) => {
    if (!convIds.has(p.chat_id)) throw Error('Foreign poll refused');
    const options = Array.isArray(p.options) ? p.options.map(String) : null;
    if (!options || options.length < 2) throw Error('Poll without options refused');
    return {
      id: p.id, conversation_id: p.chat_id, message_id: opt(p.message_id),
      question: String(p.question ?? ''), options,
      creator: claimedPrincipal(claims, p.created_by), closed: !!(p.closed ?? p.is_closed),
      created_at_ms: timestamp(p.created_at),
    };
  });
  const pollById = new Map(pollRows.map((p) => [p.id, p]));
  const seenVotes = new Set();
  const voteRows = pollVotes.map((v) => {
    const poll = pollById.get(v.poll_id);
    if (!poll) throw Error('Vote for unknown poll refused');
    const idx = Number(v.option_index ?? v.selected_option_index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= poll.options.length) throw Error('Vote outside poll options refused');
    const key = `${v.poll_id}${v.user_id}`;
    if (seenVotes.has(key)) throw Error('Duplicate poll vote refused');
    seenVotes.add(key);
    return { poll_id: v.poll_id, user: claimedPrincipal(claims, v.user_id), option_index: idx };
  });

  const pages = [];
  for (let offset = 0; ; offset += CHAT_PAGE_SIZE) {
    const slice = messages.slice(offset, offset + CHAT_PAGE_SIZE);
    const end = offset + slice.length;
    pages.push({
      conversations: offset === 0 ? conversations : [], messages: slice,
      polls: offset === 0 ? [pollRows] : [], poll_votes: offset === 0 ? [voteRows] : [],
      next: end < messages.length ? [BigInt(end)] : [],
    });
    if (end >= messages.length) return pages;
  }
}
