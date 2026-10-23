import { fetchProfilesWithCache } from '@/lib/profileCache';
import { normalizeAccountId } from '@/live/messagingCandidates';

/** Resolve display fields only; retain the grant's original account ID for actions. */
export async function roleMemberProfiles(accountIds: readonly string[]) {
  const ids = [...new Set(accountIds)];
  const profiles = await fetchProfilesWithCache(ids.map(normalizeAccountId));
  return new Map(ids.map(id => {
    const profile = profiles.get(normalizeAccountId(id));
    return [id, { id, display_name: profile?.display_name?.trim() || 'Member', avatar_url: profile?.avatar_url ?? null }] as const;
  }));
}