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
  const byId = new Map(messages.map(row => [row.id, row]));
  const rows = visibleIds === undefined
    ? messages.slice(-25).reverse()
    : visibleIds.map(id => byId.get(id)).filter((row): row is ProfileWorksetMessage => !!row);
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => { if (id && ids.size < 100) ids.add(id); };
  // Visible speakers precede secondary labels so a large reaction list cannot
  // crowd out the person whose message the member is actually reading.
  for (const row of rows) add(row.author_id);
  for (const row of rows) {
    add(row.reply_to?.author_id ?? byId.get(row.reply_to_id ?? '')?.author_id);
    add(row.forwarded_from_user_id);
  }
  const visible = new Set(rows.map(row => row.id));
  for (const row of rows) for (const reaction of row.reactions ?? []) add(reaction.user_id);
  for (const reaction of reactions) if (visible.has(reaction.group_message_id ?? '')) add(reaction.user_id);
  return [...ids];
}