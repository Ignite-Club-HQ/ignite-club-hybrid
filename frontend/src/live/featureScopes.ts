import type { ClubScope } from './featureRouter';

/** Only chooses location; the destination still verifies access. */
export function vaultViewScope(view: { type: string; clubId?: string; teamId?: string; miniLeagueId?: string; competitionId?: string }): ClubScope {
  if (view.competitionId) return { competitionId: view.competitionId };
  if (view.miniLeagueId) return { miniLeagueId: view.miniLeagueId };
  if (view.clubId) return { clubId: view.clubId };
  if (view.teamId) return { teamId: view.teamId };
  return { shared: 'person' };
}
export function scheduleTargetScope(target: { chat_type: string; club_id?: string | null; team_id?: string | null; group_id?: string | null; conversation_id?: string | null; pro_club_id?: string | null }): ClubScope {
  if (target.chat_type === 'direct' || target.chat_type === 'broadcast') return { shared: 'person' };
  if (target.club_id || target.pro_club_id) return { clubId: target.club_id || target.pro_club_id || '' };
  if (target.team_id) return { teamId: target.team_id };
  if (target.group_id || target.conversation_id) return { conversationId: target.group_id || target.conversation_id || '' };
  throw new Error('Scheduled message scope required');
}
/** Merges caller-authorized results without hiding any failed group. */
export const acrossLists: ClubScope = { everyGroup: true, merge: (parts: any[][]) => [...new Map(parts.flat().map(row => [row.id ?? JSON.stringify(row, (_, v) => typeof v === 'bigint' ? String(v) : v), row])).values()] };
export const acrossVoid: ClubScope = { everyGroup: true, merge: () => undefined };