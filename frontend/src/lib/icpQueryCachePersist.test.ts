import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { snapshotQuery, startIcpQueryCachePersist, restoreIcpQueryCache, clearPersistedIcpQueryCache, savedPagePriority } from './icpQueryCachePersist';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function result(data: unknown, key = ['clubs'], meta?: Record<string, unknown>) {
  const client = new QueryClient();
  client.setQueryDefaults(key, { meta }); client.setQueryData(key, data);
  const query = client.getQueryCache().find({ queryKey: key });
  if (!query) throw new Error('missing test query');
  return snapshotQuery(query);
}
describe('bounded ICP snapshots', () => {
  it('restores primary Schedule, Clubs, team and Vault inventories ahead of incidental widgets', () => {
    for (const key of ['events', 'clubs', 'team', 'vault-subfolders', 'next-up-events']) {
      expect(savedPagePriority([key])).toBeGreaterThan(savedPagePriority(['notification-count']));
    }
  });
  it('retains bigint and byte data without JSON conversion', () => {
    const data = { revision: 32n, count: new Uint8Array([1, 2]) };
    expect(result(data)?.snapshot.state.data).toEqual(data);
  });
  it('excludes secret/key and object-URL results', () => {
    expect(result({ secret: 'private' }, ['vetkey'])).toBeNull();
    expect(result({ url: 'blob:dead-link' })).toBeNull();
  });
  it('does not persist decrypted club personal-name queries or composite rosters', () => {
    expect(result([{ name:'Personal name' }],['event-rsvp-display-names'])).toBeNull();
    expect(result([{ display_name:'Personal name' }],['event-member-roles'])).toBeNull();
    expect(result([{ profiles:{display_name:'Personal name'} }],['event-duties'])).toBeNull();
    expect(result([{ name:'Giddy Goat' }],['clubs'])).not.toBeNull();
  });
  it('respects explicit persistence opt-out', () => {
    expect(result(['private'], ['clubs'], { persist: false })).toBeNull();
  });
  it('never persists incomplete fixture inventories but retains complete ones', () => {
    expect(result({ events: [{ id: 'fixture' }], incomplete: true }, ['icp-schedule-fixtures'])).toBeNull();
    expect(result({ events: [{ id: 'fixture' }], incomplete: false }, ['icp-schedule-fixtures'])).not.toBeNull();
  });
  it('bounds individual strings and traversal breadth', () => {
    expect(result('x'.repeat(128 * 1024))).toBeNull();
    expect(result(Array.from({ length: 15000 }, () => 1))).toBeNull();
  });
  it('skips class instances and cyclic data', () => {
    expect(result(new Map([['key', 'value']]))).toBeNull();
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(result(cyclic)).toBeNull();
  });
  it('installs only one subscription and teardown cancels queued work', () => {
    vi.useFakeTimers(); vi.stubGlobal('indexedDB', {});
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const subscribe = vi.spyOn(client.getQueryCache(), 'subscribe');
    const stop1 = startIcpQueryCachePersist(client, true, () => 'account:target');
    const stop2 = startIcpQueryCachePersist(client, true, () => 'account:target');
    client.setQueryData(['clubs'], ['club-1']);
    expect(subscribe).toHaveBeenCalledTimes(2);
    stop1(); stop2();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// Minimal transaction harness: completions are asynchronous, just like IDB.
function storageHarness() {
  const rows = new Map<string, unknown>();
  const opens: Array<() => void> = [];
  let hold = false;
  const db = {
    close: vi.fn(),
    transaction: () => {
      const tx: { oncomplete?: () => void; objectStore: () => unknown } = {
        objectStore: () => ({
          getAll: () => ({ result: [...rows.values()] }),
          put: (row: unknown, key: string) => { rows.set(key, structuredClone(row)); return { result: key }; },
          delete: (key: string) => { rows.delete(key); return { result: undefined }; },
          clear: () => { rows.clear(); return { result: undefined }; },
        }),
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
  };
  vi.stubGlobal('indexedDB', { open: () => {
    const req: { result: typeof db; onsuccess?: () => void } = { result: db };
    const finish = () => req.onsuccess?.();
    if (hold) opens.push(finish); else queueMicrotask(finish);
    return req;
  } });
  return { rows, delay: () => { hold = true; }, release: () => { hold = false; opens.splice(0).forEach(f => f()); } };
}
describe('account and transaction lifecycle', () => {
  it('keeps persisted page copies within the separate 2 MiB budget', async () => {
    vi.useFakeTimers(); const storage = storageHarness();
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const stop = startIcpQueryCachePersist(client, true, () => 'alice:target');
    for (let i = 0; i < 50; i++) client.setQueryData(['team', String(i)], 'x'.repeat(50000));
    await vi.advanceTimersByTimeAsync(5000);
    const rows = [...storage.rows.values()] as Array<{ bytes: number }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(50);
    expect(rows.reduce((sum, row) => sum + row.bytes, 0)).toBeLessThanOrEqual(2 * 1024 * 1024);
    stop();
  });
  it('writes a changed query and restores its exact bigint shape', async () => {
    vi.useFakeTimers(); const storage = storageHarness();
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const stop = startIcpQueryCachePersist(client, true, () => 'alice:target-a');
    client.setQueryData(['clubs'], [{ id: 'g1', revision: 7n }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(storage.rows.size).toBe(1);
    const restored = new QueryClient();
    await restoreIcpQueryCache(restored, true, 400, () => 'alice:target-a');
    expect(restored.getQueryData(['clubs'])).toEqual([{ id: 'g1', revision: 7n }]);
    stop();
  });
  it('does not hydrate another target or account', async () => {
    const storage = storageHarness(); const value = result([{ id: 'private-club' }]);
    if (!value) throw new Error('missing snapshot');
    storage.rows.set('clubs', { ...value, scope: 'alice:target-a', savedAt: Date.now() });
    const client = new QueryClient();
    await restoreIcpQueryCache(client, true, 400, () => 'bob:target-a');
    expect(client.getQueryData(['clubs'])).toBeUndefined();
    await restoreIcpQueryCache(client, true, 400, () => 'alice:target-b');
    expect(client.getQueryData(['clubs'])).toBeUndefined();
  });
  it('rejects hydration completing after an account change', async () => {
    const storage = storageHarness(); const value = result(['private']);
    if (!value) throw new Error('missing snapshot');
    storage.rows.set('clubs', { ...value, scope: 'alice', savedAt: Date.now() });
    storage.delay(); let owner = 'alice'; const client = new QueryClient();
    const restoring = restoreIcpQueryCache(client, true, 400, () => owner);
    owner = 'bob'; storage.release(); await restoring;
    expect(client.getQueryData(['clubs'])).toBeUndefined();
  });
  it('rejects late hydration after the startup time budget expires', async () => {
    vi.useFakeTimers(); const storage = storageHarness(); const value = result(['private']);
    if (!value) throw new Error('missing snapshot');
    storage.rows.set('clubs', { ...value, scope: 'alice', savedAt: Date.now() });
    storage.delay(); const client = new QueryClient();
    const restoring = restoreIcpQueryCache(client, true, 400, () => 'alice');
    await vi.advanceTimersByTimeAsync(401); await restoring;
    storage.release(); await Promise.resolve(); await Promise.resolve();
    expect(client.getQueryData(['clubs'])).toBeUndefined();
  });
  it('clears old snapshots and still persists after a new sign-in', async () => {
    vi.useFakeTimers(); const storage = storageHarness(); let owner: string | null = 'alice';
    const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    const stop = startIcpQueryCachePersist(client, true, () => owner);
    client.setQueryData(['clubs'], ['alice-club']); await vi.advanceTimersByTimeAsync(100);
    expect(storage.rows.size).toBe(1);
    owner = null; client.clear(); await clearPersistedIcpQueryCache();
    expect(storage.rows.size).toBe(0);
    owner = 'bob'; client.setQueryData(['clubs'], ['bob-club']); await vi.advanceTimersByTimeAsync(100);
    expect([...storage.rows.values()]).toEqual([expect.objectContaining({ scope: 'bob', snapshot: expect.objectContaining({ state: expect.objectContaining({ data: ['bob-club'] }) }) })]);
    stop();
  });
});