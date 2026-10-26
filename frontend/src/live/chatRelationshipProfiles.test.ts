import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import type { FeatureBackendContext } from './featureRouter';
const mocks = vi.hoisted(() => ({ enabled: true, metadata: vi.fn(), league: vi.fn(), cards: vi.fn(), chats: vi.fn(), profiles: vi.fn(), legacy: vi.fn() }));
vi.mock('./privateProfileSearchMode', () => ({ privateProfileSearchRehearsalEnabled: () => mocks.enabled }));
vi.mock('./features/messaging', () => ({ getLiveGroupMetadata: mocks.metadata }));
vi.mock('./features/miniLeagues', () => ({ getLiveMiniLeague: mocks.league }));
vi.mock('./features/competitions', () => ({ listLiveCompetitionCards: mocks.cards, listLiveOfficialChats: mocks.chats }));
vi.mock('./relationshipProfileRead', () => ({ readRelationshipProfiles: mocks.profiles }));
vi.mock('@/lib/profileCache', () => ({ fetchProfilesWithCache: mocks.legacy }));
import { readChatRelationshipProfiles } from './chatRelationshipProfiles';
const identity = { getPrincipal: () => Principal.fromText('rrkah-fqaaa-aaaaa-aaaaq-cai') };
const context = () => ({ identity, target: { alias: 'g2' } }) as unknown as FeatureBackendContext;
const metadata = () => ({ conversationId: 'chat', kind: 'group', clubId: 'club', teamId: null, members: [identity.getPrincipal()] });
beforeEach(() => {
  vi.resetAllMocks(); mocks.enabled = true;
  mocks.metadata.mockResolvedValue(metadata());
  mocks.profiles.mockResolvedValue([{ account_id: 'person', display_name: 'Private name', avatar_ref: [] }]);
  mocks.legacy.mockResolvedValue(new Map());
});
describe('rehearsal chat relationship names', () => {
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
  it('refuses unsupported/admin scopes and mismatched returned subjects', async () => {
    mocks.metadata.mockResolvedValue({ ...metadata(), kind: 'competition_admin', clubId: null });
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
});