import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import type { FeatureBackendContext } from './featureRouter';
const mocks = vi.hoisted(() => ({ enabled: true, direct: vi.fn(), metadata: vi.fn(), league: vi.fn(), cards: vi.fn(), chats: vi.fn(), profiles: vi.fn(), legacy: vi.fn(), routing: vi.fn(), clubOwner: undefined as unknown }));
vi.mock('./featureRouter', () => ({ withFeatureBackend: async (_feature: string, providers: any, scope: unknown) => { mocks.routing(scope); return providers.icp(mocks.clubOwner); } }));
vi.mock('./privateProfileSearchMode', () => ({ privateProfileSearchRehearsalEnabled: () => mocks.enabled }));
vi.mock('./features/messaging', () => ({ getLiveGroupMetadata: mocks.metadata, getLiveDirectConversation: mocks.direct }));
vi.mock('./features/miniLeagues', () => ({ getLiveMiniLeague: mocks.league }));
vi.mock('./features/competitions', () => ({ listLiveCompetitionCards: mocks.cards, listLiveOfficialChats: mocks.chats }));
vi.mock('./relationshipProfileRead', () => ({ readRelationshipProfiles: mocks.profiles }));
vi.mock('@/lib/profileCache', () => ({ fetchProfilesWithCache: mocks.legacy }));
import { readChatRelationshipProfiles, readDirectChatProfiles } from './chatRelationshipProfiles';
afterEach(() => vi.unstubAllEnvs());
const identity = { getPrincipal: () => Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai') };
const context = () => ({ identity, target: { alias: 'g2' } }) as unknown as FeatureBackendContext;
const metadata = () => ({ conversationId: 'chat', kind: 'group', clubId: 'club', teamId: null, members: [identity.getPrincipal()] });
beforeEach(() => {
  vi.resetAllMocks(); mocks.enabled = true;
  mocks.clubOwner = context();
  mocks.metadata.mockResolvedValue(metadata());
  mocks.profiles.mockResolvedValue([{ account_id: 'person', display_name: 'Private name', avatar_ref: [] }]);
  mocks.legacy.mockResolvedValue(new Map());
});
describe('rehearsal chat relationship names', () => {
  it('production club-only release uses scoped names and refuses unrelated audiences', async () => {
    mocks.enabled=false; vi.stubEnv('IGNITE_LIVE_PRIVATE_CLUB_NAME_DISPLAYS','1');
    const result=await readChatRelationshipProfiles(context(),'chat',['person']);
    expect(result.get('person')?.display_name).toBe('Private name'); expect(mocks.legacy).not.toHaveBeenCalled();
    mocks.metadata.mockResolvedValue({...metadata(),kind:'competition',clubId:null});
    await expect(readChatRelationshipProfiles(context(),'chat',['person'])).rejects.toThrow('not released');
    expect(mocks.cards).not.toHaveBeenCalled();
  });
  it('resolves canonical broadcast reader/reactor names through messaging, not a club', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), conversationId: 'broadcast', kind: 'broadcast', clubId: null, teamId: null, members: [] });
    await readChatRelationshipProfiles(context(), 'broadcast', ['person'], undefined, 'msg-broadcast-1');
    expect(mocks.profiles.mock.calls[0][2]).toEqual({ kind: 'broadcast', resource: 'msg-broadcast-1' });
    expect(mocks.legacy).not.toHaveBeenCalled(); expect(mocks.metadata).toHaveBeenCalledTimes(2);
  });
  it('rejects a fake broadcast resource before a private profile read', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), kind: 'broadcast', clubId: null });
    await expect(readChatRelationshipProfiles(context(), 'chat', ['person'])).rejects.toThrow('unavailable');
    expect(mocks.profiles).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('refuses a broadcast name lookup without its exact drawer message', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), conversationId: 'broadcast', kind: 'broadcast', clubId: null, teamId: null });
    await expect(readChatRelationshipProfiles(context(), 'broadcast', ['person'])).rejects.toThrow('drawer message');
    expect(mocks.profiles).not.toHaveBeenCalled();
  });
  it('reads only exact DM participants through messaging authority, never a club', async () => {
    mocks.direct.mockResolvedValue({ id: 'dm', participant_1: identity.getPrincipal().toText(), participant_2: 'person' });
    const owner = context();
    const out = await readDirectChatProfiles(owner, 'dm', ['person']);
    expect(out.get('person')?.display_name).toBe('Private name');
    expect(mocks.profiles).toHaveBeenCalledWith(owner, ['person'], { kind: 'direct', resource: 'dm' }, undefined);
    expect(mocks.direct).toHaveBeenCalledTimes(2);
    expect(mocks.metadata).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('refuses foreign DM subjects before decrypting or using a generic profile cache', async () => {
    mocks.direct.mockResolvedValue({ id: 'dm', participant_1: identity.getPrincipal().toText(), participant_2: 'person' });
    await expect(readDirectChatProfiles(context(), 'dm', ['foreign'])).rejects.toThrow('participants required');
    expect(mocks.profiles).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
    await expect(readDirectChatProfiles(context(), 'dm', ['a', 'b', 'c'])).rejects.toThrow('at most two');
  });
  it('resolves an unanswered DM through independently authorized exact-club names', async () => {
    mocks.direct.mockResolvedValue({ id: 'dm', participant_1: identity.getPrincipal().toText(), participant_2: 'person' });
    const out = await readDirectChatProfiles(context(), 'dm', ['person'], undefined, 'shared-club');
    expect(mocks.routing).toHaveBeenCalledWith({ clubId: 'shared-club' });
    expect(mocks.profiles).toHaveBeenCalledWith(mocks.clubOwner, ['person'], { kind: 'club', resource: 'shared-club' }, undefined);
    expect(out.get('person')?.display_name).toBe('Private name');
    expect(mocks.direct).toHaveBeenCalledTimes(2);
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('does not fall back to direct names when the hinted club refuses membership', async () => {
    mocks.direct.mockResolvedValue({ id: 'dm', participant_1: identity.getPrincipal().toText(), participant_2: 'person' });
    mocks.profiles.mockRejectedValue(new Error('Club relationship denied'));
    await expect(readDirectChatProfiles(context(), 'dm', ['person'], undefined, 'foreign-club')).rejects.toThrow('denied');
    expect(mocks.profiles).toHaveBeenCalledTimes(1);
    expect(mocks.direct).toHaveBeenCalledTimes(1);
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('refuses foreign DM subjects even when a shared club locator is supplied', async () => {
    mocks.direct.mockResolvedValue({ id: 'dm', participant_1: identity.getPrincipal().toText(), participant_2: 'person' });
    await expect(readDirectChatProfiles(context(), 'dm', ['foreign'], undefined, 'club')).rejects.toThrow('participants required');
    expect(mocks.routing).not.toHaveBeenCalled(); expect(mocks.profiles).not.toHaveBeenCalled();
  });
  it('withholds club-authorized names when the DM participants change before delivery', async () => {
    mocks.direct.mockResolvedValueOnce({ id: 'dm', participant_1: identity.getPrincipal().toText(), participant_2: 'person' })
      .mockResolvedValueOnce({ id: 'dm', participant_1: identity.getPrincipal().toText(), participant_2: 'foreign' });
    await expect(readDirectChatProfiles(context(), 'dm', ['person'], undefined, 'club')).rejects.toThrow('participants changed');
  });
  it('rejects a different identity object returned by club routing before name access', async () => {
    mocks.direct.mockResolvedValue({ id: 'dm', participant_1: identity.getPrincipal().toText(), participant_2: 'person' });
    mocks.clubOwner = { ...context(), identity: { ...identity } };
    await expect(readDirectChatProfiles(context(), 'dm', ['person'], undefined, 'club')).rejects.toThrow('identity changed');
    expect(mocks.profiles).not.toHaveBeenCalled();
  });
  it('withholds DM names if a held closing participant reply changes', async () => {
    let release: ((value: unknown) => void) | undefined;
    mocks.direct.mockResolvedValueOnce({ id: 'dm', participant_1: identity.getPrincipal().toText(), participant_2: 'person' })
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const result = readDirectChatProfiles(context(), 'dm', ['person']);
    await vi.waitFor(() => expect(release).toBeDefined());
    release?.({ id: 'dm', participant_1: identity.getPrincipal().toText(), participant_2: 'foreign' });
    await expect(result).rejects.toThrow('participants changed');
  });
  it('reads exact club names without entering the generic cache', async () => {
    const owner = context();
    const result = await readChatRelationshipProfiles(owner, 'chat', ['person']);
    expect(mocks.profiles).toHaveBeenCalledWith(owner, ['person'], { kind: 'club', resource: 'club' }, undefined);
    expect(result.get('person')?.display_name).toBe('Private name');
    expect(mocks.metadata).toHaveBeenCalledTimes(2); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('confirms a tagged league through its owning domain before and after decryption', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), kind: 'mini_league:league' });
    mocks.league.mockResolvedValue({ id: 'league', club_id: 'club' });
    await readChatRelationshipProfiles(context(), 'chat', ['person']);
    expect(mocks.profiles.mock.calls[0][2]).toEqual({ kind: 'league', resource: 'league' });
    expect(mocks.league).toHaveBeenCalledTimes(2);
  });
  it('rejects a league tag pointing to another club before reading names', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), kind: 'mini_league:league' });
    mocks.league.mockResolvedValue({ id: 'league', club_id: 'foreign' });
    await expect(readChatRelationshipProfiles(context(), 'chat', ['person'])).rejects.toThrow('ownership mismatch');
    expect(mocks.profiles).not.toHaveBeenCalled();
  });
  it('uses the owning competition official-chat mapping, not the organizer club', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), kind: 'competition' });
    mocks.cards.mockResolvedValue([{ id: 'cup' }]);
    mocks.chats.mockResolvedValue([{ competition_id: 'cup', conversation_id: 'chat' }]);
    await readChatRelationshipProfiles(context(), 'chat', ['person']);
    expect(mocks.profiles.mock.calls[0][2]).toEqual({ kind: 'competition', resource: 'cup' });
    expect(mocks.chats).toHaveBeenCalledTimes(2);
  });
  it('withholds names after the official chat mapping changes', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), kind: 'competition' });
    mocks.cards.mockResolvedValue([{ id: 'cup' }]);
    mocks.chats.mockResolvedValueOnce([{ competition_id: 'cup', conversation_id: 'chat' }]).mockResolvedValueOnce([]);
    await expect(readChatRelationshipProfiles(context(), 'chat', ['person'])).rejects.toThrow('ownership changed');
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('refuses ambiguous or over-limit competition directories without fallback', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), kind: 'competition' });
    mocks.cards.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    mocks.chats.mockImplementation(async (_ctx, id) => [{ competition_id: id, conversation_id: 'chat' }]);
    await expect(readChatRelationshipProfiles(context(), 'chat', ['person'])).rejects.toThrow('Exact chat');
    mocks.cards.mockResolvedValue(Array.from({ length: 26 }, (_, i) => ({ id: String(i) })));
    mocks.chats.mockClear();
    await expect(readChatRelationshipProfiles(context(), 'chat', ['person'])).rejects.toThrow('bounded');
    expect(mocks.chats).not.toHaveBeenCalled(); expect(mocks.profiles).not.toHaveBeenCalled();
  });
  it('withholds decrypted names after a held closing metadata reply changes the audience', async () => {
    let release: ((value: unknown) => void) | undefined;
    mocks.metadata.mockResolvedValueOnce(metadata()).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const result = readChatRelationshipProfiles(context(), 'chat', ['person']);
    await vi.waitFor(() => expect(release).toBeDefined());
    release?.({ ...metadata(), members: [] });
    await expect(result).rejects.toThrow('audience changed');
  });
  it('rejects account drift during decryption and never reads a closing audience for the new account', async () => {
    const owner = context();
    mocks.profiles.mockImplementation(async () => { owner.identity = { ...identity }; return []; });
    await expect(readChatRelationshipProfiles(owner, 'chat', ['person'])).rejects.toThrow('changed');
    expect(mocks.metadata).toHaveBeenCalledTimes(1);
  });
  it('delegates admin chat IDs without guessing their owning competition or using ordinary roles', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), kind: 'competition_admin', clubId: null, teamId: null });
    await readChatRelationshipProfiles(context(), 'chat', ['person']);
    expect(mocks.profiles.mock.calls[0][2]).toEqual({ kind: 'competition_admin', resource: 'chat' });
    expect(mocks.cards).not.toHaveBeenCalled(); expect(mocks.chats).not.toHaveBeenCalled(); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('withholds admin names when the owning service refuses a stale role', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), kind: 'competition_admin', clubId: null, teamId: null });
    mocks.profiles.mockRejectedValueOnce(new Error('Admin thread membership changed'));
    await expect(readChatRelationshipProfiles(context(), 'chat', ['person'])).rejects.toThrow('membership changed');
    expect(mocks.metadata).toHaveBeenCalledTimes(1); expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('refuses ambiguous admin metadata and mismatched returned subjects', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), kind: 'competition_admin', teamId: 'foreign' });
    await expect(readChatRelationshipProfiles(context(), 'chat', ['person'])).rejects.toThrow('unavailable');
    expect(mocks.profiles).not.toHaveBeenCalled();
    mocks.metadata.mockResolvedValue(metadata());
    mocks.profiles.mockResolvedValue([{ account_id: 'foreign', display_name: 'Hidden', avatar_ref: [] }]);
    await expect(readChatRelationshipProfiles(context(), 'chat', ['person'])).rejects.toThrow('subject mismatch');
  });
  it('preserves existing hosted names while rehearsal is disabled', async () => {
    mocks.enabled = false;
    await readChatRelationshipProfiles(context(), 'chat', ['person']);
    expect(mocks.legacy).toHaveBeenCalledWith(['person']); expect(mocks.metadata).not.toHaveBeenCalled();
  });
  it('bounds author batches before any private read and honors cancellation', async () => {
    await expect(readChatRelationshipProfiles(context(), 'chat', Array.from({ length: 101 }, (_, i) => String(i)))).rejects.toThrow('too large');
    const controller = new AbortController(); controller.abort();
    await expect(readChatRelationshipProfiles(context(), 'chat', ['person'], controller.signal)).rejects.toThrow('cancelled');
    expect(mocks.metadata).not.toHaveBeenCalled();
  });
  it('splits 100 authors into four exact 25-person reads under one chat lease', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `person-${i}`);
    mocks.profiles.mockImplementation(async (_owner, batch) => batch.map((id: string) => ({ account_id: id, display_name: 'Allowed', avatar_ref: [] })));
    const out = await readChatRelationshipProfiles(context(), 'chat', ids);
    expect(out.size).toBe(100);
    expect(mocks.profiles.mock.calls.map(call => call[1])).toEqual([ids.slice(0, 25), ids.slice(25, 50), ids.slice(50, 75), ids.slice(75)]);
    expect(mocks.metadata).toHaveBeenCalledTimes(2);
  });
  it('discards earlier decrypted batches after a later relationship refusal', async () => {
    mocks.profiles.mockResolvedValueOnce([{ account_id: 'person-0', display_name: 'Private', avatar_ref: [] }]).mockRejectedValueOnce(new Error('Audience removed'));
    await expect(readChatRelationshipProfiles(context(), 'chat', Array.from({ length: 26 }, (_, i) => `person-${i}`))).rejects.toThrow('Audience removed');
    expect(mocks.metadata).toHaveBeenCalledTimes(1); expect(mocks.legacy).not.toHaveBeenCalled();
  });
});