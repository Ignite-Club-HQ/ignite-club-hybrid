import { Principal } from '@icp-sdk/core/principal';
import { expect, test } from 'vitest';
import { createHybridTimerDispatcher } from '../src/lab/hybridTimerDispatcher';
import type { TimerJobsClient } from '../src/lab/timerJobsClient';
import { createSyntheticPlacementRegistry } from '../src/lab/syntheticPlacementRegistry';
import { createSyntheticTimerQueue } from '../src/lab/syntheticTimerQueue';
import type { TimerJob } from '../src/lab/syntheticTimerQueue';

const CLUB_A = 'club-timer-a';
const CLUB_B = 'club-timer-b';
const ICP_A = Principal.fromText('aaaaa-aa');
const ICP_B = Principal.fromText('2vxsx-fae');

function createTimerClient(queue: ReturnType<typeof createSyntheticTimerQueue>): TimerJobsClient {
  return {
    schedule: async job => queue.schedule(job),
    arm: async nextRunAtMs => {
      queue.arm(nextRunAtMs);
      return { armed: true, next_run_at_ms: [BigInt(nextRunAtMs)] };
    },
    claim: async (nowMs, limit) => queue.claim(nowMs, limit),
    complete: async (id, idempotencyKey) => queue.complete(id, idempotencyKey),
    fail: async (id, error, retryAtMs) => queue.fail(id, error, retryAtMs),
    recoverInterrupted: async () => queue.recoverInterrupted(),
    get: async id => queue.get(id),
  };
}

function job(id: string, scope: string, runAtMs: number, idempotencyKey = `${id}:key`): Pick<TimerJob, 'id' | 'scope' | 'runAtMs' | 'idempotencyKey'> {
  return { id, scope, runAtMs, idempotencyKey };
}

for (const mode of ['supabase', 'icp'] as const) {
  test(`preserves imported timer lifecycle semantics in explicit ${mode} mode`, async () => {
    const registry = createSyntheticPlacementRegistry([
      {
        clubId: CLUB_A,
        country: 'AU',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'timer-au' } }
          : { Icp: { canister: ICP_A } },
      },
      {
        clubId: CLUB_B,
        country: 'US',
        backend: mode === 'supabase'
          ? { Supabase: { environment: 'timer-us' } }
          : { Icp: { canister: ICP_B } },
      },
    ]);
    const calls: string[] = [];
    const clients = new Map<string, TimerJobsClient>();
    const getClient = (key: string) => {
      let client = clients.get(key);
      if (!client) {
        client = createTimerClient(createSyntheticTimerQueue());
        clients.set(key, client);
      }
      return client;
    };
    const dispatcher = createHybridTimerDispatcher(registry, {
      supabase: async environment => {
        calls.push(`supabase:${environment}`);
        return getClient(`supabase:${environment}`);
      },
      icp: async canister => {
        const key = canister.toText();
        calls.push(`icp:${key}`);
        return getClient(`icp:${key}`);
      },
    });

    await dispatcher.schedule(job('timer-a', CLUB_A, 10));
    await dispatcher.schedule(job('timer-b', CLUB_B, 10));
    await dispatcher.schedule(job('timer-a', CLUB_A, 10));

    await expect(dispatcher.claim(CLUB_A, 10, 10)).resolves.toMatchObject([
      { id: 'timer-a', scope: CLUB_A, attempts: 1, status: 'processing' },
    ]);
    await expect(dispatcher.claim(CLUB_B, 10, 10)).resolves.toMatchObject([
      { id: 'timer-b', scope: CLUB_B, attempts: 1, status: 'processing' },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.startsWith(mode === 'supabase' ? 'supabase:' : 'icp:'))).toBe(true);

    await dispatcher.complete(CLUB_A, 'timer-a', 'timer-a:key');
    await dispatcher.fail(CLUB_B, 'timer-b', 'temporary timer failure', 50);
    await expect(dispatcher.claim(CLUB_B, 49, 10)).resolves.toEqual([]);
    await expect(dispatcher.claim(CLUB_B, 50, 10)).resolves.toMatchObject([
      { id: 'timer-b', attempts: 2, status: 'processing' },
    ]);
    await dispatcher.complete(CLUB_B, 'timer-b', 'timer-b:key');
  });
}

test('does not fall back to Supabase when the selected ICP timer provider fails', async () => {
  let supabaseCalls = 0;
  const registry = createSyntheticPlacementRegistry([{
    clubId: CLUB_A,
    country: 'AU',
    backend: { Icp: { canister: ICP_A } },
  }]);
  const dispatcher = createHybridTimerDispatcher(registry, {
    supabase: async () => {
      supabaseCalls += 1;
      throw new Error('Supabase must not be used in ICP mode');
    },
    icp: async () => {
      throw new Error('local ICP timer provider unavailable');
    },
  });

  await expect(dispatcher.schedule(job('timer-failure', CLUB_A, 0)))
    .rejects.toThrow('local ICP timer provider unavailable');
  expect(supabaseCalls).toBe(0);
});
