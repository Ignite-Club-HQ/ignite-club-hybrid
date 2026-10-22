import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), candidates: vi.fn(), create: vi.fn(), add: vi.fn() }));
vi.mock('./messagingCandidates', () => ({ fetchLiveMessagingCandidates: mocks.candidates }));
vi.mock('./features/messaging', () => ({ listLiveGroupsByClub: mocks.list, ensureLiveStandardClubChat: mocks.create, addLiveGroupMembers: mocks.add }));
import { ensureLiveDefaultClubChats, DEFAULT_CLUB_CHATS } from './defaultClubChats';
const principal = { toText: () => 'parent-a' };
const ctx = { target: { host: 'https://icp-api.io', canisterIds: { messaging_domain: 'group-2-chat' } }, identity: { getPrincipal: () => principal } } as never;
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue([]); mocks.candidates.mockResolvedValue([]); mocks.create.mockResolvedValue({ conversation_id: 'authoritative-chat' }); mocks.add.mockResolvedValue({}); });
describe('default club chat recovery', () => {
  it('does not create duplicate chats when the existing-chat read fails', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline'));
    await expect(ensureLiveDefaultClubChats(ctx, 'read-failure')).rejects.toThrow('offline');
    expect(mocks.create).not.toHaveBeenCalled();
    await ensureLiveDefaultClubChats(ctx, 'read-failure');
    expect(mocks.create).toHaveBeenCalledTimes(3);
  });
  it('shares concurrent setup and creates all three chats concurrently', async () => {
    const finishes: Array<() => void> = [];
    mocks.create.mockImplementation(() => new Promise(resolve => { finishes.push(() => resolve({ conversation_id: 'authoritative-chat' })); }));
    const first = ensureLiveDefaultClubChats(ctx, 'concurrent');
    const second = ensureLiveDefaultClubChats(ctx, 'concurrent');
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(3));
    expect(mocks.list).toHaveBeenCalledTimes(1);
    finishes.forEach(finish => finish());
    expect(await Promise.all([first, second])).toEqual([[], []]);
  });
  it('retries a failed membership top-up instead of marking the club synced', async () => {
    mocks.list.mockResolvedValue(DEFAULT_CLUB_CHATS.map((def, i) => ({ name: def.name, conversationId: `chat-${i}`, teamId: null })));
    mocks.candidates.mockResolvedValue([{ id: 'parent-a', principal, roles: [{ role: 'club_admin', clubId: 'top-up' }] }]);
    mocks.add.mockRejectedValueOnce(new Error('network interrupted'));
    expect(await ensureLiveDefaultClubChats(ctx, 'top-up')).toHaveLength(1);
    expect(await ensureLiveDefaultClubChats(ctx, 'top-up')).toEqual([]);
    expect(mocks.add).toHaveBeenCalledTimes(6);
    expect(mocks.add).toHaveBeenCalledWith(ctx, 'authoritative-chat', [principal]);
  });
  it('never reuses another account or canister success marker', async () => {
    await ensureLiveDefaultClubChats(ctx, 'scoped');
    const other = { ...ctx, target: { host: 'https://icp-api.io', canisterIds: { messaging_domain: 'other-group' } } } as never;
    await ensureLiveDefaultClubChats(other, 'scoped');
    expect(mocks.create).toHaveBeenCalledTimes(6);
  });
  it('uses explicit standard keys and never substitutes an ordinary create on rejection', async () => {
    mocks.create.mockRejectedValue(new Error('Canister has no update method'));
    expect(await ensureLiveDefaultClubChats(ctx, 'upgrade-pending')).toHaveLength(3);
    expect(mocks.create.mock.calls.map(call => call[2])).toEqual(['coaches', 'team_admins', 'club_committee']);
    expect(mocks.add).not.toHaveBeenCalled();
  });
});