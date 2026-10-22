import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { snapshotQuery, startIcpQueryCachePersist } from './icpQueryCachePersist';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function result(data: unknown, key = ['clubs'], meta?: Record<string, unknown>) {
  const client = new QueryClient();
  client.setQueryDefaults(key, { meta }); client.setQueryData(key, data);
  const query = client.getQueryCache().find({ queryKey: key });
  if (!query) throw new Error('missing test query');
  return snapshotQuery(query);
}
describe('bounded ICP snapshots', () => {
  it('retains bigint and byte data without JSON conversion', () => {
    const data = { revision: 32n, count: new Uint8Array([1, 2]) };
    expect(result(data)?.snapshot.state.data).toEqual(data);
  });
  it('excludes secret/key and object-URL results', () => {
    expect(result({ secret: 'private' }, ['vetkey'])).toBeNull();
    expect(result({ url: 'blob:dead-link' })).toBeNull();
  });
  it('respects explicit persistence opt-out', () => {
    expect(result(['private'], ['clubs'], { persist: false })).toBeNull();
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
    const client = new QueryClient();
    const subscribe = vi.spyOn(client.getQueryCache(), 'subscribe');
    const stop1 = startIcpQueryCachePersist(client, true, () => 'account:target');
    const stop2 = startIcpQueryCachePersist(client, true, () => 'account:target');
    client.setQueryData(['clubs'], ['club-1']);
    expect(subscribe).toHaveBeenCalledTimes(2);
    stop1(); stop2();
    expect(vi.getTimerCount()).toBe(0);
  });
});