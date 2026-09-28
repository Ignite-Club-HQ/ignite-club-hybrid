import { expect, test } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { createHybridTimerDispatcher } from '../src/lab/hybridTimerDispatcher';
import { processHybridClubLinkMaintenance, scheduleHybridClubLinkMaintenance } from '../src/lab/hybridTimerWorkflow';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';
import { createSyntheticTimerQueue } from '../src/lab/syntheticTimerQueue';

const client = (queue: ReturnType<typeof createSyntheticTimerQueue>) => ({
  schedule: async (job: any) => queue.schedule(job), arm: async (at: number) => { queue.arm(at); return { armed: true, next_run_at_ms: [BigInt(at)] }; },
  claim: async (now: number, limit: number) => queue.claim(now, limit), complete: async (id: string, key: string) => queue.complete(id, key),
  fail: async (id: string, error: string, retry?: number) => queue.fail(id, error, retry), recoverInterrupted: async () => {}, get: async (id: string) => queue.get(id),
} as any);

test('runs the same scheduled workflow on ICP and Supabase placements', async () => {
  const registry = createSyntheticPlacementRegistry([
    { clubId: 'icp-club', country: 'US', backend: { Icp: { canister: Principal.fromText('aaaaa-aa') } } },
    { clubId: 'sb-club', country: 'AU', backend: { Supabase: { environment: 'au' } } },
  ]);
  const icpQueue = createSyntheticTimerQueue(); const sbQueue = createSyntheticTimerQueue();
  const dispatcher = createHybridTimerDispatcher(registry, { icp: async () => client(icpQueue), supabase: async () => client(sbQueue) });
  await scheduleHybridClubLinkMaintenance(dispatcher, 'icp-club', 10);
  await scheduleHybridClubLinkMaintenance(dispatcher, 'sb-club', 10);
  const seen: string[] = [];
  await processHybridClubLinkMaintenance(dispatcher, 'icp-club', 10, 10, job => seen.push(job.scope));
  await processHybridClubLinkMaintenance(dispatcher, 'sb-club', 10, 10, job => seen.push(job.scope));
  expect(seen.sort()).toEqual(['icp-club', 'sb-club']);
});

test('blocks workflow writes when a selected backend is disabled or read-only', async () => {
  const registry = createSyntheticPlacementRegistry([{ clubId: 'au', country: 'AU', backend: { Supabase: { environment: 'au' } } }]);
  const queue = createSyntheticTimerQueue(); const dispatcher = createHybridTimerDispatcher(registry, { supabase: async () => client(queue), icp: async () => client(queue) });
  registry.setAvailability('supabase', false);
  await expect(scheduleHybridClubLinkMaintenance(dispatcher, 'au', 1)).rejects.toThrow('disabled');
  registry.setAvailability('supabase', true); registry.setState('au', 'ReadOnly');
  await expect(scheduleHybridClubLinkMaintenance(dispatcher, 'au', 1)).rejects.toThrow('readonly');
});
