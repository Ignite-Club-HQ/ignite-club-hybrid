import type { FeatureBackendContext } from './featureRouter';
import { privateProfileSearchRehearsalEnabled } from './privateProfileSearchMode';
import { readRelationshipProfiles, type ProfileRelationship } from './relationshipProfileRead';
import { getLiveGroupMetadata, type LiveGroupMetadata } from './features/messaging';
import { getLiveMiniLeague } from './features/miniLeagues';
import { listLiveCompetitionCards, listLiveOfficialChats } from './features/competitions';

export type ChatProfile = { id: string; display_name: string | null; avatar_url: string | null };

/** Metadata only locates a relationship. Name disclosure is independently
 * authorized by identity + original PII + the exact owning relationship. */
export async function readChatRelationshipProfiles(
  owner: FeatureBackendContext, conversationId: string, ids: readonly string[], signal?: AbortSignal,
): Promise<Map<string, ChatProfile>> {
  if (!privateProfileSearchRehearsalEnabled()) {
    return (await import('@/lib/profileCache')).fetchProfilesWithCache([...ids]);
  }
  ids = [...new Set(ids)];
  if (!ids.length) return new Map();
  if (ids.length > 100) throw new Error('Chat profile batch is too large.');
  const identity = owner.identity;
  const principal = identity.getPrincipal().toText();
  const target = JSON.stringify(owner.target);
  const active = () => {
    if (signal?.aborted || owner.identity !== identity || identity.getPrincipal().toText() !== principal
      || JSON.stringify(owner.target) !== target) throw new Error('Chat profile audience changed or cancelled.');
  };
  const metadataKey = (m: LiveGroupMetadata) => JSON.stringify({
    conversationId: m.conversationId, kind: m.kind, clubId: m.clubId, teamId: m.teamId,
    members: m.members.map(p => p.toText()).sort(),
  });
  active();
  const metadata = await getLiveGroupMetadata(owner, conversationId);
  active();
  if (metadata.conversationId !== conversationId) throw new Error('Chat profile conversation mismatch.');
  const opening = metadataKey(metadata);
  let relationship: ProfileRelationship;
  let confirmResource: () => Promise<void> = async () => {};
  if (metadata.kind.startsWith('mini_league:')) {
    const resource = metadata.kind.slice('mini_league:'.length);
    const league = await getLiveMiniLeague(owner, resource);
    active();
    if (!resource || league.id !== resource || !metadata.clubId || league.club_id !== metadata.clubId)
      throw new Error('Chat league ownership mismatch.');
    relationship = { kind: 'league', resource };
    confirmResource = async () => {
      const closing = await getLiveMiniLeague(owner, resource);
      active();
      if (closing.id !== resource || closing.club_id !== metadata.clubId) throw new Error('Chat league ownership changed.');
    };
  } else if (metadata.kind === 'competition') {
    // Only the caller-authorized owning competition directory is eligible.
    // Names, URL hints and organizer-club membership cannot identify this map.
    const cards = await listLiveCompetitionCards(owner);
    active();
    if (cards.length > 25) throw new Error('Chat competition directory exceeds the bounded lookup.');
    const matches: string[] = [];
    for (const card of cards) {
      const chats = await listLiveOfficialChats(owner, card.id);
      active();
      if (chats.some(chat => chat.conversation_id === conversationId && chat.competition_id === card.id)) matches.push(card.id);
    }
    if (matches.length !== 1) throw new Error('Exact chat competition ownership is required.');
    const resource = matches[0];
    if (!resource) throw new Error('Chat competition ownership is missing.');
    relationship = { kind: 'competition', resource };
    confirmResource = async () => {
      const cards = await listLiveCompetitionCards(owner);
      active();
      if (!cards.some(card => card.id === resource)) throw new Error('Chat competition access changed.');
      const chats = await listLiveOfficialChats(owner, resource);
      active();
      if (!chats.some(chat => chat.conversation_id === conversationId && chat.competition_id === resource))
        throw new Error('Chat competition ownership changed.');
    };
  } else if (['club', 'team', 'group', 'club_admin'].includes(metadata.kind) && metadata.clubId) {
    relationship = { kind: 'club', resource: metadata.clubId };
  } else {
    // Competition-admin, DM and broadcast require their own relationship
    // contracts. Do not guess a resource from deterministic conversation IDs.
    throw new Error('Verified chat profile relationship is unavailable.');
  }
  const profiles = await readRelationshipProfiles(owner, ids, relationship, signal);
  active();
  await confirmResource();
  const closing = await getLiveGroupMetadata(owner, conversationId);
  active();
  if (metadataKey(closing) !== opening) throw new Error('Chat profile audience changed.');
  const requested = new Set(ids);
  const out = new Map<string, ChatProfile>();
  for (const row of profiles) {
    if (!requested.has(row.account_id) || out.has(row.account_id)) throw new Error('Chat profile subject mismatch.');
    out.set(row.account_id, { id: row.account_id, display_name: row.display_name, avatar_url: row.avatar_ref[0] ?? null });
  }
  return out;
}