import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { createCarouselResumeRecovery } from './carouselResumeRecovery';
const key = ['my-teams-premium-v2', 'paul', 'club-2'];
const clients: QueryClient[] = [];
const listeners: (() => void)[] = [];
function client() { const c = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }); clients.push(c); return c; }
afterEach(() => { listeners.splice(0).forEach(stop => stop()); clients.splice(0).forEach(c => c.clear()); vi.restoreAllMocks(); });
describe('carousel resume recovery', () => {
  it('releases a suspended initial fetch and displays the recovered team without a relaunch', async () => {
    const c = client();
    let cancelled = false;
    const read = vi.fn().mockImplementationOnce(({ signal }: { signal: AbortSignal }) => new Promise(() => {
      signal.addEventListener('abort', () => { cancelled = true; });
    })).mockResolvedValue([{ id: 'u12' }]);
    const observer = new QueryObserver(c, { queryKey: key, queryFn: read });
    listeners.push(observer.subscribe(() => {}));
    const recover = createCarouselResumeRecovery(c, key);
    await Promise.all([recover(), recover()]);
    expect(cancelled).toBe(true);
    expect(read).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toEqual([{ id: 'u12' }]);
  });
  it('does not refetch healthy cards or other pages', async () => {
    const c = client(); c.setQueryData(key, [{ id: 'u12' }]);
    const read = vi.fn(); const observer = new QueryObserver(c, { queryKey: key, queryFn: read });
    listeners.push(observer.subscribe(() => {}));
    const refetch = vi.spyOn(c, 'refetchQueries');
    await createCarouselResumeRecovery(c, key)();
    expect(read).not.toHaveBeenCalled(); expect(refetch).not.toHaveBeenCalled();
  });
  it('recovers an empty session-raced result but accepts a verified empty result', async () => {
    const c = client(); c.setQueryData(key, []);
    const read = vi.fn().mockResolvedValue([]);
    const observer = new QueryObserver(c, { queryKey: key, queryFn: read }); listeners.push(observer.subscribe(() => {}));
    await createCarouselResumeRecovery(c, key)();
    expect(read).toHaveBeenCalledTimes(1); expect(c.getQueryData(key)).toEqual([]);
  });
  it('never starts reads for an inactive or different account carousel', async () => {
    const c = client(); c.setQueryData(key, []);
    const refetch = vi.spyOn(c, 'refetchQueries');
    await createCarouselResumeRecovery(c, key)();
    await createCarouselResumeRecovery(c, ['my-teams-premium-v2', 'other', 'club-2'])();
    expect(refetch).not.toHaveBeenCalled();
  });
});