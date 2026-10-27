import type { FeatureBackendContext } from './featureRouter';
import { withFeatureBackend } from './featureRouter';
import { privateProfileSearchRehearsalEnabled } from './privateProfileSearchMode';
import { readRelationshipProfiles, type ProfileRelationship } from './relationshipProfileRead';
import { getLiveDirectConversation, getLiveGroupMetadata, type LiveGroupMetadata } from './features/messaging';
import { getLiveMiniLeague } from './features/miniLeagues';
import { listLiveCompetitionCards, listLiveOfficialChats } from './features/competitions';
import { capturePrivateProfileSession } from './privateProfileSession';
import { privateClubNameDisplaysEnabled } from './privateClubNameDisplayMode';

export type ChatProfile = { id: string; display_name: string | null; avatar_url: string | null };

/** Real two-person DMs only; read exact participants before and after names.
 * The identity service separately delegates to the owning messaging authority. */
export async function readDirectChatProfiles(owner: FeatureBackendContext, conversationId: string, ids: readonly string[], signal?: AbortSignal, clubId?: string): Promise<Map<string, ChatProfile>> {
  if (!privateProfileSearchRehearsalEnabled() && !(clubId && privateClubNameDisplaysEnabled())) return (await import('@/lib/profileCache')).fetchProfilesWithCache([...ids]);
  ids = [...new Set(ids)];
  if (ids.length > 2) throw new Error('Direct names require at most two participants.');
  if (!ids.length) return new Map();
  const identity = owner.identity, principal = identity.getPrincipal().toText(), target = JSON.stringify(owner.target);
  const sessionActive = capturePrivateProfileSession();
  const active = () => {
    sessionActive();
    if (signal?.aborted || identity !== owner.identity || principal !== identity.getPrincipal().toText() || target !== JSON.stringify(owner.target))
      throw new Error('Direct name audience changed or cancelled.');
  };
  active();
  const opening = await getLiveDirectConversation(owner, conversationId); active();
  const participants = [opening.participant_1, opening.participant_2];
  if (opening.id !== conversationId || participants[0] === participants[1] || !participants.includes(principal) || ids.some(id => !participants.includes(id)))
    throw new Error('Exact direct name participants required.');
  // An unanswered DM has no peer-authored-message proof. A known shared club
  // is only a locator: its owning service must independently authorize both
  // people and original PII must recheck that exact club before name delivery.
  // Never scan clubs here or turn a refused club read into a direct fallback.
  const rows = clubId
    ? await withFeatureBackend('membership', {
      supabase: async () => { throw new Error('Private direct names require Internet Identity.'); },
      icp: async clubOwner => {
        active();
        if (clubOwner.identity !== identity) throw new Error('Direct name reader identity changed.');
        const rows = await readRelationshipProfiles(clubOwner, ids, { kind: 'club', resource: clubId }, signal);
        active();
        return rows;
      },
    }, { clubId })
    : await readRelationshipProfiles(owner, ids, { kind: 'direct', resource: conversationId }, signal);
  active();
  const closing = await getLiveDirectConversation(owner, conversationId); active();
  if (JSON.stringify(closing) !== JSON.stringify(opening)) throw new Error('Direct name participants changed.');
  const out = new Map<string, ChatProfile>();
  for (const row of rows) {
    if (!ids.includes(row.account_id) || out.has(row.account_id)) throw new Error('Direct name subject mismatch.');
    out.set(row.account_id, { id: row.account_id, display_name: row.display_name, avatar_url: row.avatar_ref[0] ?? null });
  }
  return out;
}

/** Metadata only locates a relationship. Name disclosure is independently
 * authorized by identity + original PII + the exact owning relationship. */
export async function readChatRelationshipProfiles(
  owner: FeatureBackendContext, conversationId: string, ids: readonly string[], signal?: AbortSignal, broadcastMessageId?: string,
): Promise<Map<string, ChatProfile>> {
  if (!privateClubNameDisplaysEnabled()) {
    return (await import('@/lib/profileCache')).fetchProfilesWithCache([...ids]);
  }
  ids = [...new Set(ids)];
  if (!ids.length) return new Map();
  if (ids.length > 100) throw new Error('Chat profile batch is too large.');
  const identity = owner.identity;
  const principal = identity.getPrincipal().toText();
  const target = JSON.stringify(owner.target);
  const sessionActive = capturePrivateProfileSession();
  const active = () => {
    sessionActive();
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
  if (!privateProfileSearchRehearsalEnabled() && (!metadata.clubId || !['club', 'team', 'group', 'club_admin'].includes(metadata.kind))) {
    throw new Error('This private name audience is not released.');
  }
  let relationship: ProfileRelationship;
  let confirmResource: () => Promise<void> = async () => {};
  if (metadata.kind === 'broadcast' && conversationId === 'broadcast' && !metadata.clubId && !metadata.teamId) {
    if (!broadcastMessageId?.startsWith('msg-broadcast-')) throw new Error('Exact broadcast drawer message required.');
    relationship = { kind: 'broadcast', resource: broadcastMessageId };
  } else if (metadata.kind === 'competition_admin' && metadata.clubId === null && metadata.teamId === null) {
    relationship = { kind: 'competition_admin', resource: conversationId };
  } else if (metadata.kind.startsWith('mini_league:')) {
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
  // Identity/PII authorize at most 25 names per call. Keep one opening/closing
  // chat lease around the bounded batches rather than repeat discovery per name.
  const profiles: Awaited<ReturnType<typeof readRelationshipProfiles>> = [];
  for (let index = 0; index < ids.length; index += 25) {
    active();
    profiles.push(...await readRelationshipProfiles(owner, ids.slice(index, index + 25), relationship, signal));
    active();
  }
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