/**
 * Club scoping for app-admin announcements (broadcast messages).
 *
 * A broadcast with no `target_club_ids` is global and visible everywhere.
 * A targeted broadcast must only ever appear while the viewer is in one of
 * the targeted clubs — app admins (who can read every row via RLS) included.
 */
export function broadcastVisibleInClub(
  targetClubIds: string[] | null | undefined,
  activeClubId: string | null | undefined,
): boolean {
  // NULL/empty is the explicit database representation for a global broadcast.
  // `undefined` means an older cache/optimistic row omitted the targeting field;
  // fail closed so it can never briefly leak into another club while fresh data loads.
  if (targetClubIds === undefined) return false;
  if (targetClubIds === null || targetClubIds.length === 0) return true;
  if (!activeClubId) return false;
  return targetClubIds.includes(activeClubId);
}

export function filterBroadcastsForClub<T extends { target_club_ids?: string[] | null }>(
  rows: T[] | null | undefined,
  activeClubId: string | null | undefined,
): T[] {
  if (!rows?.length) return [];
  return rows.filter((row) => broadcastVisibleInClub(row.target_club_ids, activeClubId));
}
