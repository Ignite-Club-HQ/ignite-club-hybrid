import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), direct: vi.fn(), legacy: vi.fn() }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (_feature: string, providers: any) => providers.icp({}) }));
vi.mock('@/live/chatRelationshipProfiles', () => ({ readChatRelationshipProfiles: mocks.read, readDirectChatProfiles: mocks.direct }));
import { usePrivateChatProfiles } from './usePrivateChatProfiles';
beforeEach(() => { vi.resetAllMocks(); });
describe('mounted private chat name lifetime', () => {
  it('uses only the direct reader and clears names when switching chat purpose', async () => {
    mocks.direct.mockResolvedValue(new Map([['person', { id: 'person', display_name: 'Direct name' }]]));
    mocks.read.mockRejectedValue(new Error('Not a group'));
    const hook = renderHook(({ kind }) => usePrivateChatProfiles('chat', 'viewer', ['person'], true, kind), { initialProps: { kind: 'direct' as 'direct' | 'group' } });
    await waitFor(() => expect(hook.result.current('person')?.display_name).toBe('Direct name'));
    expect(mocks.read).not.toHaveBeenCalled();
    hook.rerender({ kind: 'group' });
    expect(hook.result.current('person')).toBeNull();
  });
  it('retires an old viewport read and withholds its late names', async () => {
    let finish: ((value: unknown) => void) | undefined;
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(new Map([['new', { id: 'new', display_name: 'Current', avatar_url: null }]]));
    const hook = renderHook(({ ids }) => usePrivateChatProfiles('chat', 'viewer', ids, true), { initialProps: { ids: ['old'] } });
    hook.rerender({ ids: ['new'] });
    await waitFor(() => expect(hook.result.current('new')?.display_name).toBe('Current'));
    await act(async () => finish?.(new Map([['old', { display_name: 'Retired' }]])));
    expect(hook.result.current('old')).toBeNull();
    expect(hook.result.current('new')?.display_name).toBe('Current');
    expect(mocks.read.mock.calls[0][3].aborted).toBe(true);
  });
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