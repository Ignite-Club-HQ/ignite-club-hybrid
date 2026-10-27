import { Principal } from '@icp-sdk/core/principal';
import { withFeatureBackend, type FeatureBackendContext } from './featureRouter';
import { privateProfileSearchRehearsalEnabled } from './privateProfileSearchMode';
import { readPrivateProfileEvidence } from './privateProfileEvidence';
import { createLivePrivateProfileAuthorityResolver } from './privateProfileAuthority';
import { listLiveProfilesByIds } from './features/identityAccessClient';
import { capturePrivateProfileSession } from './privateProfileSession';
import { privateClubNameDisplaysEnabled } from './privateClubNameDisplayMode';

export type ProfileRelationship = {
  kind: 'club' | 'family' | 'competition' | 'league' | 'direct' | 'broadcast' | 'competition_admin';
  resource: string;
};

/** The selector describes the request, never grants access. The original PII
 * verifier checks all people against the exact owning service and resource.
 * Scoped private labels never enter the audience-agnostic profile cache. */
export async function readRelationshipProfiles(
  owner: FeatureBackendContext, ids: readonly string[], relationship: ProfileRelationship,
  signal?: AbortSignal,
) {
  relationship = { ...relationship };
  ids = [...ids];
  if (!relationship.resource.trim()) throw new Error('An exact profile relationship is required.');
  const domain = relationship.kind === 'competition' ? 'competition_domain'
    : relationship.kind === 'league' ? 'mini_league_domain' : ['direct', 'broadcast', 'competition_admin'].includes(relationship.kind) ? 'messaging_domain' : 'club_domain';
  const authorityId = owner.target.canisterIds[domain];
  const identity = owner.identity;
  const principal = identity.getPrincipal().toText();
  const target = JSON.stringify(owner.target);
  const sessionActive = capturePrivateProfileSession();
  const active = () => {
    sessionActive();
    if (signal?.aborted || owner.identity !== identity || identity.getPrincipal().toText() !== principal
      || JSON.stringify(owner.target) !== target) throw new Error('Profile relationship changed or cancelled.');
  };
  active();
  return withFeatureBackend('membership', {
    supabase: async () => { throw new Error('Private relationship profiles require Internet Identity.'); },
    icp: async shared => {
      active();
      if (shared.identity !== identity) throw new Error('Profile reader identity changed.');
      const rehearsal = privateProfileSearchRehearsalEnabled();
      const releasedClub = relationship.kind === 'club' && privateClubNameDisplaysEnabled();
      if (!rehearsal && !releasedClub) {
        const rows = await listLiveProfilesByIds(shared, ids);
        active();
        return rows;
      }
      if (!authorityId) throw new Error('Profile relationship authority is missing.');
      const authority = Principal.fromText(authorityId);
      if (authority.isAnonymous() || authority.toText() === 'aaaaa-aa') throw new Error('Invalid profile relationship authority.');
      // Build the resolver lazily: readable legacy profiles retain zero extra
      // network work; encrypted references require independently supplied evidence.
      let resolver: ReturnType<typeof createLivePrivateProfileAuthorityResolver> | undefined;
      const rows = await listLiveProfilesByIds(shared, ids, {
        signal,
        audience: { ...relationship, authority, profile_revision: 0n },
        ...(rehearsal ? { resolveAuthority: async (original: string) => {
          active();
          if (!resolver) {
            const evidence = await readPrivateProfileEvidence(shared);
            active();
            if (!evidence) throw new Error('Verified private-profile deployment evidence is required.');
            resolver = createLivePrivateProfileAuthorityResolver(shared, evidence);
          }
          const lease = await resolver(original);
          active();
          return { context: lease.context, confirm: async () => { active(); await lease.confirm(); active(); } };
        } } : {}),
      });
      active();
      return rows;
    },
  }, { shared: 'person' });
}

/** Legacy Supabase cache stays unchanged; ICP resolves exact ownership first. */
export async function selectRelationshipProfiles(ids: readonly string[], relationship: ProfileRelationship) {
  if (['direct', 'broadcast', 'competition_admin'].includes(relationship.kind)) throw new Error('Message profiles require an explicit authorized conversation context.');
  if (relationship.kind === 'family') throw new Error('Family profiles require an explicit owning child context.');
  const scope = relationship.kind === 'league' ? { miniLeagueId: relationship.resource }
    : relationship.kind === 'competition' ? { competitionId: relationship.resource }
    : { clubId: relationship.resource };
  const feature = relationship.kind === 'league' ? 'mini_leagues'
    : relationship.kind === 'competition' ? 'competitions' : 'membership';
  return withFeatureBackend(feature, {
    supabase: async () => (await import('@/lib/profileCache')).selectCachedProfilesByIds(ids),
    icp: async owner => {
      const rows = await readRelationshipProfiles(owner, ids, relationship);
      return { data: rows.map(row => ({ id: row.account_id, display_name: row.display_name, avatar_url: row.avatar_ref[0] ?? null })), error: null };
    },
  }, scope);
}