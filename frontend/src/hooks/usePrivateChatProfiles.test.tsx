import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), direct: vi.fn(), legacy: vi.fn(), routing: vi.fn() }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (_feature: string, providers: any, scope: unknown) => { mocks.routing(scope); return providers.icp({}); } }));
vi.mock('@/live/chatRelationshipProfiles', () => ({ readChatRelationshipProfiles: mocks.read, readDirectChatProfiles: mocks.direct }));
import { usePrivateChatProfiles } from './usePrivateChatProfiles';
import { PRIVATE_PROFILE_DISPLAY_LIFETIME_MS, retirePrivateProfileSession } from '@/live/privateProfileSession';
beforeEach(() => { vi.resetAllMocks(); });
describe('mounted private chat name lifetime', () => {
  it('expires foreground names and withholds them during refused reauthorization', async () => {
    vi.useFakeTimers();
    try {
      mocks.read.mockResolvedValueOnce(new Map([['person', { id: 'person', display_name: 'Allowed' }]])).mockRejectedValueOnce(new Error('Removed'));
      const hook = renderHook(() => usePrivateChatProfiles('chat', 'viewer', ['person'], true));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(hook.result.current('person')?.display_name).toBe('Allowed');
      await act(async () => { await vi.advanceTimersByTimeAsync(PRIVATE_PROFILE_DISPLAY_LIFETIME_MS); });
      expect(hook.result.current('person')).toBeNull();
      expect(mocks.read).toHaveBeenCalledTimes(2);
      hook.unmount();
    } finally { vi.useRealTimers(); }
  });
  it('drops mounted labels immediately when the active session retires', async () => {
    mocks.read.mockResolvedValue(new Map([['person', { id: 'person', display_name: 'Old session' }]]));
    const hook = renderHook(() => usePrivateChatProfiles('chat', 'viewer', ['person'], true));
    await waitFor(() => expect(hook.result.current('person')?.display_name).toBe('Old session'));
    act(() => retirePrivateProfileSession());
    expect(hook.result.current('person')).toBeNull();
    expect(mocks.read.mock.calls[0][3].aborted).toBe(true);
    act(() => { window.dispatchEvent(new Event('pageshow')); });
    expect(mocks.read).toHaveBeenCalledOnce();
  });
  it('aborts pending names on backgrounding and ignores their late reply', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(new Map([['person', { id: 'person', display_name: 'Reauthorized' }]]));
    const hook = renderHook(() => usePrivateChatProfiles('chat', 'viewer', ['person'], true));
    await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(mocks.read.mock.calls[0][3].aborted).toBe(true);
    await act(async () => finish(new Map([['person', { id: 'person', display_name: 'Retired' }]])));
    expect(hook.result.current('person')).toBeNull();
    act(() => { window.dispatchEvent(new Event('pageshow')); });
    await waitFor(() => expect(hook.result.current('person')?.display_name).toBe('Reauthorized'));
  });
  it('clears disclosed names while hidden and requires new authorization on return', async () => {
    mocks.read.mockResolvedValueOnce(new Map([['person', { id: 'person', display_name: 'Allowed' }]])).mockRejectedValueOnce(new Error('Removed'));
    const hook = renderHook(() => usePrivateChatProfiles('chat', 'viewer', ['person'], true));
    await waitFor(() => expect(hook.result.current('person')?.display_name).toBe('Allowed'));
    const state = vi.spyOn(document, 'visibilityState', 'get');
    try {
      state.mockReturnValue('hidden');
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(hook.result.current('person')).toBeNull();
      state.mockReturnValue('visible');
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
      expect(hook.result.current('person')).toBeNull();
    } finally { state.mockRestore(); }
  });
  it('refreshes unanswered DM names when its known shared club arrives and drops them on club change', async () => {
    mocks.direct.mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([['person', { id: 'person', display_name: 'Club name' }]]))
      .mockImplementationOnce(() => new Promise(() => {}));
    const hook = renderHook(({ club }) => usePrivateChatProfiles('dm', 'viewer', ['person'], true, 'direct', undefined, club), { initialProps: { club: undefined as string | undefined } });
    await waitFor(() => expect(mocks.direct).toHaveBeenCalledTimes(1));
    hook.rerender({ club: 'club-a' });
    await waitFor(() => expect(hook.result.current('person')?.display_name).toBe('Club name'));
    expect(mocks.direct.mock.calls[1][4]).toBe('club-a');
    hook.rerender({ club: 'club-b' });
    expect(hook.result.current('person')).toBeNull();
    expect(mocks.direct.mock.calls[1][3].aborted).toBe(true);
  });
  it('routes broadcast names to the app service rather than conversation discovery', async () => {
    mocks.read.mockResolvedValue(new Map([['person', { id: 'person', display_name: 'Reader' }]]));
    const hook=renderHook(({ message }) => usePrivateChatProfiles('broadcast', 'viewer', ['person'], true, 'group', message), { initialProps: { message: 'msg-broadcast-1' } });
    await waitFor(() => expect(hook.result.current('person')?.display_name).toBe('Reader'));
    expect(mocks.routing).toHaveBeenCalledWith({ shared: 'app' });
    expect(mocks.read.mock.calls[0][4]).toBe('msg-broadcast-1');
    hook.rerender({ message: 'msg-broadcast-2' });
    expect(hook.result.current('person')).toBeNull();
  });
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