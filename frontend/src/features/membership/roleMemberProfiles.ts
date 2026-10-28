import { fetchClubProfilesWithCache } from '@/lib/profileCache';
import { normalizeAccountId } from '@/live/messagingCandidates';

/** Resolve display fields using the principal representation expected by role actions. */
export async function roleMemberProfiles(accountIds: readonly string[], clubId?: string | null) {
  const ids = [...new Set(accountIds)];
  const profiles = await fetchClubProfilesWithCache(clubId, ids.map(normalizeAccountId));
  return new Map(ids.map(id => {
    const profile = profiles.get(normalizeAccountId(id));
    return [id, { id: normalizeAccountId(id), display_name: profile?.display_name?.trim() || 'Member', avatar_url: profile?.avatar_url ?? null }] as const;
  }));
}