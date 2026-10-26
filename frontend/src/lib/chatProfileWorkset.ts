export type ProfileWorksetMessage = {
  id: string;
  author_id?: string | null;
  forwarded_from_user_id?: string | null;
  reply_to_id?: string | null;
  reply_to?: { author_id?: string | null; text?: string } | null;
  reactions?: readonly { user_id?: string | null }[];
};

/** Location and IDs only. The exact-chat service still authorizes every name. */
export function chatProfileWorkset(
  messages: readonly ProfileWorksetMessage[], visibleIds: readonly string[] | undefined,
  reactions: readonly { group_message_id?: string; user_id?: string | null }[] = [],
): string[] {
  const wanted = new Set(visibleIds?.slice(0, 100));
  const rows = visibleIds === undefined
    ? messages.slice(-25).reverse()
    : [];
  if (visibleIds !== undefined) for (const row of messages) {
    if (wanted.has(row.id)) { rows.push(row); wanted.delete(row.id); }
    if (!wanted.size || rows.length === 100) break;
  }
  // Keep only referenced reply authors, never another full history index.
  const replies = new Set(rows.flatMap(row => row.reply_to_id ? [row.reply_to_id] : []));
  const replyAuthors = new Map<string, string | null | undefined>();
  if (replies.size) for (const row of messages) {
    if (replies.has(row.id)) replyAuthors.set(row.id, row.author_id);
    if (replyAuthors.size === replies.size) break;
  }
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => { if (id && ids.size < 100) ids.add(id); };
  // Visible speakers precede secondary labels so a large reaction list cannot
  // crowd out the person whose message the member is actually reading.
  for (const row of rows) add(row.author_id);
  for (const row of rows) {
    add(row.reply_to?.author_id ?? replyAuthors.get(row.reply_to_id ?? ''));
    add(row.forwarded_from_user_id);
  }
  const visible = new Set(rows.map(row => row.id));
  for (const row of rows) {
    if (ids.size === 100) break;
    for (const reaction of row.reactions ?? []) {
      if (ids.size === 100) break;
      add(reaction.user_id);
    }
  }
  for (const reaction of reactions) {
    if (ids.size === 100) break;
    if (visible.has(reaction.group_message_id ?? '')) add(reaction.user_id);
  }
  return [...ids];
}