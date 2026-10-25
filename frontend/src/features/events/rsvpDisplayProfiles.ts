import { normalizeAccountId } from '@/live/messagingCandidates';

type DisplayProfile = { display_name?: string | null; avatar_url?: string | null };
type RosterProfile = DisplayProfile & { id: string };

/** Display-only joins never replace RSVP identities, status or audience scope. */
export function hydrateRsvpDisplayProfiles<T extends { user_id?: string | null; child_id?: string | null; mini_league_player_id?: string | null; profiles?: DisplayProfile | null }>(
  rows: readonly T[],
  members: readonly RosterProfile[],
  self?: { id: string; profile: DisplayProfile | null | undefined },
): T[] {
  const byId = new Map(members.map(member => [normalizeAccountId(member.id), member]));
  if (self?.profile?.display_name?.trim()) byId.set(normalizeAccountId(self.id), { id: self.id, ...self.profile });
  return rows.map(row => {
    if (!row.user_id || row.child_id || row.mini_league_player_id) return row;
    const known = byId.get(normalizeAccountId(row.user_id));
    if (!known) return row;
    return { ...row, profiles: {
      ...row.profiles,
      display_name: row.profiles?.display_name?.trim() ? row.profiles.display_name : known.display_name ?? null,
      avatar_url: row.profiles?.avatar_url ?? known.avatar_url ?? null,
    } };
  });
}