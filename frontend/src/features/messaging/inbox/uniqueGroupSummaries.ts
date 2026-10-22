/** Repeated listings of one conversation are not separate conversations.
 * Names are deliberately ignored: distinct same-name histories must survive. */
export function uniqueGroupSummaries<T extends { id: string; club_id: string | null }>(rows: readonly T[]): T[] {
  const seen = new Map<string, T>();
  for (const row of rows) {
    const previous = seen.get(row.id);
    if (previous && previous.club_id !== row.club_id) throw new Error('Conflicting chat club ownership');
    if (!previous) seen.set(row.id, row);
  }
  return [...seen.values()];
}