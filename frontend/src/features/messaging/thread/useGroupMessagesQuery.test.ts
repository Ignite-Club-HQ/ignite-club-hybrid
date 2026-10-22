import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ profiles: vi.fn(), reactions: vi.fn() }));
vi.mock('@/lib/profileCache', () => ({ fetchProfilesWithCache: mocks.profiles }));
vi.mock('@/live/features/messaging', () => ({ listLiveLatestMessagesPage: vi.fn(), listLiveReactions: mocks.reactions }));
import { mapLiveGroupRows } from './useGroupMessagesQuery';
describe('ICP group message enrichment', () => {
  it('starts reactions without waiting for author profiles', async () => {
    let finish: ((value: Map<string, unknown>) => void) | undefined;
    mocks.profiles.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mocks.reactions.mockResolvedValue([]);
    const result = mapLiveGroupRows({}, 'peanut', [{ id: 'message', sender: { toText: () => 'parent' }, sequence: 1n, body: 'hello', created_at_ms: 1000n, conversation_id: 'peanut' }]);
    expect(mocks.reactions).toHaveBeenCalledWith({}, 'peanut');
    finish?.(new Map());
    expect((await result)[0].id).toBe('message');
  });
});