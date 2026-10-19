/** A balance belongs to one club authority; never add duplicate copies. */
export function mergeClubPointBalances(parts: Array<Array<{ club_id: string; points: number }>>) {
  const balances = new Map<string, number>();
  for (const rows of parts) {
    for (const row of rows) {
      if (balances.has(row.club_id) && balances.get(row.club_id) !== row.points) {
        throw new Error(`Conflicting points balances for club ${row.club_id}`);
      }
      balances.set(row.club_id, row.points);
    }
  }
  return [...balances].map(([club_id, points]) => ({ club_id, points }));
}