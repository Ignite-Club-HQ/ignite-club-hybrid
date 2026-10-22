/** Undo only this member's failed edit, never another post or later edit. */
export function updateMemberReaction<T extends { user_id: string; reaction_type: string }>(rows: T[], principal: string, next: T[]): T[] {
  return [...rows.filter(row => row.user_id !== principal), ...next];
}