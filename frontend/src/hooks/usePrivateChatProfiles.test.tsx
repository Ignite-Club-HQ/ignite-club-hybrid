import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), legacy: vi.fn() }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (_feature: string, providers: any) => providers.icp({}) }));
vi.mock('@/live/chatRelationshipProfiles', () => ({ readChatRelationshipProfiles: mocks.read }));
import { usePrivateChatProfiles } from './usePrivateChatProfiles';
beforeEach(() => { vi.resetAllMocks(); });
describe('mounted private chat name lifetime', () => {
  it('reveals names after its own read and clears them immediately on audience change', async () => {
    mocks.read.mockResolvedValueOnce(new Map([['person', { id: 'person', display_name: 'Allowed name', avatar_url: null }]]))
      .mockImplementationOnce(() => new Promise(() => {}));
    const hook = renderHook(({ chat }) => usePrivateChatProfiles(chat, 'viewer', ['person'], true), { initialProps: { chat: 'a' } });
    await waitFor(() => expect(hook.result.current('person')?.display_name).toBe('Allowed name'));
    hook.rerender({ chat: 'b' });
    expect(hook.result.current('person')).toBeNull();
    expect(mocks.read.mock.calls[0][3].aborted).toBe(true);
  });
  it('does not publish a delayed reply for the previous account', async () => {
    let finish: ((value: unknown) => void) | undefined;
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(new Map());
    const hook = renderHook(({ viewer }) => usePrivateChatProfiles('chat', viewer, ['person'], true), { initialProps: { viewer: 'a' } });
    hook.rerender({ viewer: 'b' });
    await act(async () => { finish?.(new Map([['person', { display_name: 'Old private name' }]])); });
    expect(hook.result.current('person')).toBeNull();
  });
  it('stays inert on hosted screens and keeps denied reads neutral', async () => {
    const hook = renderHook(({ enabled }) => usePrivateChatProfiles('chat', 'viewer', ['person'], enabled), { initialProps: { enabled: false } });
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.read.mockRejectedValue(new Error('Denied'));
    hook.rerender({ enabled: true });
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    expect(hook.result.current('person')).toBeNull();
  });
  it('prioritizes the first 100 current authors instead of failing a long chat history', async () => {
    const ids = Array.from({ length: 130 }, (_, i) => `person-${i}`);
    mocks.read.mockResolvedValue(new Map());
    renderHook(() => usePrivateChatProfiles('chat', 'viewer', ids, true));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(1));
    expect(mocks.read.mock.calls[0][2]).toEqual(ids.slice(0, 100).sort());
  });
});