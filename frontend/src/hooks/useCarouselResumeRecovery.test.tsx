import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
const m = vi.hoisted(() => ({ active: undefined as ((state: { isActive: boolean }) => void) | undefined, remove: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async (_: string, callback: typeof m.active) => { m.active = callback; return { remove: m.remove }; } } }));
import { useCarouselResumeRecovery } from './useCarouselResumeRecovery';
afterEach(() => { m.active = undefined; vi.clearAllMocks(); });
describe('carousel foreground listeners', () => {
  it('recovers cards through native return and coalesces a simultaneous browser visibility event', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const key = ['my-teams-premium-v2', 'paul'];
    client.setQueryData(key, []);
    let resolve: ((value: { id: string }[]) => void) | undefined;
    const read = vi.fn(() => new Promise<{ id: string }[]>(done => { resolve = done; }));
    const observer = new QueryObserver(client, { queryKey: key, queryFn: read });
    const stop = observer.subscribe(() => {});
    const hook = renderHook(() => useCarouselResumeRecovery('paul', null), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => {
      m.active?.({ isActive: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve(); await Promise.resolve();
    });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => { resolve?.([{ id: 'u12' }]); await Promise.resolve(); });
    expect(observer.getCurrentResult().data).toEqual([{ id: 'u12' }]);
    hook.unmount(); expect(m.remove).toHaveBeenCalledTimes(1);
    stop(); client.clear();
  });
});