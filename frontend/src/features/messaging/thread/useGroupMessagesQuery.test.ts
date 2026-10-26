import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ profiles: vi.fn(), reactions: vi.fn() }));
const mode = vi.hoisted(() => ({ rehearsal: false }));
vi.mock('@/live/privateProfileSearchMode', () => ({ privateProfileSearchRehearsalEnabled: () => mode.rehearsal }));
vi.mock('@/lib/profileCache', () => ({ fetchProfilesWithCache: mocks.profiles }));
vi.mock('@/live/features/messaging', () => ({ listLiveLatestMessagesPage: vi.fn(), listLiveReactions: mocks.reactions }));
import { mapLiveGroupRows } from './useGroupMessagesQuery';
describe('ICP group message enrichment', () => {
  it('keeps rehearsal private author names out of persisted message results', async () => {
    mode.rehearsal = true; mocks.profiles.mockClear(); mocks.reactions.mockResolvedValue([]);
    try {
      const rows = await mapLiveGroupRows({}, 'chat', [{ id: 'message', sender: { toText: () => 'person' }, sequence: 1n, body: 'hello', created_at_ms: 1000n, conversation_id: 'chat' }]);
      expect(rows[0].author).toBeNull(); expect(mocks.profiles).not.toHaveBeenCalled();
    } finally { mode.rehearsal = false; }
  });
  it('does not start enrichment for an abandoned chat', async () => {
    mocks.profiles.mockClear(); mocks.reactions.mockClear();
    const controller = new AbortController(); controller.abort();
    const ready = vi.fn();
    await expect(mapLiveGroupRows({}, 'peanut', [], ready, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(ready).not.toHaveBeenCalled();
    expect(mocks.profiles).not.toHaveBeenCalled();
    expect(mocks.reactions).not.toHaveBeenCalled();
  });
  it('publishes authorized message text before delayed profiles and reactions resolve', async () => {
    let finishProfiles: ((value: Map<string, unknown>) => void) | undefined;
    let finishReactions: ((value: unknown[]) => void) | undefined;
    mocks.profiles.mockImplementation(() => new Promise(resolve => { finishProfiles = resolve; }));
    mocks.reactions.mockImplementation(() => new Promise(resolve => { finishReactions = resolve; }));
    const ready = vi.fn();
    const result = mapLiveGroupRows({}, 'peanut', [{
      id: 'message', sender: { toText: () => 'parent' }, sequence: 1n,
      body: 'hello', created_at_ms: 1000n, conversation_id: 'peanut',
    }], ready);
    expect(ready).toHaveBeenCalledWith([expect.objectContaining({ id: 'message', text: 'hello', group_id: 'peanut' })]);
    finishProfiles?.(new Map()); finishReactions?.([]);
    expect((await result)[0].text).toBe('hello');
  });
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