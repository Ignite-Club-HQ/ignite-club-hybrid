import { expect, test } from 'vitest';
import { createHybridTimerDispatcher } from '../src/lab/hybridTimerDispatcher';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';
import { createSyntheticTimerQueue } from '../src/lab/syntheticTimerQueue';

test('routes timer jobs by club placement and fails when backend is disabled', async () => {
  const registry = createSyntheticPlacementRegistry([{ clubId: 'au', country: 'AU', backend: { Supabase: { environment: 'au' } } }]);
  const queue = createSyntheticTimerQueue();
  const dispatcher = createHybridTimerDispatcher(registry, { supabase: async () => ({ ...queue, schedule: async (job: any) => queue.schedule(job), claim: async (n: number, l: number) => queue.claim(n, l), complete: async (id: string, key: string) => queue.complete(id, key) } as any), icp: async () => { throw new Error('unexpected ICP provider'); } });
  await dispatcher.schedule({ id: 'j', scope: 'au', runAtMs: 0, idempotencyKey: 'k' });
  registry.setAvailability('supabase', false);
  await expect(dispatcher.claim('au', 0, 1)).rejects.toThrow('disabled');
});
