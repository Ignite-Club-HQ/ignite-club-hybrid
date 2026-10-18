import { describe, it, expect, vi } from 'vitest';
import { batched, resetBatchingState } from './batching';
import type { FeatureBackendContext } from '../featureRouter';
describe('deployment isolated read coalescing', () => {
  it('same account and canister IDs on different hosts never share the first connection', async () => {
    resetBatchingState(); const identity = {};
    const ctx = (host: string) => ({ identity, target: { alias: 'same', host, networkKind: 'cloud_engine', canisterIds: { club_domain: 'same-cai' } } } as unknown as FeatureBackendContext);
    const call = (host: string, id: string) => batched(ctx(host), 'read', id, async () => ({ actor: host }),
      async (a, ids) => new Map(ids.map(i => [i, a])), async a => a);
    expect(await Promise.all([call('https://one.invalid', 'a'), call('https://two.invalid', 'b')])).toEqual(['https://one.invalid', 'https://two.invalid']);
  });
  it('missing batch method on one destination never disables another destination batching', async () => {
    resetBatchingState(); const identity = {}; const batch = vi.fn(async (_a, ids: string[]) => new Map(ids.map(i => [i, i])));
    const context = (host: string) => ({ identity, target: { host, canisterIds: {} } } as unknown as FeatureBackendContext);
    const bad = (id: string) => batched(context('https://old.invalid'), 'read', id, async () => ({ actor: {} }), async () => { throw new Error('method not found'); }, async (_a, i) => i);
    await Promise.all([bad('a'), bad('b')]);
    const good = (id: string) => batched(context('https://new.invalid'), 'read', id, async () => ({ actor: {} }), batch, async (_a, i) => i);
    expect(await Promise.all([good('a'), good('b')])).toEqual(['a', 'b']); expect(batch).toHaveBeenCalledTimes(1);
  });
});